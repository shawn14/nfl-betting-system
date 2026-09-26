/**
 * Fair value + expected value (EV) math — the price layer on top of the model.
 *
 * Win rate is not edge. A pick is only worth betting when the model's probability beats the
 * PRICE: the break-even probability implied by the odds you actually get. Everything here is
 * pure math so the crons, the pages and the Node ledger script (`scripts/ev-ledger.mjs`, which
 * imports this file directly via Node's type-stripping) share one implementation.
 *
 * Conventions
 *   - American odds everywhere at the edges (-110, +195); decimal odds internally.
 *   - "Fair" probability = the market's implied probability with the bookmaker margin (vig)
 *     removed ("de-vigged"). It is the market's own estimate and the prior our model must beat.
 *   - Spread lines are HOME lines (home favorite negative), matching `vegasSpread` everywhere.
 */

// ---------------------------------------------------------------- price conversions

export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1));
}

/** Raw implied probability of one price (includes the vig). */
export function impliedProb(american: number): number {
  return 1 / americanToDecimal(american);
}

/** Price that is exactly fair for probability p (no vig). */
export function fairAmerican(p: number): number {
  return decimalToAmerican(1 / p);
}

/** Bookmaker margin of a two-way market, e.g. -110/-110 -> 0.0476. */
export function overround(a: number, b: number): number {
  return impliedProb(a) + impliedProb(b) - 1;
}

// ---------------------------------------------------------------- de-vig

export type DevigMethod = 'multiplicative' | 'power';

/**
 * Remove the vig from a two-way market and return the fair probability of side A.
 *   multiplicative: scale both raw probabilities to sum to 1. Standard for near-50/50 markets
 *                   (spreads, totals).
 *   power:          find k with pA^k + pB^k = 1. Puts more of the margin on the longshot, which
 *                   matches the favourite-longshot bias in moneylines.
 */
export function devigTwoWay(priceA: number, priceB: number, method: DevigMethod = 'multiplicative'): number {
  const a = impliedProb(priceA);
  const b = impliedProb(priceB);
  if (method === 'multiplicative') return a / (a + b);
  let lo = 1, hi = 3;                         // sum > 1 at k=1; k grows until it hits 1
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    if (Math.pow(a, k) + Math.pow(b, k) > 1) lo = k; else hi = k;
  }
  return Math.pow(a, (lo + hi) / 2);
}

// ---------------------------------------------------------------- model probabilities

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
export function normCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Inverse standard normal CDF (Acklam's rational approximation, rel. err < 1.2e-9). */
export function invNormCdf(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const q0 = Math.min(1 - 1e-12, Math.max(1e-12, p));
  if (q0 < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(q0));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (q0 > 1 - 0.02425) return -invNormCdf(1 - q0);
  const q = q0 - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * Move a fair cover probability from one line to another, treating the result as normal with
 * SD `sigma`. `pointsInFavour` > 0 when the new line is better for this side (e.g. home -4.5
 * instead of -5.5 => +1; over 43.5 instead of 44.5 => +1). Ignores key-number mass (NFL 3/7),
 * so treat half-point moves through 3 and 7 as understated.
 */
export function shiftProb(p: number, pointsInFavour: number, sigma: number): number {
  return normCdf(invNormCdf(p) + pointsInFavour / sigma);
}

/**
 * P(home covers `homeLine`) given the model's predicted home spread (home favourite negative).
 * Home covers when actualMargin + homeLine > 0, actualMargin ~ N(-predictedSpread, sigma).
 * Half-point lines have no push; for whole-number lines this returns P(win | no push).
 */
export function probHomeCovers(predictedSpread: number, homeLine: number, sigma: number): number {
  return normCdf((-predictedSpread + homeLine) / sigma);
}

/** P(over `line`) given the model's predicted total, total ~ N(predictedTotal, sigma). */
export function probOver(predictedTotal: number, line: number, sigma: number): number {
  return normCdf((predictedTotal - line) / sigma);
}

/**
 * Result spread (actual minus market) standard deviations per sport. These are the NOISE of each
 * sport, not model parameters: the SD of (actual result - ESPN closing line) over every priced game
 * ESPN keeps, measured by `npm run market-lab` (docs/reports/2026-09-26-market-lab.json, "sigma").
 * Re-measure each season; never pick them to make a backtest look good.
 */
export const RESULT_SIGMA: Record<string, { margin: number; total: number }> = {
  nfl: { margin: 12.6, total: 13.1 },   // 572 / 574 games, 2024-09 .. 2026-09
  nba: { margin: 13.9, total: 17.8 },   // 3,930 / 3,940 games, 2023-10 .. 2026-06
  wnba: { margin: 12.4, total: 17.0 },  // 905 / 894 games, 2024-05 .. 2026-09
  cbb: { margin: 11.2, total: 16.5 },   // 16,659 / 16,692 games, 2023-11 .. 2026-04
  // NHL "spreads" are always the +-1.5 puck line, so SD(margin + line) is not the margin's noise:
  // margin uses the raw SD of final margins (the market explains little of it). 4,118 totals.
  nhl: { margin: 2.6, total: 2.3 },
};

// ---------------------------------------------------------------- blending with the market

const logit = (p: number) => Math.log(p / (1 - p));
const expit = (x: number) => 1 / (1 + Math.exp(-x));
const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p));

/**
 * Shrink the model toward the market in log-odds space: w = 0 trusts the market entirely,
 * w = 1 trusts the model entirely. A model with no proven edge must sit close to the market;
 * `MODEL_WEIGHT` is set from the ledger's held-out test, not from wishful thinking.
 */
export function blendWithMarket(pModel: number, pMarket: number, w: number): number {
  return expit(w * logit(clampP(pModel)) + (1 - w) * logit(clampP(pMarket)));
}

// ---------------------------------------------------------------- EV + staking

/** Expected profit per 1 unit staked at `american` when the true win probability is p. */
export function expectedValue(p: number, american: number): number {
  return p * (americanToDecimal(american) - 1) - (1 - p);
}

/** Full-Kelly fraction of bankroll (0 when the bet is -EV). */
export function kellyFraction(p: number, american: number): number {
  const b = americanToDecimal(american) - 1;
  return Math.max(0, (b * p - (1 - p)) / b);
}

/**
 * Closing line value in probability terms: how much more likely the market's de-vigged CLOSE
 * thinks our side is than the price we took implied. Positive = we beat the close. This is the
 * best leading indicator of edge; win rate needs thousands of bets to say the same thing.
 */
export function clvProb(takenAmerican: number, closeFairProb: number): number {
  return closeFairProb - impliedProb(takenAmerican);
}

// ---------------------------------------------------------------- scoring rules

export function brier(p: number, outcome: 0 | 1): number {
  return (p - outcome) ** 2;
}

export function logLoss(p: number, outcome: 0 | 1): number {
  const q = clampP(p);
  return -(outcome * Math.log(q) + (1 - outcome) * Math.log(1 - q));
}
