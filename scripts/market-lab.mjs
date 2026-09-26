#!/usr/bin/env node
/**
 * Market lab — crunch every priced game ESPN has (data/market-history, built by
 * `npm run market-history`) and ask what, if anything, beats the closing price.
 *
 *   npm run market-lab              # all sports with a history file
 *   npm run market-lab -- nba nhl
 *
 * Everything is judged against the de-vigged CLOSE, the sharpest public number there is. A
 * feature "has information" only if it predicts outcomes the close did not already price.
 *
 * Pre-declared before the first run (2026-09-25) — do not loosen after looking:
 *   - Split: first 60% of games chronologically = train, last 40% = test. No tuning on test.
 *   - Test: logistic regression with the close as an OFFSET,
 *       logit P(y) = logit(pClose) + a + b * x
 *     `a` absorbs any constant lean (home/over bias); `b` is the feature's information.
 *   - Gate: |z(b)| >= 2.0 on train (stricter than the ledger's 1.5 because this runs ~90 tests),
 *     b has the same sign when refit on test, AND held-out log loss beats the close alone.
 *   - Feature models are fixed-form (Elo K/HFA, EWMA alpha, rest cap below), not grid-searched.
 *
 * Writes docs/reports/<date>-market-lab.json. Nothing here changes the live site; findings reach
 * the EV layer (src/lib/ev-model.ts, fair-value.ts) only through a versioned, recorded change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { devigTwoWay, impliedProb, americanToDecimal, invNormCdf, logLoss, shiftProb } from '../src/lib/fair-value.ts';

const DIR = path.join(process.cwd(), 'data/market-history');
const TRAIN_FRAC = 0.6;
const GATE_Z = 2.0;
const MAX_OVERROUND = 1.12;      // a two-way market with more margin than this is bad data
const MIN_OVERROUND = 0.995;     // e.g. +140 / +140 in one 2023 NHL row: both sides can't be plus money

// Fixed-form feature models per sport. Standard published values, NOT fit here.
//   elo:  K, home advantage (Elo pts), Elo pts per point of margin, season carry-over
//   ewma: weight on the newest game for rolling team ratings
const CFG = {
  nfl: { k: 20, hfa: 48, eloPerPt: 25, carry: 2 / 3, alpha: 0.15, minGames: 3 },
  nba: { k: 20, hfa: 70, eloPerPt: 28, carry: 3 / 4, alpha: 0.08, minGames: 8 },
  wnba: { k: 20, hfa: 60, eloPerPt: 28, carry: 3 / 4, alpha: 0.1, minGames: 6 },
  cbb: { k: 20, hfa: 80, eloPerPt: 25, carry: 2 / 3, alpha: 0.1, minGames: 6 },
  nhl: { k: 6, hfa: 35, eloPerPt: 140, carry: 3 / 4, alpha: 0.06, minGames: 8 },
};

// ------------------------------------------------------------------ helpers
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r3 = x => Math.round(x * 1000) / 1000;
const r1 = x => Math.round(x * 10) / 10;
const clamp = p => Math.min(0.99, Math.max(0.01, p));
const logit = p => Math.log(clamp(p) / (1 - clamp(p)));
const probit = p => invNormCdf(clamp(p));

/** Validate a two-way price pair; returns true only when it looks like a real market. */
function okPair(a, b) {
  if (a == null || b == null) return false;
  if (Math.abs(a) < 100 || Math.abs(b) < 100) return false;
  const o = impliedProb(a) + impliedProb(b);
  return o >= MIN_OVERROUND && o <= MAX_OVERROUND;
}

/**
 * Move a fair probability to another line using the EMPIRICAL distribution of residuals
 * R = result - close line (sorted), not a normal curve. Scores are discrete: an NHL total moved
 * 6.5 -> 5.5 is worth P(exactly 6 goals) (~12%), not the ~17% a normal with sigma 2.3 implies, and
 * NFL margins pile up on 3 and 7. `delta` > 0 when the new line is better for this side; the side
 * wins when R > -delta (R oriented so larger = better for the side). A residual landing exactly on
 * the new line is a push and counts half.
 */
function empShift(p, delta, sortedR) {
  if (delta === 0) return p;
  const n = sortedR.length;
  const above = x => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sortedR[m] > x) hi = m; else lo = m + 1; } return n - lo; };
  const atOrAbove = x => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sortedR[m] >= x) hi = m; else lo = m + 1; } return n - lo; };
  const S = x => (above(x) + 0.5 * (atOrAbove(x) - above(x))) / n;
  return clamp(p + S(-delta) - S(0));
}

function devigAdditive(a, b) {
  const pa = impliedProb(a), pb = impliedProb(b);
  return clamp(pa - (pa + pb - 1) / 2);
}

/** Season key: games before July belong to the season that started the previous calendar year. */
function seasonOf(sport, iso) {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  if (sport === 'wnba') return y;
  return m >= 7 ? y : y - 1;
}

/**
 * Offset logistic: logit P(y) = off + a + b*x. Newton-Raphson. Returns {a, b, seA, seB, z}.
 */
function fitOffset(rows) {
  let a = 0, b = 0, cov = [[0, 0], [0, 0]];
  for (let it = 0; it < 60; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const r of rows) {
      const p = 1 / (1 + Math.exp(-(r.off + a + b * r.x)));
      const w = p * (1 - p);
      g0 += r.y - p; g1 += (r.y - p) * r.x;
      h00 += w; h01 += w * r.x; h11 += w * r.x * r.x;
    }
    const det = h00 * h11 - h01 * h01;
    if (Math.abs(det) < 1e-12) break;
    cov = [[h11 / det, -h01 / det], [-h01 / det, h00 / det]];
    const s0 = cov[0][0] * g0 + cov[0][1] * g1, s1 = cov[1][0] * g0 + cov[1][1] * g1;
    a += s0; b += s1;
    if (Math.abs(s0) + Math.abs(s1) < 1e-10) break;
  }
  const seB = Math.sqrt(Math.max(1e-12, cov[1][1]));
  return { a, b, seA: Math.sqrt(Math.max(0, cov[0][0])), seB, z: b / seB };
}

const llOf = (rows, f) => mean(rows.map(r => logLoss(f(r), r.y)));
const sigm = x => 1 / (1 + Math.exp(-x));

/** Run the pre-declared information test for one feature on one market. */
function infoTest(rows) {
  rows = rows.filter(r => Number.isFinite(r.x) && Number.isFinite(r.off));
  if (rows.length < 150) return { n: rows.length, note: 'too few rows' };
  if (sd(rows.map(r => r.x)) === 0) return { n: rows.length, note: 'feature has no variance' };
  const cut = Math.floor(rows.length * TRAIN_FRAC);
  const train = rows.slice(0, cut), test = rows.slice(cut);
  const tr = fitOffset(train), te = fitOffset(test);
  const llClose = llOf(test, r => sigm(r.off));
  const llFit = llOf(test, r => sigm(r.off + tr.a + tr.b * r.x));
  const llSignal = llOf(test, r => sigm(r.off + tr.b * r.x));
  const passes = Math.abs(tr.z) >= GATE_Z && Math.sign(te.b) === Math.sign(tr.b) && Math.min(llFit, llSignal) < llClose;
  return {
    n: rows.length, trainN: train.length, testN: test.length, testFrom: test[0].t.slice(0, 10),
    train: { b: r3(tr.b), se: r3(tr.seB), z: r1(tr.z), lean: r3(tr.a) },
    test: { b: r3(te.b), se: r3(te.seB), z: r1(te.z) },
    testLogLoss: { close: r3(llClose), fitted: r3(llFit), signalOnly: r3(llSignal), gainBp: Math.round((llClose - Math.min(llFit, llSignal)) * 1e4) },
    xSd: r3(sd(rows.map(r => r.x))),
    passes,
  };
}

/**
 * "Beat the open" test. The close is sharper than the open in every sport, so the open -> close
 * move is information arriving. If a feature measured against the OPEN predicts that move, a bet
 * placed at the open on the feature's side collects closing line value (CLV) — the one edge that
 * shows up in hundreds of bets instead of thousands, because the close is a low-noise label.
 *
 * rows: { t, x (feature minus open, sigma units), dm (actual move open->close, same units),
 *         clvHome, clvAway (CLV in probability of betting each side at the open) }
 * Pre-declared: OLS dm ~ c + b*x fit on train; gate = |z(b)| >= 2.0 on train, same sign on test.
 * Bet rule on test: side the feature points to, only when |x| is in the top quartile of train |x|.
 */
function moveTest(rows) {
  rows = rows.filter(r => Number.isFinite(r.x) && Number.isFinite(r.dm));
  if (rows.length < 150) return { n: rows.length, note: 'too few rows' };
  if (sd(rows.map(r => r.x)) === 0) return { n: rows.length, note: 'feature has no variance' };
  const ols = rs => {
    const mx = mean(rs.map(r => r.x)), my = mean(rs.map(r => r.dm));
    const sxx = rs.reduce((s, r) => s + (r.x - mx) ** 2, 0);
    const b = rs.reduce((s, r) => s + (r.x - mx) * (r.dm - my), 0) / sxx;
    const c = my - b * mx;
    const res = rs.map(r => r.dm - c - b * r.x);
    const se = Math.sqrt(res.reduce((s, e) => s + e * e, 0) / Math.max(1, rs.length - 2) / sxx);
    return { b, c, se, z: b / se };
  };
  const cut = Math.floor(rows.length * TRAIN_FRAC);
  const train = rows.slice(0, cut), test = rows.slice(cut);
  const tr = ols(train), te = ols(test);
  const thr = [...train.map(r => Math.abs(r.x))].sort((a, b) => a - b)[Math.floor(train.length * 0.75)];
  const bets = test.filter(r => Math.abs(r.x) >= thr && Math.sign(r.x) === Math.sign(tr.b))
    .map(r => (r.x > 0 ? { grp: r.grp, clv: r.clvHome, win: r.winHome, price: r.priceHome } : { grp: r.grp, clv: r.clvAway, win: r.winAway, price: r.priceAway }))
    .filter(b => Number.isFinite(b.clv));
  const clvs = bets.map(b => b.clv);
  // Same rule applied to EVERY row (train included): the rule's only fitted parts are the sign of b
  // and the |x| threshold, so this shows whether the CLV is stable across seasons and books.
  const allBets = rows.filter(r => Math.abs(r.x) >= thr && Math.sign(r.x) === Math.sign(tr.b))
    .map(r => ({ grp: r.grp, clv: r.x > 0 ? r.clvHome : r.clvAway })).filter(b => Number.isFinite(b.clv));
  const graded = bets.filter(b => b.win !== null && b.price != null);
  return {
    n: rows.length, testFrom: test[0].t.slice(0, 10),
    train: { b: r3(tr.b), se: r3(tr.se), z: r1(tr.z) }, test: { b: r3(te.b), se: r3(te.se), z: r1(te.z) },
    passes: Math.abs(tr.z) >= GATE_Z && Math.sign(te.b) === Math.sign(tr.b),
    betAtOpen: {
      n: bets.length, threshold: r3(thr),
      avgClv: r3(mean(clvs)), clvSe: r3(sd(clvs) / Math.sqrt(Math.max(1, clvs.length))), pctPositive: r3(clvs.filter(c => c > 0).length / Math.max(1, clvs.length)),
      result: staking(graded.map(b => ({ price: b.price, profit: profit(b.win, b.price) }))),
      byGroup: Object.fromEntries([...new Set(allBets.map(b => b.grp))].sort().map(k => {
        const c = allBets.filter(b => b.grp === k).map(b => b.clv);
        return [k, { n: c.length, avgClv: r3(mean(c)), clvSe: r3(sd(c) / Math.sqrt(Math.max(1, c.length))) }];
      })),
    },
  };
}

/** Flat 1u staking at the given prices; 95% interval on ROI. */
function staking(bets) {
  const n = bets.length;
  if (!n) return { n: 0 };
  const units = bets.reduce((s, b) => s + b.profit, 0);
  const se = sd(bets.map(b => b.profit)) / Math.sqrt(n);
  const w = bets.filter(b => b.profit > 0).length;
  return { n, winPct: r3(w / n), breakEven: r3(mean(bets.map(b => impliedProb(b.price)))), roi: r3(units / n), roiLo: r3(units / n - 1.96 * se), roiHi: r3(units / n + 1.96 * se) };
}
const profit = (win, price) => (win ? americanToDecimal(price) - 1 : -1);

// ------------------------------------------------------------------ load + clean
function load(sport) {
  const file = path.join(DIR, `${sport}.json`);
  if (!fs.existsSync(file)) return null;
  const db = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [];
  let dropped = { preseason: 0, noPrice: 0 };
  for (const [id, g] of Object.entries(db.games)) {
    const [t, stype, neutral, hId, aId, hAbbr, aAbbr, hs, as] = g;
    if (stype === 1) { dropped.preseason++; continue; }
    const p = db.prices[id];
    if (!p) { dropped.noPrice++; continue; }
    const snap = arr => arr && {
      mlH: arr[0], mlA: arr[1], L: arr[2], sH: arr[3], sA: arr[4], T: arr[5], o: arr[6], u: arr[7],
    };
    const open = snap(p[1]), close = snap(p[2]);
    const has = s => s && (okPair(s.mlH, s.mlA) || (s.L != null && okPair(s.sH, s.sA)) || (s.T != null && okPair(s.o, s.u)));
    if (!has(close)) { dropped.noPrice++; continue; }
    // An open identical to the close in every field means the book recorded no separate open.
    const realOpen = open && JSON.stringify(p[1]) !== JSON.stringify(p[2]) && has(open);
    out.push({ id, t, season: seasonOf(sport, t), post: stype === 3, neutral: !!neutral, hId, aId, hAbbr, aAbbr, hs, as,
      margin: hs - as, total: hs + as, provider: p[0], open: realOpen ? open : null, close });
  }
  out.sort((x, y) => x.t.localeCompare(y.t) || x.id.localeCompare(y.id));
  return { games: out, dropped, raw: Object.keys(db.games).length };
}

// ------------------------------------------------------------------ online features (no look-ahead)
/**
 * Walk games in time order. For each game, record the pre-game state of every feature model,
 * THEN update the models with the result. Every feature is therefore knowable before tip-off.
 */
function buildFeatures(sport, games) {
  const c = CFG[sport];
  const elo = new Map(), eloSeason = new Map();
  const rat = new Map();     // EWMA: { off, def, mar, n, season }
  const last = new Map();    // team -> last game time (ms)
  let lgPts = null;          // EWMA league points per team-game
  for (const g of games) {
    for (const id of [g.hId, g.aId]) {
      if (!elo.has(id)) { elo.set(id, 1500); eloSeason.set(id, g.season); }
      if (eloSeason.get(id) !== g.season) {                          // season carry-over
        elo.set(id, 1500 + (elo.get(id) - 1500) * c.carry); eloSeason.set(id, g.season);
      }
      const r = rat.get(id);
      if (!r || r.season !== g.season) rat.set(id, { off: null, def: null, mar: 0, n: 0, season: g.season, prevMar: r ? r.mar * c.carry : 0 });
    }
    const hfa = g.neutral ? 0 : c.hfa;
    const eH = elo.get(g.hId), eA = elo.get(g.aId);
    const dElo = eH - eA + hfa;
    g.f = {};
    g.f.eloProb = 1 / (1 + Math.pow(10, -dElo / 400));
    g.f.eloMargin = dElo / c.eloPerPt;
    const rH = rat.get(g.hId), rA = rat.get(g.aId);
    const ready = rH.n >= c.minGames && rA.n >= c.minGames && lgPts != null;
    if (ready) {
      // Rolling efficiency-style rating: expected points = own offence + opponent defence - league.
      const hPts = rH.off + rA.def - lgPts, aPts = rA.off + rH.def - lgPts;
      g.f.ewmaTotal = hPts + aPts;
      g.f.ewmaMargin = rH.mar - rA.mar;          // neutral-court margin rating difference
    }
    const tms = Date.parse(g.t);
    const rest = id => (last.has(id) ? Math.min(4, Math.floor((tms - last.get(id)) / 864e5)) : 4);
    g.f.restH = rest(g.hId); g.f.restA = rest(g.aId);

    // ---- update with the result
    const mov = Math.abs(g.margin);
    const mult = Math.log(mov + 1) * (2.2 / (Math.abs(dElo) * 0.001 + 2.2));
    const exp = g.f.eloProb;
    const act = g.margin > 0 ? 1 : g.margin < 0 ? 0 : 0.5;
    const delta = c.k * (mov > 0 ? mult : 1) * (act - exp);
    elo.set(g.hId, eH + delta); elo.set(g.aId, eA - delta);
    const upd = (r, pf, pa, mar) => {
      const al = r.n === 0 ? 1 : Math.max(c.alpha, 1 / (r.n + 1));   // plain mean early, EWMA later
      r.off = r.off == null ? pf : r.off + al * (pf - r.off);
      r.def = r.def == null ? pa : r.def + al * (pa - r.def);
      r.mar = r.n === 0 ? r.prevMar * 0.5 + mar * 0.5 : r.mar + al * (mar - r.mar);
      r.n++;
    };
    const homeEdge = g.neutral ? 0 : c.hfa / c.eloPerPt;             // strip home edge from the margin rating
    upd(rH, g.hs, g.as, g.margin - homeEdge); upd(rA, g.as, g.hs, -g.margin + homeEdge);
    const ptsAvg = (g.hs + g.as) / 2;
    lgPts = lgPts == null ? ptsAvg : lgPts + 0.02 * (ptsAvg - lgPts);
    last.set(g.hId, tms); last.set(g.aId, tms);
  }
}

// ------------------------------------------------------------------ analysis
function analyse(sport) {
  const L = load(sport);
  if (!L) return null;
  const { games } = L;
  buildFeatures(sport, games);

  // Market rows at the CLOSE (and OPEN where the book recorded one).
  // Line plausibility: a total far from the sport's median (e.g. an NHL "11.5") or an open more
  // than 25% / 1.5 sigma-ish from the close is a different market, not a price move.
  const medT = (() => { const t = games.map(g => g.close.T).filter(x => x != null).sort((a, b) => a - b); return t[t.length >> 1]; })();
  const okT = T => T != null && T > medT * 0.6 && T < medT * 1.4;
  const mlRows = [], spRows = [], toRows = [];
  for (const g of games) {
    const c = g.close, o = g.open;
    if (c.T != null && !okT(c.T)) c.T = null;
    if (o && o.T != null && (!okT(o.T) || Math.abs(o.T - (c.T ?? o.T)) > Math.max(1, medT * 0.12))) o.T = null;
    if (o && o.L != null && c.L != null && Math.abs(o.L - c.L) > Math.max(3, medT * 0.06)) o.L = null;
    if (okPair(c.mlH, c.mlA) && g.margin !== 0) {
      mlRows.push({ g, t: g.t, y: g.margin > 0 ? 1 : 0, pClose: devigTwoWay(c.mlH, c.mlA, 'power'),
        pMult: devigTwoWay(c.mlH, c.mlA), pAdd: devigAdditive(c.mlH, c.mlA),
        pOpen: o && okPair(o.mlH, o.mlA) ? devigTwoWay(o.mlH, o.mlA, 'power') : null, priceH: c.mlH, priceA: c.mlA, openH: o?.mlH, openA: o?.mlA });
    }
    if (c.L != null && okPair(c.sH, c.sA) && g.margin + c.L !== 0) {
      spRows.push({ g, t: g.t, L: c.L, y: g.margin + c.L > 0 ? 1 : 0, pClose: devigTwoWay(c.sH, c.sA),
        openL: o && o.L != null && okPair(o.sH, o.sA) ? o.L : null, priceH: c.sH, priceA: c.sA, openH: o?.sH, openA: o?.sA });
    }
    if (c.T != null && okPair(c.o, c.u) && g.total !== c.T) {
      toRows.push({ g, t: g.t, T: c.T, y: g.total > c.T ? 1 : 0, pClose: devigTwoWay(c.o, c.u),
        openT: o && o.T != null && okPair(o.o, o.u) ? o.T : null, priceO: c.o, priceU: c.u, openO: o?.o, openU: o?.u });
    }
  }

  // ---- A. noise: SD of (result - close line); home cover / over base rates; sigma by spread size
  const mRes = spRows.map(r => r.g.margin + r.L), tRes = toRows.map(r => r.g.total - r.T);
  const sigma = { margin: r1(sd(mRes)), total: r1(sd(tRes)), marginBias: r1(mean(mRes)), totalBias: r1(mean(tRes)), nMargin: mRes.length, nTotal: tRes.length,
    homeCoverRate: r3(mean(spRows.map(r => r.y))), overRate: r3(mean(toRows.map(r => r.y))),
    // Raw SD of the final margin. For NHL the "spread" is always the +-1.5 puck line, so
    // SD(margin + line) is not the margin's noise; the market explains little of hockey's margin
    // variance, so the raw SD is the honest sigma there.
    marginSdRaw: r1(sd(games.map(g => g.margin))) };
  const qs = (arr, k) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(k * s.length))]; };
  const absL = spRows.map(r => Math.abs(r.L));
  const spEdges = [0, qs(absL, 0.25), qs(absL, 0.5), qs(absL, 0.75), Infinity];
  const sigmaBySpread = [];
  for (let i = 0; i < 4; i++) {
    const b = spRows.filter(r => Math.abs(r.L) >= spEdges[i] && Math.abs(r.L) < spEdges[i + 1]);
    if (b.length > 30) sigmaBySpread.push({ lo: spEdges[i], hi: spEdges[i + 1] === Infinity ? null : spEdges[i + 1], n: b.length, sigma: r1(sd(b.map(r => r.g.margin + r.L))) });
  }
  const tl = toRows.map(r => r.T);
  const tEdges = [0, qs(tl, 0.25), qs(tl, 0.5), qs(tl, 0.75), Infinity];
  const sigmaByTotal = [];
  for (let i = 0; i < 4; i++) {
    const b = toRows.filter(r => r.T >= tEdges[i] && r.T < tEdges[i + 1]);
    if (b.length > 30) sigmaByTotal.push({ lo: tEdges[i], hi: tEdges[i + 1] === Infinity ? null : tEdges[i + 1], n: b.length, sigma: r1(sd(b.map(r => r.g.total - r.T))), overRate: r3(mean(b.map(r => r.y))) });
  }

  // ---- B. de-vig method + market sharpness
  const devig = {
    n: mlRows.length,
    power: r3(llOf(mlRows, r => r.pClose)),
    multiplicative: r3(llOf(mlRows, r => r.pMult)),
    additive: r3(llOf(mlRows, r => r.pAdd)),
  };
  devig.best = ['power', 'multiplicative', 'additive'].sort((a, b) => devig[a] - devig[b])[0];
  const withOpen = mlRows.filter(r => r.pOpen != null && Math.abs(r.pOpen - r.pClose) > 1e-9);
  const sharpness = withOpen.length > 100 ? {
    n: withOpen.length, openLogLoss: r3(llOf(withOpen, r => r.pOpen)), closeLogLoss: r3(llOf(withOpen, r => r.pClose)),
    avgAbsMoveProb: r3(mean(withOpen.map(r => Math.abs(r.pClose - r.pOpen)))),
  } : null;

  // Calibration of the close ML (favourite-longshot bias) + flat ROI by price bucket.
  const buckets = [[0, 0.2], [0.2, 0.35], [0.35, 0.5], [0.5, 0.65], [0.65, 0.8], [0.8, 1]];
  const sides = mlRows.flatMap(r => [
    { p: r.pClose, y: r.y, price: r.priceH }, { p: 1 - r.pClose, y: 1 - r.y, price: r.priceA },
  ]);
  const calibration = buckets.map(([lo, hi]) => {
    const b = sides.filter(s => s.p >= lo && s.p < hi);
    return { lo, hi, n: b.length, fair: r3(mean(b.map(s => s.p))), actual: r3(mean(b.map(s => s.y))), roi: staking(b.map(s => ({ price: s.price, profit: profit(s.y === 1, s.price) }))).roi };
  }).filter(b => b.n > 0);

  // ---- C/D. information tests vs the close
  const sig = { margin: sigma.margin, total: sigma.total };
  const tests = { ml: {}, spread: {}, total: {} };
  const c = CFG[sport];
  // ML
  tests.ml.elo = infoTest(mlRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: probit(r.g.f.eloProb) - probit(r.pClose) })));
  tests.ml.ewmaRating = infoTest(mlRows.filter(r => r.g.f.ewmaMargin != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose),
    x: (r.g.f.ewmaMargin + (r.g.neutral ? 0 : c.hfa / c.eloPerPt)) / sig.margin - probit(r.pClose) })));
  tests.ml.restDiff = infoTest(mlRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: r.g.f.restH - r.g.f.restA })));
  tests.ml.lineMove = infoTest(mlRows.filter(r => r.pOpen != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: probit(r.pClose) - probit(r.pOpen) })));
  // Spread (home covers the close line)
  tests.spread.elo = infoTest(spRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.g.f.eloMargin + r.L) / sig.margin })));
  tests.spread.ewmaRating = infoTest(spRows.filter(r => r.g.f.ewmaMargin != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose),
    x: (r.g.f.ewmaMargin + (r.g.neutral ? 0 : c.hfa / c.eloPerPt) + r.L) / sig.margin })));
  tests.spread.restDiff = infoTest(spRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: r.g.f.restH - r.g.f.restA })));
  tests.spread.backToBack = infoTest(spRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.g.f.restA <= 1 ? 1 : 0) - (r.g.f.restH <= 1 ? 1 : 0) })));
  tests.spread.lineMove = infoTest(spRows.filter(r => r.openL != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.openL - r.L) / sig.margin })));
  tests.spread.homeDog = infoTest(spRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: r.L > 0 && !r.g.neutral ? 1 : 0 })));
  tests.spread.bigLine = infoTest(spRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: Math.sign(-r.L) * Math.min(Math.abs(r.L), 3 * sig.margin) / sig.margin })));
  // Total (over the close line)
  tests.total.ewmaPace = infoTest(toRows.filter(r => r.g.f.ewmaTotal != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.g.f.ewmaTotal - r.T) / sig.total })));
  tests.total.lineMove = infoTest(toRows.filter(r => r.openT != null).map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.T - r.openT) / sig.total })));
  tests.total.fatigue = infoTest(toRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.g.f.restH <= 1 ? 1 : 0) + (r.g.f.restA <= 1 ? 1 : 0) })));
  tests.total.lineLevel = infoTest(toRows.map(r => ({ t: r.t, y: r.y, off: logit(r.pClose), x: (r.T - mean(tl)) / sig.total })));

  // Oriented residuals for the empirical line shift (home side / over side = +R; away / under = -R).
  const srt = a => [...a].sort((x, y) => x - y);
  const RspH = srt(mRes), RspA = srt(mRes.map(x => -x)), RtoO = srt(tRes), RtoU = srt(tRes.map(x => -x));
  const shiftCheck = {
    // Normal vs empirical value of a one-unit move off the median line, for the report.
    spreadOnePoint: { normal: r3(shiftProb(0.5, 1, sig.margin) - 0.5), empirical: r3(empShift(0.5, 1, RspH) - 0.5) },
    totalOneUnit: { normal: r3(shiftProb(0.5, 1, sig.total) - 0.5), empirical: r3(empShift(0.5, 1, RtoO) - 0.5) },
  };

  // ---- E. beat the open: does a feature, measured against the OPEN, predict where the line goes?
  const moves = { ml: {}, spread: {}, total: {} };
  const mlO = mlRows.filter(r => r.pOpen != null);
  const mlMove = fx => moveTest(mlO.map(r => ({
    t: r.t, grp: `${r.g.season} ${r.g.provider}`, x: fx(r) - probit(r.pOpen), dm: probit(r.pClose) - probit(r.pOpen),
    clvHome: r.pClose - impliedProb(r.openH), clvAway: (1 - r.pClose) - impliedProb(r.openA),
    winHome: r.y === 1, winAway: r.y === 0, priceHome: r.openH, priceAway: r.openA,
  })));
  moves.ml.elo = mlMove(r => probit(r.g.f.eloProb));
  moves.ml.ewmaRating = mlMove(r => (r.g.f.ewmaMargin == null ? NaN : (r.g.f.ewmaMargin + (r.g.neutral ? 0 : c.hfa / c.eloPerPt)) / sig.margin));
  moves.ml.restDiff = moveTest(mlO.map(r => ({ t: r.t, grp: `${r.g.season} ${r.g.provider}`, x: r.g.f.restH - r.g.f.restA, dm: probit(r.pClose) - probit(r.pOpen),
    clvHome: r.pClose - impliedProb(r.openH), clvAway: (1 - r.pClose) - impliedProb(r.openA), winHome: r.y === 1, winAway: r.y === 0, priceHome: r.openH, priceAway: r.openA })));
  const spO = spRows.filter(r => r.openL != null);
  const spMove = fx => moveTest(spO.map(r => {
    const cover = r.g.margin + r.openL;
    return {
      t: r.t, grp: `${r.g.season} ${r.g.provider}`, x: fx(r), dm: (r.openL - r.L) / sig.margin,
      // Fair prob of each side AT THE OPEN LINE, from the close market moved to that line.
      clvHome: empShift(r.pClose, r.openL - r.L, RspH) - impliedProb(r.openH),
      clvAway: empShift(1 - r.pClose, r.L - r.openL, RspA) - impliedProb(r.openA),
      winHome: cover === 0 ? null : cover > 0, winAway: cover === 0 ? null : cover < 0, priceHome: r.openH, priceAway: r.openA,
    };
  }));
  moves.spread.elo = spMove(r => (r.g.f.eloMargin + r.openL) / sig.margin);
  moves.spread.ewmaRating = spMove(r => (r.g.f.ewmaMargin == null ? NaN : (r.g.f.ewmaMargin + (r.g.neutral ? 0 : c.hfa / c.eloPerPt) + r.openL) / sig.margin));
  moves.spread.restDiff = spMove(r => r.g.f.restH - r.g.f.restA);
  moves.spread.backToBack = spMove(r => (r.g.f.restA <= 1 ? 1 : 0) - (r.g.f.restH <= 1 ? 1 : 0));
  const toO = toRows.filter(r => r.openT != null);
  const toMove = fx => moveTest(toO.map(r => {
    const d = r.g.total - r.openT;
    return {
      t: r.t, grp: `${r.g.season} ${r.g.provider}`, x: fx(r), dm: (r.T - r.openT) / sig.total,
      clvHome: empShift(r.pClose, r.T - r.openT, RtoO) - impliedProb(r.openO),     // "home" = over
      clvAway: empShift(1 - r.pClose, r.openT - r.T, RtoU) - impliedProb(r.openU),
      winHome: d === 0 ? null : d > 0, winAway: d === 0 ? null : d < 0, priceHome: r.openO, priceAway: r.openU,
    };
  }));
  moves.total.ewmaPace = toMove(r => (r.g.f.ewmaTotal == null ? NaN : (r.g.f.ewmaTotal - r.openT) / sig.total));
  moves.total.fatigue = toMove(r => (r.g.f.restH <= 1 ? 1 : 0) + (r.g.f.restA <= 1 ? 1 : 0));

  // Raw model accuracy (how good is each fixed-form model on its own, before the market?)
  const standalone = {
    eloMlLogLoss: r3(llOf(mlRows, r => r.g.f.eloProb)), closeMlLogLoss: r3(llOf(mlRows, r => r.pClose)),
    eloMarginMae: r1(mean(spRows.map(r => Math.abs(r.g.margin - r.g.f.eloMargin)))), closeMarginMae: r1(mean(spRows.map(r => Math.abs(r.g.margin + r.L)))),
    ewmaTotalMae: r1(mean(toRows.filter(r => r.g.f.ewmaTotal != null).map(r => Math.abs(r.g.total - r.g.f.ewmaTotal)))),
    closeTotalMae: r1(mean(toRows.filter(r => r.g.f.ewmaTotal != null).map(r => Math.abs(r.g.total - r.T)))),
  };

  const seasons = {};
  for (const g of games) seasons[g.season] = (seasons[g.season] ?? 0) + 1;
  return {
    sport, rawGames: L.raw, usable: games.length, dropped: L.dropped, seasons,
    from: games[0]?.t.slice(0, 10), to: games.at(-1)?.t.slice(0, 10),
    providers: Object.fromEntries([...new Set(games.map(g => g.provider))].map(p => [p, games.filter(g => g.provider === p).length])),
    rows: { ml: mlRows.length, spread: spRows.length, total: toRows.length, withRealOpen: games.filter(g => g.open).length },
    sigma, sigmaBySpread, sigmaByTotal, devig, sharpness, calibration, standalone, tests, moves, shiftCheck,
  };
}

// ------------------------------------------------------------------ main
const SPORTS = (process.argv.slice(2).length ? process.argv.slice(2) : ['nfl', 'nba', 'nhl', 'cbb', 'wnba'])
  .filter(s => fs.existsSync(path.join(DIR, `${s}.json`)));
const out = { generated: new Date().toISOString(), trainFrac: TRAIN_FRAC, gateZ: GATE_Z, sports: {} };
for (const s of SPORTS) out.sports[s] = analyse(s);
const file = `docs/reports/${out.generated.slice(0, 10)}-market-lab.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');

// Compact summary bundled into the /ev page (src/data/market-lab.json).
const summary = { generated: out.generated, gateZ: GATE_Z, sports: {} };
for (const [s, v] of Object.entries(out.sports)) {
  const close = Object.entries(v.tests).flatMap(([mk, f]) => Object.entries(f).filter(([, t]) => t.train).map(([k, t]) => ({ name: `${mk}.${k}`, ...t })));
  const move = Object.entries(v.moves).flatMap(([mk, f]) => Object.entries(f).filter(([, t]) => t.train).map(([k, t]) => ({ name: `${mk}.${k}`, ...t })));
  const openBets = move.filter(t => t.betAtOpen?.n >= 30).map(t => {
    const groups = Object.values(t.betAtOpen.byGroup).filter(g => g.n >= 30);
    return { name: t.name, n: t.betAtOpen.n, clv: t.betAtOpen.avgClv, se: t.betAtOpen.clvSe, roi: t.betAtOpen.result.roi,
      // A real edge should hold at every book and season, not one.
      stable: groups.length >= 2 && groups.every(g => g.avgClv > 0),
      // Pre-declared: an edge = CLV more than 2 SE above zero AND positive at every book-season.
      edge: t.betAtOpen.avgClv - 2 * t.betAtOpen.clvSe > 0 && groups.length >= 2 && groups.every(g => g.avgClv > 0) };
  }).sort((a, b) => b.clv - a.clv);
  summary.sports[s] = {
    games: v.usable, from: v.from, to: v.to, sigma: v.sigma, devig: v.devig.best,
    sharpness: v.sharpness && { open: v.sharpness.openLogLoss, close: v.sharpness.closeLogLoss, n: v.sharpness.n },
    beatClose: { tested: close.length, passed: close.filter(t => t.passes).map(t => t.name) },
    predictsMove: { tested: move.length, passed: move.filter(t => t.passes).map(t => t.name) },
    bestAtOpen: openBets[0] ?? null,
  };
}
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/market-lab.json', JSON.stringify(summary) + '\n');

for (const [s, v] of Object.entries(out.sports)) {
  console.log(`\n== ${s.toUpperCase()}  ${v.usable}/${v.rawGames} games ${v.from}..${v.to}  rows ml ${v.rows.ml} sp ${v.rows.spread} tot ${v.rows.total} realOpen ${v.rows.withRealOpen}`);
  console.log(`  sigma margin ${v.sigma.margin} (bias ${v.sigma.marginBias}, home covers ${v.sigma.homeCoverRate})  total ${v.sigma.total} (bias ${v.sigma.totalBias}, over ${v.sigma.overRate})`);
  console.log(`  sigma by |spread| ${v.sigmaBySpread.map(b => `${b.lo}-${b.hi ?? '+'}:${b.sigma}`).join('  ')}`);
  console.log(`  sigma by total    ${v.sigmaByTotal.map(b => `${b.lo}-${b.hi ?? '+'}:${b.sigma}(o ${b.overRate})`).join('  ')}`);
  console.log(`  devig logloss power ${v.devig.power} mult ${v.devig.multiplicative} add ${v.devig.additive} -> ${v.devig.best}`);
  if (v.sharpness) console.log(`  open vs close logloss ${v.sharpness.openLogLoss} -> ${v.sharpness.closeLogLoss} (n ${v.sharpness.n}, avg move ${v.sharpness.avgAbsMoveProb})`);
  console.log(`  calibration ${v.calibration.map(b => `${b.lo}-${b.hi}: fair ${b.fair} act ${b.actual} roi ${b.roi} (n ${b.n})`).join(' | ')}`);
  console.log(`  standalone ${JSON.stringify(v.standalone)}`);
  console.log(`  one-unit line value normal vs empirical: spread ${JSON.stringify(v.shiftCheck.spreadOnePoint)} total ${JSON.stringify(v.shiftCheck.totalOneUnit)}`);
  for (const [mk, fs_] of Object.entries(v.tests)) for (const [f, t] of Object.entries(fs_)) {
    if (!t.train) { console.log(`  ${mk}.${f}: ${t.note} (${t.n})`); continue; }
    console.log(`  ${(mk + '.' + f).padEnd(20)} n ${String(t.n).padStart(5)}  train b ${t.train.b}±${t.train.se} z ${String(t.train.z).padStart(5)} | test b ${t.test.b} z ${t.test.z} | ll close ${t.testLogLoss.close} fit ${t.testLogLoss.fitted} sig ${t.testLogLoss.signalOnly} (${t.testLogLoss.gainBp}bp) ${t.passes ? 'PASS' : ''}`);
  }
  for (const [mk, fs_] of Object.entries(v.moves)) for (const [f, t] of Object.entries(fs_)) {
    if (!t.train) { console.log(`  MOVE ${mk}.${f}: ${t.note} (${t.n})`); continue; }
    const b = t.betAtOpen;
    console.log(`  MOVE ${(mk + '.' + f).padEnd(18)} n ${String(t.n).padStart(5)} train b ${t.train.b} z ${String(t.train.z).padStart(5)} | test b ${t.test.b} z ${t.test.z} ${t.passes ? 'PASS' : '    '} | bet@open n ${b.n} CLV ${b.avgClv}±${b.clvSe} (+${b.pctPositive}) ROI ${b.result.roi} [${b.result.roiLo}, ${b.result.roiHi}]`);
  }
}
console.log(`\nwrote ${file}`);
