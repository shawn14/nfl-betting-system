// Isolated research engine. No production imports, network, writes, or model promotion.
import { americanToDecimal, devigTwoWay } from '../../src/lib/fair-value.ts';

export const DAY = 86400000;
export const CFG = {
  nfl: { k: 20, hfa: 48, eloPerPt: 25, carry: 2 / 3, alpha: .15, minGames: 3 },
  nba: { k: 20, hfa: 70, eloPerPt: 28, carry: .75, alpha: .08, minGames: 8 },
  nhl: { k: 6, hfa: 35, eloPerPt: 140, carry: .75, alpha: .06, minGames: 8 },
  cbb: { k: 20, hfa: 80, eloPerPt: 25, carry: 2 / 3, alpha: .1, minGames: 6 },
  wnba: { k: 20, hfa: 60, eloPerPt: 28, carry: .75, alpha: .1, minGames: 6 },
}; // Same fixed feature constants as the old lab; no historical search.
export const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const logit = p => Math.log(p / (1 - p));
const sigmoid = x => 1 / (1 + Math.exp(-x));
export const loss = (p, y) => -y * Math.log(clip(p, 1e-9, 1 - 1e-9)) - (1 - y) * Math.log(clip(1 - p, 1e-9, 1 - 1e-9));
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

export function loadGames(db, sport) {
  return Object.entries(db.games).flatMap(([id, a]) => {
    const [t, type, neutral, home, away, homeName, awayName, hs, as] = a;
    if (type === 1 || !Number.isFinite(Date.parse(t)) || ![hs, as].every(x => Number.isFinite(x) && x >= 0)) return [];
    const year = +t.slice(0, 4), month = +t.slice(5, 7);
    return [{ id, t, ms: Date.parse(t), sport, season: sport === 'wnba' || month >= 7 ? year : year - 1,
      neutral: !!neutral, home: String(home), away: String(away), homeName, awayName, hs, as,
      margin: hs - as, total: hs + as, close: db.prices[id]?.[2] ?? null, provider: db.prices[id]?.[0] ?? null }];
  }).sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
}

/** Outcome updates are queued until kickoff+24h (assumption documented in protocol). */
export function buildFeatures(input, sport, lagHours = 24) {
  const games = [...input].sort((a, b) => a.ms - b.ms || a.id.localeCompare(b.id));
  const c = CFG[sport], teams = new Map();
  let lgPts = null, cursor = 0, latestInput = null;
  const team = (id, season) => {
    let r = teams.get(id);
    if (!r || r.season !== season) {
      r = { elo: 1500 + ((r?.elo ?? 1500) - 1500) * c.carry, off: null, def: null,
        mar: 0, prevMar: (r?.mar ?? 0) * c.carry, n: 0, season, last: r?.last ?? null };
      teams.set(id, r);
    }
    return r;
  };
  const update = g => {
    const h = team(g.home, g.season), a = team(g.away, g.season);
    const dElo = h.elo - a.elo + (g.neutral ? 0 : c.hfa);
    const exp = 1 / (1 + 10 ** (-dElo / 400));
    const mov = Math.abs(g.margin), mult = Math.log(mov + 1) * 2.2 / (Math.abs(dElo) * .001 + 2.2);
    const delta = c.k * (mov ? mult : 1) * ((g.margin > 0 ? 1 : g.margin < 0 ? 0 : .5) - exp);
    h.elo += delta; a.elo -= delta;
    const upd = (r, pf, pa, mar) => {
      const alpha = r.n === 0 ? 1 : Math.max(c.alpha, 1 / (r.n + 1));
      r.off = r.off == null ? pf : r.off + alpha * (pf - r.off);
      r.def = r.def == null ? pa : r.def + alpha * (pa - r.def);
      r.mar = r.n === 0 ? r.prevMar * .5 + mar * .5 : r.mar + alpha * (mar - r.mar);
      r.n++; r.last = g.ms;
    };
    const homeEdge = g.neutral ? 0 : c.hfa / c.eloPerPt;
    upd(h, g.hs, g.as, g.margin - homeEdge); upd(a, g.as, g.hs, -g.margin + homeEdge);
    lgPts = lgPts == null ? g.total / 2 : lgPts + .02 * (g.total / 2 - lgPts);
    latestInput = g.ms;
  };
  return games.map(g => {
    while (cursor < games.length && games[cursor].ms + lagHours * 3600000 <= g.ms) update(games[cursor++]);
    const h = team(g.home, g.season), a = team(g.away, g.season);
    const d = h.elo - a.elo + (g.neutral ? 0 : c.hfa);
    const rest = r => r.last == null ? 4 : Math.min(4, Math.floor((g.ms - r.last) / DAY));
    const ready = h.n >= c.minGames && a.n >= c.minGames && lgPts != null;
    return { ...g, f: { eloLogit: d * Math.LN10 / 400, eloMargin: d / c.eloPerPt,
      ewmaMargin: ready ? h.mar - a.mar : null,
      ewmaTotal: ready ? h.off + a.def + a.off + h.def - 2 * lgPts : null,
      restDiff: rest(h) - rest(a), restSum: rest(h) + rest(a),
      latestOutcomeKickoff: latestInput, outcomeUpdates: cursor, ready } };
  });
}

function pair(a, b) {
  if (![a, b].every(x => Number.isFinite(x) && Math.abs(x) >= 100)) return false;
  const overround = 1 / americanToDecimal(a) + 1 / americanToDecimal(b);
  return overround >= 1 && overround <= 1.12;
}

export function makeRows(games) {
  const rows = [];
  for (const g of games) {
    if (!g.close) continue;
    const [mlH, mlA, L, sH, sA, T, over, under] = g.close;
    const add = (market, a, b, line, outcome, x, method) => {
      if (!pair(a, b)) return;
      const p = devigTwoWay(a, b, method);
      rows.push({ id: `${g.sport}:${g.id}:${market}`, gameId: `${g.sport}:${g.id}`, sport: g.sport, market,
        t: g.t, ms: g.ms, provider: g.provider, line, a, b, p, off: logit(p),
        y: outcome === 0 ? null : outcome > 0 ? 1 : 0, x: g.f.ready ? x(p) : null,
        latestOutcomeKickoff: g.f.latestOutcomeKickoff });
    };
    add('moneyline', mlH, mlA, 0, g.margin,
      p => [g.f.eloLogit - logit(p), g.f.ewmaMargin, g.f.restDiff], 'power');
    if (Number.isFinite(L)) add('spread', sH, sA, L, g.margin + L,
      () => [g.f.eloMargin + L, g.f.ewmaMargin + L, g.f.restDiff], 'multiplicative');
    if (Number.isFinite(T) && T > 0) add('total', over, under, T, g.total - T,
      () => [g.f.ewmaTotal - T, g.f.restSum], 'multiplicative');
  }
  return rows;
}

function solve(A, b) {
  const a = A.map((r, i) => [...r, b[i]]), n = b.length;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
    [a[i], a[pivot]] = [a[pivot], a[i]];
    if (Math.abs(a[i][i]) < 1e-12) throw new Error('Singular ridge Hessian');
    const d = a[i][i];
    for (let j = i; j <= n; j++) a[i][j] /= d;
    for (let k = 0; k < n; k++) if (k !== i) {
      const f = a[k][i];
      for (let j = i; j <= n; j++) a[k][j] -= f * a[i][j];
    }
  }
  return a.map(r => r[n]);
}
const transform = (x, model) => [1, ...x.map((v, i) => clip((v - model.means[i]) / model.scales[i], -3, 3))];

export function fit(rows, protocol) {
  const train = rows.filter(r => r.y !== null && r.x?.every(Number.isFinite));
  if (train.length < protocol.minimumTrainNonPush) return null;
  const means = train[0].x.map((_, i) => mean(train.map(r => r.x[i])));
  const scales = means.map((m, i) => Math.sqrt(mean(train.map(r => (r.x[i] - m) ** 2))) || 1);
  const model = { means, scales, beta: Array(means.length + 1).fill(0), n: train.length,
    latestTrainingKickoff: Math.max(...train.map(r => r.ms)), iterations: 0 };
  const xs = train.map(r => transform(r.x, model)), d = model.beta.length, lambda = protocol.ridgePenalty;
  const objective = beta => train.reduce((s, r, i) => s + loss(sigmoid(r.off + dot(xs[i], beta)), r.y),
    lambda / 2 * dot(beta, beta));
  let converged = false;
  for (let it = 0; it < 60; it++) {
    const grad = model.beta.map(b => -lambda * b);
    const h = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => i === j ? lambda : 0));
    for (let n = 0; n < train.length; n++) {
      const p = sigmoid(train[n].off + dot(xs[n], model.beta)), w = p * (1 - p);
      for (let i = 0; i < d; i++) {
        grad[i] += xs[n][i] * (train[n].y - p);
        for (let j = 0; j < d; j++) h[i][j] += xs[n][i] * xs[n][j] * w;
      }
    }
    const step = solve(h, grad), before = objective(model.beta);
    let scale = 1, next;
    while (scale >= 1 / 1024) {
      next = model.beta.map((b, i) => b + scale * step[i]);
      if (objective(next) <= before + 1e-8) break;
      scale /= 2;
    }
    if (scale < 1 / 1024) throw new Error('Ridge optimization failed');
    model.beta = next; model.iterations = it + 1;
    if (Math.max(...step.map(x => Math.abs(x * scale))) < 1e-8) { converged = true; break; }
  }
  if (!converged) throw new Error('Ridge optimization did not converge');
  return model;
}

export function predict(row, model, protocol) {
  if (!model || !row.x?.every(Number.isFinite)) return row.p;
  const adjustment = clip(dot(transform(row.x, model), model.beta), -protocol.maxAdjustmentLogOdds, protocol.maxAdjustmentLogOdds);
  return sigmoid(row.off + adjustment);
}

/** Every held-month forecast uses a model frozen at the start of that month. */
export function evaluate(rows, protocol) {
  const output = [], models = [];
  const months = [...new Set(rows.map(r => r.t.slice(0, 7)).filter(m => m >= protocol.firstEvaluationMonth))].sort();
  const groups = Map.groupBy(rows, r => `${r.sport}:${r.market}`);
  for (const month of months) for (const [group, rs] of groups) {
    const test = rs.filter(r => r.t.startsWith(month));
    if (!test.length) continue;
    const at = Date.parse(`${month}-01T00:00:00Z`);
    const train = rs.filter(r => r.ms + protocol.outcomeAvailabilityLagHours * 3600000 < at);
    const model = fit(train, protocol);
    const modelId = `${group}:${month}`;
    models.push({ id: modelId, asOf: new Date(at).toISOString(), ...model, active: !!model });
    for (const row of test) {
      const p = predict(row, model, protocol);
      const conditional = train.filter(r => Number.isInteger(r.line) === Number.isInteger(row.line));
      const pushRate = Number.isInteger(row.line) ? (conditional.filter(r => r.y === null).length + 1) / (conditional.length + 2) : 0;
      output.push({ ...row, prediction: p, modelId, active: !!model && !!row.x,
        expectedA: (1 - pushRate) * (p * americanToDecimal(row.a) - 1),
        expectedB: (1 - pushRate) * ((1 - p) * americanToDecimal(row.b) - 1) });
    }
  }
  const selected = [];
  for (const [gameId, rs] of Map.groupBy(output, r => r.gameId)) {
    const choices = rs.filter(r => r.active).flatMap(r => [
      { ...r, side: 'A', ev: r.expectedA, price: r.a }, { ...r, side: 'B', ev: r.expectedB, price: r.b },
    ]).filter(r => r.ev >= protocol.paperSelection.minimumExpectedReturn)
      .sort((a, b) => b.ev - a.ev || a.id.localeCompare(b.id) || a.side.localeCompare(b.side));
    if (!choices.length) continue;
    const r = choices[0];
    const profit = r.y === null ? 0 : (r.y === 1) === (r.side === 'A') ? americanToDecimal(r.price) - 1 : -1;
    selected.push({ gameId, id: r.id, t: r.t, ms: r.ms, sport: r.sport, market: r.market, side: r.side,
      line: r.line, price: r.price, expectedReturn: r.ev, push: r.y === null, gross: profit,
      net: profit - protocol.paperSelection.additionalCostPerUnit });
  }
  return { rows: output, models, selected };
}

/** Paired uncertainty, clustered by UTC week, preserving within-game/within-week dependence. */
export function clustered(rows, value) {
  if (!rows.length) return { n: 0, mean: null, clusters: 0, approximate95: null };
  const avg = mean(rows.map(value));
  const groups = Map.groupBy(rows, r => Math.floor(r.ms / (7 * DAY)));
  if (groups.size < 2) return { n: rows.length, mean: avg, clusters: groups.size, approximate95: null };
  const ss = [...groups.values()].reduce((s, rs) => s + rs.reduce((v, r) => v + value(r) - avg, 0) ** 2, 0);
  const se = Math.sqrt(groups.size / (groups.size - 1) * ss) / rows.length;
  return { n: rows.length, mean: avg, clusters: groups.size, approximate95: [avg - 1.96 * se, avg + 1.96 * se] };
}

export function summarize(result) {
  const scores = rows => {
    const graded = rows.filter(r => r.y !== null);
    return { n: rows.length, pushes: rows.length - graded.length, adjusted: rows.filter(r => r.active).length,
      logLossMarket: mean(graded.map(r => loss(r.p, r.y))), logLossChallenger: mean(graded.map(r => loss(r.prediction, r.y))),
      pairedLogLossGain: clustered(graded, r => loss(r.p, r.y) - loss(r.prediction, r.y)),
      brierMarket: mean(graded.map(r => (r.p - r.y) ** 2)), brierChallenger: mean(graded.map(r => (r.prediction - r.y) ** 2)) };
  };
  const calibration = Array.from({ length: 10 }, (_, i) => {
    const rs = result.rows.filter(r => r.y !== null && Math.min(9, Math.floor(r.prediction * 10)) === i);
    return { from: i / 10, to: (i + 1) / 10, n: rs.length, predicted: mean(rs.map(r => r.prediction)), observed: mean(rs.map(r => r.y)) };
  });
  return { overall: scores(result.rows), cells: Object.fromEntries([...Map.groupBy(result.rows, r => `${r.sport}:${r.market}`)]
    .map(([key, rows]) => [key, scores(rows)])), calibration,
    paper: { selections: result.selected.length, pushes: result.selected.filter(r => r.push).length,
      grossReturn: clustered(result.selected, r => r.gross), costAdjustedReturn: clustered(result.selected, r => r.net),
      bySport: Object.fromEntries([...Map.groupBy(result.selected, r => r.sport)].map(([s, rows]) => [s, clustered(rows, r => r.net)])) } };
}
