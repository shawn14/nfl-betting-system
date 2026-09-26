/**
 * EV rule — turns a frozen-model prediction plus live prices into fair odds and +EV flags.
 *
 * This layer does NOT change the model or its picks (see model-version.ts: those are frozen). It
 * answers a different question: at the price on offer right now, is either side worth a bet?
 *
 *   market fair prob  = de-vigged price (power method for moneylines, multiplicative otherwise)
 *   model prob        = frozen model output (Elo win prob; spread/total via N(pred, sigma))
 *   blended prob      = model shrunk toward the market with MODEL_WEIGHT (log-odds space)
 *   EV                = blended prob vs the price you'd actually get
 *
 * MODEL_WEIGHT comes from `npm run ev-ledger` (docs/reports/2026-09-26-ev-ledger.json) under a gate
 * declared before looking at results: a market earns weight only if the model's signal beyond any
 * constant lean is |z| >= 1.5 on the first 60% of games AND it lowers held-out log loss on the last
 * 40%. Markets that fail defer to the price (weight 0): their EV is just minus the vig, so they are
 * never flagged. Re-run the ledger each season; change weights ONLY by bumping EV_RULE_VERSION and
 * recording the ledger run that justified it in CLAUDE.md.
 */
import {
  devigTwoWay, probHomeCovers, probOver, blendWithMarket, expectedValue, kellyFraction,
  fairAmerican, overround, RESULT_SIGMA,
} from './fair-value.ts';
import type { PriceSnapshot } from './espn-prices.ts';

// ev2 (2026-09-26): RESULT_SIGMA re-measured on every priced game ESPN keeps (market lab, 26k games)
// instead of the ledger's ~300 per sport and textbook placeholders; NBA margin moved 12.0 -> 13.9.
// Weights unchanged. ev1 = the first ledger run.
export const EV_RULE_VERSION = '2026-09-26-ev2';
export const MIN_EV = 0.02;   // flag a side at >= 2% expected return per unit
/**
 * Extrapolation guard: the blended probability may not sit more than this far from the market's
 * fair probability. The weights were fit where model-vs-market disagreement was mostly under ~6
 * points; a 12-point total disagreement is outside that range, and no liquid market is 10+ points
 * wrong often enough to size bets on it.
 */
export const MAX_EDGE = 0.10;

type MarketKey = 'ml' | 'spread' | 'total';

export const MODEL_WEIGHT: Record<string, Record<MarketKey, number>> = {
  // NFL totals: signal z 2.4 on train, held-out log loss 0.692 -> 0.662, and it holds on games
  // predicted LIVE only (n 92, z 2.9) so it is not backfill leakage. ML (z -0.1) and spread (z 0.4)
  // failed the gate.
  nfl: { ml: 0, spread: 0, total: 0.45 },
  // WNBA: no market passed (ML z 0.6, spread z 1.0, total z 1.4).
  wnba: { ml: 0, spread: 0, total: 0 },
  // NBA / CBB / NHL: the site's own graded rows live in Firestore and have not been through the
  // ledger. The market lab (docs/reports/2026-09-26-market-lab.json) tested the ingredients these
  // models are built from — online Elo, rolling ratings, rest/back-to-back, pace — against the
  // CLOSE on 3,930 NBA, 16,659 CBB and 4,184 NHL games: none passed. Defer to the market.
  nba: { ml: 0, spread: 0, total: 0 },
  cbb: { ml: 0, spread: 0, total: 0 },
  nhl: { ml: 0, spread: 0, total: 0 },
};

export interface SideEv {
  label: string;          // "KC -3.5", "Over 47.5", "KC ML"
  price: number;          // American odds on offer
  fairProb: number;       // market's de-vigged probability
  modelProb: number;      // frozen model's raw probability
  prob: number;           // blended probability used for EV
  fairOdds: number;       // American odds that would be exactly fair at `prob`
  ev: number;             // expected return per unit staked at `price`
  kelly: number;          // stake as a fraction of bankroll (see stakeFraction)
}

export interface MarketEv {
  market: MarketKey;
  line?: number;
  weight: number;
  vig: number;            // bookmaker margin on this market
  sides: [SideEv, SideEv];
  best: SideEv | null;    // highest-EV side if it clears MIN_EV, else null
}

export interface GameEv {
  version: string;
  sport: string;
  markets: MarketEv[];
}

export interface PredictionLike {
  homeWinProbability?: number | null;
  predictedSpread?: number | null;
  predictedTotal?: number | null;
}

/**
 * Bet sizing as a fraction of bankroll, given the full-Kelly fraction for a +EV side.
 * Full Kelly is only optimal when the probability is exactly right; ours is an estimate with
 * wide error bars, so real sizing must be a fraction of it and capped.
 */
export function stakeFraction(fullKelly: number): number {
  return Math.min(0.02, fullKelly / 4);   // quarter Kelly, never more than 2% of bankroll
}

function side(label: string, price: number, fairProb: number, modelProb: number, w: number): SideEv {
  const raw = blendWithMarket(modelProb, fairProb, w);
  const prob = Math.min(fairProb + MAX_EDGE, Math.max(fairProb - MAX_EDGE, raw));
  const ev = expectedValue(prob, price);
  return { label, price, fairProb, modelProb, prob, fairOdds: fairAmerican(prob), ev, kelly: ev > 0 ? stakeFraction(kellyFraction(prob, price)) : 0 };
}

function market(key: MarketKey, sides: [SideEv, SideEv], weight: number, vig: number, line?: number): MarketEv {
  const top = sides[0].ev >= sides[1].ev ? sides[0] : sides[1];
  return { market: key, line, weight, vig, sides, best: weight > 0 && top.ev >= MIN_EV ? top : null };
}

export function evaluateGame(
  sport: string, home: string, away: string, pred: PredictionLike, px: PriceSnapshot,
): GameEv {
  const w = MODEL_WEIGHT[sport] ?? { ml: 0, spread: 0, total: 0 };
  const sigma = RESULT_SIGMA[sport];
  const markets: MarketEv[] = [];
  const vigOf = overround;

  if (px.mlHome !== undefined && px.mlAway !== undefined && pred.homeWinProbability != null) {
    const f = devigTwoWay(px.mlHome, px.mlAway, 'power');
    const m = pred.homeWinProbability;
    markets.push(market('ml', [
      side(`${home} ML`, px.mlHome, f, m, w.ml),
      side(`${away} ML`, px.mlAway, 1 - f, 1 - m, w.ml),
    ], w.ml, vigOf(px.mlHome, px.mlAway)));
  }
  if (px.spreadLine !== undefined && px.spreadHomePrice !== undefined && px.spreadAwayPrice !== undefined && pred.predictedSpread != null && sigma) {
    const L = px.spreadLine;
    const f = devigTwoWay(px.spreadHomePrice, px.spreadAwayPrice);
    const m = probHomeCovers(pred.predictedSpread, L, sigma.margin);
    const fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);
    markets.push(market('spread', [
      side(`${home} ${fmt(L)}`, px.spreadHomePrice, f, m, w.spread),
      side(`${away} ${fmt(-L)}`, px.spreadAwayPrice, 1 - f, 1 - m, w.spread),
    ], w.spread, vigOf(px.spreadHomePrice, px.spreadAwayPrice), L));
  }
  if (px.totalLine !== undefined && px.overPrice !== undefined && px.underPrice !== undefined && pred.predictedTotal != null && sigma) {
    const T = px.totalLine;
    const f = devigTwoWay(px.overPrice, px.underPrice);
    const m = probOver(pred.predictedTotal, T, sigma.total);
    markets.push(market('total', [
      side(`Over ${T}`, px.overPrice, f, m, w.total),
      side(`Under ${T}`, px.underPrice, 1 - f, 1 - m, w.total),
    ], w.total, vigOf(px.overPrice, px.underPrice), T));
  }
  return { version: EV_RULE_VERSION, sport, markets };
}
