#!/usr/bin/env node
/**
 * EV ledger — grade every stored pick at the PRICE it could actually be bet at, and ask the only
 * question that matters for betting: does the model add information the market doesn't have?
 *
 *   npm run ev-ledger              # nfl + wnba (the sports whose graded rows live in the blobs)
 *   npm run ev-ledger -- nfl       # one sport
 *
 * Steps (all real data, no mocks):
 *   1. Load graded results from the live blob (same source as the site's results pages).
 *   2. Backfill DraftKings/ESPN BET open + close prices for each game from ESPN's core odds API,
 *      cached in data/price-history/<sport>.json (append-only; a game's close never changes).
 *   3. Measure each sport's noise (sigma of actual result minus closing line).
 *   4. Re-grade the site's picks at real prices: ATS/O-U at the close juice, ML at the close ML.
 *   5. Walk-forward information test: fit the model-vs-market blend weight on the first 60% of
 *      games (chronological), score it on the last 40%. Weight ~0 = the model adds nothing.
 *   6. Pre-declared EV rule on the held-out 40% only: bet a side when blended EV >= MIN_EV at the
 *      close price. Also CLV: had we bet the site's pick at the OPEN, did the close move our way?
 *
 * Writes docs/reports/<date>-ev-ledger.json. The HTML/PNG report is rendered from that file.
 * Imports src/lib/*.ts directly (Node 22.18+ strips types natively).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  devigTwoWay, americanToDecimal, impliedProb, probHomeCovers, probOver, blendWithMarket,
  expectedValue, clvProb, shiftProb, brier, logLoss, invNormCdf,
} from '../src/lib/fair-value.ts';
import { parseEspnPrices, espnOddsUrl } from '../src/lib/espn-prices.ts';

const BASE = process.env.PM_BASE || 'https://www.predictionmatrix.com';
const BLOBS = { nfl: 'prediction-matrix-data.json', wnba: 'wnba-prediction-data.json' };
// Live boundaries + preseason spans from the 2026-09-11 edge ledger (docs/reports/2026-09-11-edge-stats.json).
const LEDGER = JSON.parse(fs.readFileSync('docs/reports/2026-09-11-edge-stats.json', 'utf8'));
const TRAIN_FRAC = 0.6;
const MIN_EV = 0.02;
const GATE_Z = 1.5;         // pre-declared: minimum train z of the model's signal to earn live weight          // pre-declared: 2% expected return per unit, at the close price
const ROOT = process.cwd();

const sports = process.argv.slice(2).filter(a => BLOBS[a]);
const SPORTS = sports.length ? sports : Object.keys(BLOBS);

// ------------------------------------------------------------------ price backfill (cached)
async function backfillPrices(sport, gameIds) {
  const file = path.join(ROOT, 'data/price-history', `${sport}.json`);
  const cache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const todo = gameIds.filter(id => !(id in cache));
  let fetched = 0, missing = 0;
  const worker = async () => {
    while (todo.length) {
      const id = todo.shift();
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(espnOddsUrl(sport, id));
          if (res.status === 404) { cache[id] = null; missing++; break; }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = await res.json();
          const prices = parseEspnPrices(json.items?.[0]);
          cache[id] = prices; prices ? fetched++ : missing++;
          break;
        } catch (e) {
          if (attempt === 2) { console.warn(`  ${sport} ${id}: ${e.message} (left uncached)`); }
          else await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = Object.fromEntries(Object.keys(cache).sort().map(k => [k, cache[k]]));
  fs.writeFileSync(file, JSON.stringify(sorted, null, 0) + '\n');
  return { cache, fetched, missing, cached: gameIds.length - fetched - missing };
}

// ------------------------------------------------------------------ small stats helpers
const mean = a => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const r3 = x => Math.round(x * 1000) / 1000;
const r1 = x => Math.round(x * 10) / 10;

/** Flat 1-unit staking summary with a 95% interval on ROI (normal approx on per-bet profit). */
function staking(bets) {
  const graded = bets.filter(b => b.profit !== null);
  const w = graded.filter(b => b.profit > 0).length;
  const l = graded.filter(b => b.profit < 0).length;
  const p = graded.length - w - l;
  const profits = graded.map(b => b.profit);
  const units = profits.reduce((s, x) => s + x, 0);
  const n = graded.length;
  const roi = n ? units / n : 0;
  const se = n > 1 ? sd(profits) / Math.sqrt(n) : 0;
  const avgPrice = n ? mean(graded.map(b => impliedProb(b.price))) : 0;
  return {
    n, w, l, p, winPct: n ? r3(w / Math.max(1, w + l)) : 0, breakEven: r3(avgPrice),
    units: r1(units), roi: r3(roi), roiLo: r3(roi - 1.96 * se), roiHi: r3(roi + 1.96 * se),
    avgEv: n && graded[0].ev !== undefined ? r3(mean(graded.map(b => b.ev))) : undefined,
  };
}

function profitAt(outcome, american) {           // outcome: 1 win, 0 loss, 0.5 push
  if (outcome === 0.5) return 0;
  return outcome === 1 ? americanToDecimal(american) - 1 : -1;
}

/** One-parameter walk-forward fit: blend weight w in [0,1] minimising log loss on TRAIN. */
function fitWeight(rows) {
  let best = { w: 0, ll: Infinity };
  for (let w = 0; w <= 1.0001; w += 0.05) {
    const ll = mean(rows.map(r => logLoss(blendWithMarket(r.pModel, r.pMkt, w), r.y)));
    if (ll < best.ll) best = { w: r3(w), ll };
  }
  return best.w;
}

/**
 * Signal-beyond-bias test. Logistic regression with the market as an OFFSET:
 *   logit P(y) = logit(pMkt) + a + b * z,   z = probit(pModel) - probit(pMkt)
 * `a` soaks up any constant lean (e.g. the pre-freeze model picking the over 93% of the time), so
 * only `b` measures information the market doesn't already price. Fit on TRAIN (Newton-Raphson),
 * report b with its standard error, and score the fitted model on TEST against the market alone.
 */
function signalTest(train, test) {
  const lg = p => Math.log(p / (1 - p));
  const feats = r => [1, invNormCdf(Math.min(0.99, Math.max(0.01, r.pModel))) - invNormCdf(Math.min(0.99, Math.max(0.01, r.pMkt)))];
  let beta = [0, 0], cov = [[0, 0], [0, 0]];
  for (let it = 0; it < 50; it++) {
    const g = [0, 0], H = [[0, 0], [0, 0]];
    for (const r of train) {
      const x = feats(r);
      const p = 1 / (1 + Math.exp(-(lg(Math.min(0.99, Math.max(0.01, r.pMkt))) + beta[0] * x[0] + beta[1] * x[1])));
      for (let i = 0; i < 2; i++) { g[i] += (r.y - p) * x[i]; for (let j = 0; j < 2; j++) H[i][j] += p * (1 - p) * x[i] * x[j]; }
    }
    const det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
    if (Math.abs(det) < 1e-12) break;
    cov = [[H[1][1] / det, -H[0][1] / det], [-H[1][0] / det, H[0][0] / det]];
    const step = [cov[0][0] * g[0] + cov[0][1] * g[1], cov[1][0] * g[0] + cov[1][1] * g[1]];
    beta = [beta[0] + step[0], beta[1] + step[1]];
    if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-9) break;
  }
  const pred = r => { const x = feats(r); return 1 / (1 + Math.exp(-(lg(Math.min(0.99, Math.max(0.01, r.pMkt))) + beta[0] * x[0] + beta[1] * x[1]))); };
  const pSignalOnly = r => { const x = feats(r); return 1 / (1 + Math.exp(-(lg(Math.min(0.99, Math.max(0.01, r.pMkt))) + beta[1] * x[1]))); };
  return {
    intercept: r3(beta[0]), interceptSe: r3(Math.sqrt(Math.max(0, cov[0][0]))),
    signal: r3(beta[1]), signalSe: r3(Math.sqrt(Math.max(0, cov[1][1]))),
    signalZ: r1(beta[1] / Math.sqrt(Math.max(1e-12, cov[1][1]))),
    testLogLoss: { market: r3(mean(test.map(r => logLoss(r.pMkt, r.y)))), fitted: r3(mean(test.map(r => logLoss(pred(r), r.y)))), signalOnly: r3(mean(test.map(r => logLoss(pSignalOnly(r), r.y)))) },
  };
}

function scoring(rows, w) {
  const s = f => ({ brier: r3(mean(rows.map(r => brier(f(r), r.y))) * 1000) / 1000, logLoss: r3(mean(rows.map(r => logLoss(f(r), r.y)))) });
  return {
    n: rows.length,
    model: s(r => r.pModel),
    market: s(r => r.pMkt),
    blend: s(r => blendWithMarket(r.pModel, r.pMkt, w)),
  };
}

/** Reliability table: model probability buckets vs how often it actually happened. */
function reliability(rows, key) {
  const edges = [0, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 1.0001];
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const b = rows.filter(r => r[key] >= edges[i] && r[key] < edges[i + 1]);
    if (b.length) out.push({ lo: edges[i], hi: Math.min(1, edges[i + 1]), n: b.length, predicted: r3(mean(b.map(r => r[key]))), actual: r3(mean(b.map(r => r.y))) });
  }
  return out;
}

// ------------------------------------------------------------------ per-sport analysis
async function analyse(sport) {
  const blob = await (await fetch(`${BASE}/${BLOBS[sport]}`, { cache: 'no-store' })).json();
  const meta = LEDGER.sports[sport];
  const [preFrom, preTo] = meta.preseason_span || [null, null];
  const liveFrom = LEDGER.live_boundary[sport];
  const all = (blob.backtest?.results || [])
    .filter(r => r.gameId && r.actualHomeScore !== undefined)
    .filter(r => !(preFrom && r.gameTime.slice(0, 10) >= preFrom && r.gameTime.slice(0, 10) <= preTo))
    .sort((a, b) => a.gameTime.localeCompare(b.gameTime));

  const pb = await backfillPrices(sport, all.map(r => r.gameId));
  console.log(`${sport}: ${all.length} graded rows · prices fetched ${pb.fetched}, cached ${pb.cached}, unavailable ${pb.missing}`);

  // Join rows with prices; derive market + model probabilities at the CLOSE.
  const games = [];
  for (const r of all) {
    const pr = pb.cache[r.gameId];
    if (!pr) continue;
    const c = pr.close, o = pr.open;
    const margin = r.actualHomeScore - r.actualAwayScore;
    const total = r.actualHomeScore + r.actualAwayScore;
    games.push({ r, c, o, margin, total, live: r.gameTime.slice(0, 10) >= liveFrom, frozen: r.modelVersion != null });
  }

  // 3. Noise of the sport, measured against the closing line (not tuned).
  const mRes = games.filter(g => g.c.spreadLine !== undefined).map(g => g.margin + g.c.spreadLine);
  const tRes = games.filter(g => g.c.totalLine !== undefined).map(g => g.total - g.c.totalLine);
  const sigma = { margin: r1(sd(mRes)), total: r1(sd(tRes)), marginBias: r1(mean(mRes)), totalBias: r1(mean(tRes)), n: mRes.length };

  // 4. The site's own picks, re-graded at the real close price.
  const ats = [], ou = [], ml = [], atsOpen = [], ouOpen = [], mlOpen = [], atsPickOpen = [], ouPickOpen = [];
  // 5/6. Probability rows for the information test, per market.
  const probRows = { ml: [], spread: [], total: [] };

  for (const g of games) {
    const { r, c, o } = g;
    // --- moneyline
    if (c.mlHome !== undefined && c.mlAway !== undefined && r.homeWinProb != null) {
      const pMkt = devigTwoWay(c.mlHome, c.mlAway, 'power');
      const y = g.margin > 0 ? 1 : 0;
      if (g.margin !== 0) probRows.ml.push({ id: r.gameId, t: r.gameTime, live: g.live, pModel: r.homeWinProb, pMkt, y, priceA: c.mlHome, priceB: c.mlAway });
      const home = r.homeWinProb >= 0.5;
      const price = home ? c.mlHome : c.mlAway;
      const out = g.margin === 0 ? 0.5 : (home === g.margin > 0 ? 1 : 0);
      ml.push({ live: g.live, fav: impliedProb(price) > 0.5, price, profit: profitAt(out, price) });
      if (o.mlHome !== undefined && o.mlAway !== undefined) {
        const oPrice = home ? o.mlHome : o.mlAway;
        mlOpen.push({ live: g.live, price: oPrice, profit: profitAt(out, oPrice), clv: clvProb(oPrice, home ? pMkt : 1 - pMkt) });
      }
    }
    // --- spread (home line)
    if (c.spreadLine !== undefined && c.spreadHomePrice !== undefined && c.spreadAwayPrice !== undefined) {
      const L = c.spreadLine;
      const pMkt = devigTwoWay(c.spreadHomePrice, c.spreadAwayPrice);
      const cover = g.margin + L;
      const pModel = probHomeCovers(r.predictedSpread, L, sigma.margin);
      if (cover !== 0) probRows.spread.push({ id: r.gameId, t: r.gameTime, live: g.live, pModel, pMkt, y: cover > 0 ? 1 : 0, priceA: c.spreadHomePrice, priceB: c.spreadAwayPrice });
      // Honest "bet early" test: choose the side against the OPEN line, take the open price,
      // then compare with the close market (moved to the open line).
      if (o.spreadLine !== undefined && o.spreadHomePrice !== undefined && o.spreadAwayPrice !== undefined && r.predictedSpread !== o.spreadLine) {
        const hO = r.predictedSpread < o.spreadLine;
        const oCover = g.margin + o.spreadLine;
        const oPrice = hO ? o.spreadHomePrice : o.spreadAwayPrice;
        const pts = hO ? o.spreadLine - L : L - o.spreadLine;
        atsPickOpen.push({ live: g.live, price: oPrice, profit: profitAt(oCover === 0 ? 0.5 : (hO === oCover > 0 ? 1 : 0), oPrice), clv: clvProb(oPrice, shiftProb(hO ? pMkt : 1 - pMkt, pts, sigma.margin)), clvPts: pts });
      }
      const home = r.predictedSpread < L;
      if (r.predictedSpread !== L) {
        const out = cover === 0 ? 0.5 : (home === cover > 0 ? 1 : 0);
        const price = home ? c.spreadHomePrice : c.spreadAwayPrice;
        ats.push({ live: g.live, price, profit: profitAt(out, price) });
        if (o.spreadLine !== undefined && o.spreadHomePrice !== undefined) {
          const oPrice = home ? o.spreadHomePrice : o.spreadAwayPrice;
          const oCover = g.margin + o.spreadLine;
          const oOut = oCover === 0 ? 0.5 : (home === oCover > 0 ? 1 : 0);
          // Fair prob of our side at the OPEN line, from the close market shifted by the line move.
          const pSideClose = home ? pMkt : 1 - pMkt;
          const pts = home ? o.spreadLine - L : L - o.spreadLine;
          atsOpen.push({ live: g.live, price: oPrice, profit: profitAt(oOut, oPrice), clv: clvProb(oPrice, shiftProb(pSideClose, pts, sigma.margin)), clvPts: pts });
        }
      }
    }
    // --- total
    if (c.totalLine !== undefined && c.overPrice !== undefined && c.underPrice !== undefined) {
      const T = c.totalLine;
      const pMkt = devigTwoWay(c.overPrice, c.underPrice);
      const diff = g.total - T;
      const pModel = probOver(r.predictedTotal, T, sigma.total);
      if (diff !== 0) probRows.total.push({ id: r.gameId, t: r.gameTime, live: g.live, pModel, pMkt, y: diff > 0 ? 1 : 0, priceA: c.overPrice, priceB: c.underPrice });
      if (o.totalLine !== undefined && o.overPrice !== undefined && o.underPrice !== undefined && r.predictedTotal !== o.totalLine) {
        const ovO = r.predictedTotal > o.totalLine;
        const oDiff = g.total - o.totalLine;
        const oPrice = ovO ? o.overPrice : o.underPrice;
        const pts = ovO ? T - o.totalLine : o.totalLine - T;
        ouPickOpen.push({ live: g.live, price: oPrice, profit: profitAt(oDiff === 0 ? 0.5 : (ovO === oDiff > 0 ? 1 : 0), oPrice), clv: clvProb(oPrice, shiftProb(ovO ? pMkt : 1 - pMkt, pts, sigma.total)), clvPts: pts });
      }
      if (r.predictedTotal !== T) {
        const over = r.predictedTotal > T;
        const out = diff === 0 ? 0.5 : (over === diff > 0 ? 1 : 0);
        const price = over ? c.overPrice : c.underPrice;
        ou.push({ live: g.live, price, profit: profitAt(out, price) });
        if (o.totalLine !== undefined && o.overPrice !== undefined) {
          const oPrice = over ? o.overPrice : o.underPrice;
          const oDiff = g.total - o.totalLine;
          const oOut = oDiff === 0 ? 0.5 : (over === oDiff > 0 ? 1 : 0);
          const pSideClose = over ? pMkt : 1 - pMkt;
          const pts = over ? T - o.totalLine : o.totalLine - T;
          ouOpen.push({ live: g.live, price: oPrice, profit: profitAt(oOut, oPrice), clv: clvProb(oPrice, shiftProb(pSideClose, pts, sigma.total)), clvPts: pts });
        }
      }
    }
  }

  const clvSummary = bets => bets.length ? {
    n: bets.length, avgClvProb: r3(mean(bets.map(b => b.clv))), pctPositive: r3(bets.filter(b => b.clv > 0).length / bets.length),
    avgClvPts: bets[0].clvPts !== undefined ? r1(mean(bets.map(b => b.clvPts)) * 10) / 10 : undefined,
  } : null;

  const sitePicks = {
    ats: { close: staking(ats), closeLive: staking(ats.filter(b => b.live)), open: staking(atsOpen), clv: clvSummary(atsOpen), pickAtOpen: staking(atsPickOpen), pickAtOpenClv: clvSummary(atsPickOpen) },
    ou: { close: staking(ou), closeLive: staking(ou.filter(b => b.live)), open: staking(ouOpen), clv: clvSummary(ouOpen), pickAtOpen: staking(ouPickOpen), pickAtOpenClv: clvSummary(ouPickOpen) },
    ml: {
      close: staking(ml), closeLive: staking(ml.filter(b => b.live)), open: staking(mlOpen), clv: clvSummary(mlOpen),
      favorites: staking(ml.filter(b => b.fav)), underdogs: staking(ml.filter(b => !b.fav)),
      atFlatMinus110: staking(ml.map(b => ({ ...b, price: -110, profit: b.profit === 0 ? 0 : b.profit > 0 ? 100 / 110 : -1 }))),
    },
  };

  // 5 + 6. Walk-forward information test and the pre-declared EV rule, per market.
  const markets = {};
  for (const [mk, rows] of Object.entries(probRows)) {
    if (rows.length < 40) { markets[mk] = { n: rows.length, note: 'too few rows' }; continue; }
    const cut = Math.floor(rows.length * TRAIN_FRAC);
    const train = rows.slice(0, cut), test = rows.slice(cut);
    const w = fitWeight(train);
    const sig = signalTest(train, test);
    const gate = Math.abs(sig.signalZ) >= GATE_Z && sig.testLogLoss.signalOnly < sig.testLogLoss.market;
    const bets = [];
    for (const r of test) {
      const p = blendWithMarket(r.pModel, r.pMkt, w);
      const evA = expectedValue(p, r.priceA), evB = expectedValue(1 - p, r.priceB);
      const [ev, price, win] = evA >= evB ? [evA, r.priceA, r.y === 1] : [evB, r.priceB, r.y === 0];
      if (ev >= MIN_EV) bets.push({ ev, price, profit: win ? americanToDecimal(price) - 1 : -1, live: r.live });
    }
    // Same rule with the RAW model (w = 1): what the site would do if it trusted itself fully.
    const rawBets = [];
    for (const r of test) {
      const evA = expectedValue(r.pModel, r.priceA), evB = expectedValue(1 - r.pModel, r.priceB);
      const [ev, price, win] = evA >= evB ? [evA, r.priceA, r.y === 1] : [evB, r.priceB, r.y === 0];
      if (ev >= MIN_EV) rawBets.push({ ev, price, profit: win ? americanToDecimal(price) - 1 : -1 });
    }
    // Edge buckets on ALL rows: does a bigger model-vs-market disagreement predict the outcome?
    const buckets = [[0, 0.03], [0.03, 0.06], [0.06, 0.1], [0.1, 0.15], [0.15, 1]].map(([lo, hi]) => {
      const b = rows.filter(r => Math.abs(r.pModel - r.pMkt) >= lo && Math.abs(r.pModel - r.pMkt) < hi);
      // "hit" = the side the model leans relative to the market actually happened.
      const hits = b.filter(r => (r.pModel > r.pMkt) === (r.y === 1)).length;
      const mktSide = mean(b.map(r => (r.pModel > r.pMkt ? r.pMkt : 1 - r.pMkt)));
      return { lo, hi, n: b.length, modelSideHit: b.length ? r3(hits / b.length) : null, marketSaid: b.length ? r3(mktSide) : null };
    });
    markets[mk] = {
      n: rows.length, trainN: train.length, testN: test.length, testFrom: test[0].t.slice(0, 10),
      weight: w, trainScore: scoring(train, w), testScore: scoring(test, w), signalTest: sig,
      // Pre-declared gate for the LIVE rule (src/lib/ev-model.ts): the model earns weight only if
      // its signal is |z| >= GATE_Z on train AND it lowers held-out log loss vs the market alone.
      // Passing markets get the weight fit on ALL rows; failing markets defer to the price (w = 0).
      gate: { passes: gate, liveWeight: gate ? fitWeight(rows) : 0 },
      // Leakage check: the same signal fit on games predicted LIVE only (backfilled rows may have
      // used stats that did not exist yet at kickoff). Its log-loss fields are in-sample; read b/z.
      signalLiveOnly: rows.filter(r => r.live).length >= 40 ? signalTest(rows.filter(r => r.live), rows.filter(r => r.live)) : null,
      evRuleTest: staking(bets), rawModelEvRuleTest: staking(rawBets),
      reliabilityModel: reliability(rows, 'pModel'), reliabilityMarket: reliability(rows, 'pMkt'),
      disagreement: buckets,
    };
  }

  return {
    sport, rows: all.length, pricedGames: games.length, priceCoverage: r3(games.length / Math.max(1, all.length)),
    provider: [...new Set(games.map(g => pb.cache[g.r.gameId].provider))],
    liveFrom, sigma, sitePicks, markets,
  };
}

const out = { generated: new Date().toISOString(), minEv: MIN_EV, trainFrac: TRAIN_FRAC, sports: {} };
for (const s of SPORTS) out.sports[s] = await analyse(s);
const file = `docs/reports/${out.generated.slice(0, 10)}-ev-ledger.json`;
fs.writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
// The /ev page reads the latest run from here (bundled at build time).
fs.mkdirSync('src/data', { recursive: true });
fs.writeFileSync('src/data/ev-ledger.json', JSON.stringify(out) + '\n');
console.log(`wrote ${file}`);
for (const [s, v] of Object.entries(out.sports)) {
  console.log(`\n== ${s.toUpperCase()}  priced ${v.pricedGames}/${v.rows}  sigma margin ${v.sigma.margin} total ${v.sigma.total}`);
  for (const k of ['ats', 'ou', 'ml']) {
    const c = v.sitePicks[k].close;
    if (v.sitePicks[k].pickAtOpen) { const po = v.sitePicks[k].pickAtOpen; console.log(`  site ${k.padEnd(3)} pick@open ${po.w}-${po.l}-${po.p} ROI ${po.roi} [${po.roiLo}, ${po.roiHi}] CLV ${JSON.stringify(v.sitePicks[k].pickAtOpenClv)}`); }
    console.log(`  site ${k.padEnd(3)} @close  ${c.w}-${c.l}-${c.p}  win ${c.winPct}  needs ${c.breakEven}  ROI ${c.roi} [${c.roiLo}, ${c.roiHi}]  CLV ${JSON.stringify(v.sitePicks[k].clv)}`);
  }
  const m = v.sitePicks.ml;
  console.log(`  ml at flat -110 (old grading) ROI ${m.atFlatMinus110.roi} · favs ROI ${m.favorites.roi} (n ${m.favorites.n}) · dogs ROI ${m.underdogs.roi} (n ${m.underdogs.n})`);
  for (const [mk, x] of Object.entries(v.markets)) {
    if (!x.testScore) { console.log(`  ${mk}: ${x.note} (${x.n})`); continue; }
    const t = x.testScore;
    const st = x.signalTest;
    console.log(`  ${mk.padEnd(6)} signal b=${st.signal}±${st.signalSe} (z ${st.signalZ}) lean a=${st.intercept}±${st.interceptSe} · test logloss market ${st.testLogLoss.market} fitted ${st.testLogLoss.fitted} signal-only ${st.testLogLoss.signalOnly}`);
    if (x.signalLiveOnly) console.log(`  ${mk.padEnd(6)} live-only signal b=${x.signalLiveOnly.signal}±${x.signalLiveOnly.signalSe} (z ${x.signalLiveOnly.signalZ})`);
    console.log(`  ${mk.padEnd(6)} GATE ${x.gate.passes ? 'PASS' : 'fail'} -> live weight ${x.gate.liveWeight}`);
    console.log(`  ${mk.padEnd(6)} w=${x.weight}  test logloss model ${t.model.logLoss} market ${t.market.logLoss} blend ${t.blend.logLoss}  |  EV rule ${x.evRuleTest.n} bets ROI ${x.evRuleTest.roi} [${x.evRuleTest.roiLo}, ${x.evRuleTest.roiHi}]  raw-model rule ${x.rawModelEvRuleTest.n} bets ROI ${x.rawModelEvRuleTest.roi}`);
  }
}
