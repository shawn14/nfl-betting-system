#!/usr/bin/env node
/**
 * Walk-forward validation harness.
 *
 * Every model "improvement" in this repo has historically been grid-searched on the
 * same history it is then reported against (in-sample). That inflates win rates and
 * hides overfitting. This harness splits each sport's stored backtest results
 * chronologically (train = earlier games, test = later games), tunes on TRAIN only,
 * and reports performance on the held-out TEST set — the honest number.
 *
 * It currently validates two things from the stored results (no Elo recompute needed,
 * since pre-game Elos and predicted scores are persisted per game):
 *   1. Win-probability calibration (Brier score + reliability gap) under candidate
 *      home-bump / logistic-divisor params. This is what the CBB calibration fix tunes.
 *   2. ATS win rate bucketed by how much the model disagrees with the Vegas spread —
 *      a quick read on whether the spread model carries any edge over the market.
 *
 * Usage:
 *   node scripts/walk-forward.mjs                # all sports, default split
 *   node scripts/walk-forward.mjs cbb            # one sport
 *   node scripts/walk-forward.mjs cbb 160 350    # one sport, candidate bump+divisor
 *
 * Data is fetched live from the deployed blobs (same pattern as other scripts).
 */

const BASE = process.env.PM_BASE || 'https://www.predictionmatrix.com';
const BLOBS = {
  nfl: 'prediction-matrix-data.json',
  nba: 'nba-prediction-data.json',
  nhl: 'nhl-prediction-data.json',
  cbb: 'cbb-prediction-data.json',
  wnba: 'wnba-prediction-data.json',
};
// Production win-prob params per sport (home Elo bump, logistic divisor).
const WINPROB = {
  nfl: [48, 400], nba: [48, 400], nhl: [48, 400], cbb: [160, 350], wnba: [48, 400],
};
const TRAIN_FRAC = 0.6;
const BREAKEVEN = 52.38; // -110 juice

const winProb = (homeElo, awayElo, bump, div) =>
  1 / (1 + Math.pow(10, (awayElo - (homeElo + bump)) / div));

function calibration(rows, bump, div) {
  let brier = 0, sumP = 0, sumA = 0, n = 0;
  for (const r of rows) {
    const p = winProb(r.homeElo, r.awayElo, bump, div);
    const a = r.homeWon ? 1 : 0;
    brier += (p - a) ** 2; sumP += p; sumA += a; n++;
  }
  return n ? { brier: brier / n, gap: (100 * (sumA - sumP)) / n, n } : null;
}

function atsByEdge(rows) {
  const b = {};
  for (const r of rows) {
    if (r.atsResult !== 'win' && r.atsResult !== 'loss') continue;
    const e = Math.abs(r.predictedSpread - r.vegasSpread);
    const k = e < 1 ? '<1' : e < 2 ? '1-2' : e < 3 ? '2-3' : e < 5 ? '3-5' : '5+';
    (b[k] ??= [0, 0])[r.atsResult === 'win' ? 0 : 1]++;
  }
  return b;
}

const z = (pct, n) => (n ? (pct - BREAKEVEN) / (100 * Math.sqrt(0.25 / n)) : 0);

async function run(sport, bumpArg, divArg) {
  const res = await fetch(`${BASE}/${BLOBS[sport]}?cb=${Date.now()}`);
  const data = await res.json();
  const all = (data.backtest?.results || [])
    .filter((r) => r.homeElo != null && r.homeWon != null && r.gameTime)
    .sort((a, b) => new Date(a.gameTime) - new Date(b.gameTime));
  if (all.length < 30) {
    console.log(`\n${sport.toUpperCase()}: only ${all.length} usable games — skipping (need odds coverage).`);
    return;
  }
  const [prodBump, prodDiv] = WINPROB[sport];
  const bump = bumpArg != null ? +bumpArg : prodBump;
  const div = divArg != null ? +divArg : prodDiv;
  const cut = Math.floor(all.length * TRAIN_FRAC);
  const train = all.slice(0, cut), test = all.slice(cut);

  console.log(`\n${'='.repeat(64)}\n${sport.toUpperCase()} — ${all.length} games  (train ${train.length} / test ${test.length})\n${'='.repeat(64)}`);

  // 1. Calibration: production vs candidate, on held-out TEST
  const pTrain = calibration(train, prodBump, prodDiv), pTest = calibration(test, prodBump, prodDiv);
  console.log(`\n  Win-prob calibration (Brier lower=better, gap→0=better):`);
  console.log(`    production ${prodBump}/${prodDiv}:  TEST Brier ${pTest.brier.toFixed(4)}  gap ${pTest.gap >= 0 ? '+' : ''}${pTest.gap.toFixed(1)}`);
  if (bump !== prodBump || div !== prodDiv) {
    const cTest = calibration(test, bump, div);
    console.log(`    candidate  ${bump}/${div}:  TEST Brier ${cTest.brier.toFixed(4)}  gap ${cTest.gap >= 0 ? '+' : ''}${cTest.gap.toFixed(1)}`);
  }

  // 2. ATS-vs-market edge diagnostic (does disagreement predict wins?)
  console.log(`\n  ATS by model-vs-Vegas spread edge (TEST set, breakeven ${BREAKEVEN}%):`);
  const withOdds = test.filter((r) => r.vegasSpread != null);
  const b = atsByEdge(withOdds);
  for (const k of ['<1', '1-2', '2-3', '3-5', '5+']) {
    const [w, l] = b[k] || [0, 0]; const n = w + l;
    if (!n) continue;
    const pct = (100 * w) / n;
    console.log(`    edge ${k.padEnd(4)} ${pct.toFixed(1)}%  (${w}-${l}, n=${n})  z=${z(pct, n) >= 0 ? '+' : ''}${z(pct, n).toFixed(1)}`);
  }
}

const args = process.argv.slice(2);
const sports = args[0] && BLOBS[args[0]] ? [args[0]] : Object.keys(BLOBS);
for (const s of sports) await run(s, args[1], args[2]);
