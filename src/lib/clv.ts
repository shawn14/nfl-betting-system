/**
 * Closing Line Value (CLV) — the honest forward edge metric.
 *
 * CLV measures whether the market moved toward our pick between when we first saw
 * the game (the opening line we'd have bet our model's number into) and the locked
 * line ~1h before tip (our best available proxy for the close). Consistently beating
 * the close is the strongest leading indicator that a betting model has real edge —
 * more reliable than short-run win rate, which is dominated by variance.
 *
 * Inputs come entirely from data the syncs already capture per game:
 *   - opening line: historicalOdds[gameId].openingSpread / openingTotal (first observed)
 *   - locked line:  result.vegasSpread / vegasTotal (locked ~1h pre-game ≈ close)
 *   - our pick is derived the same way ATS/O-U results are graded, so CLV and the
 *     win/loss record always refer to the same side.
 *
 * NOTE: the locked line is a CLOSE PROXY (1h pre-game), not the literal closing
 * number. Most movement happens before lock, so it is a reasonable approximation;
 * treat small CLV magnitudes accordingly.
 */

export interface ClvAccumulator {
  sSum: number; sBeat: number; sN: number;
  tSum: number; tBeat: number; tN: number;
}

export interface ClvSummary {
  spread: { avgClv: number; pctBeatClose: number; n: number };
  total: { avgClv: number; pctBeatClose: number; n: number };
}

export function newClvAccumulator(): ClvAccumulator {
  return { sSum: 0, sBeat: 0, sN: 0, tSum: 0, tBeat: 0, tN: 0 };
}

type ResultLike = {
  predictedSpread?: number | null;
  vegasSpread?: number | null;
  predictedTotal?: number | null;
  vegasTotal?: number | null;
};
type OpeningLike = {
  openingSpread?: number | null;
  openingTotal?: number | null;
} | undefined | null;

/** Accumulate one completed pick's CLV. vegasSpread is the home-team line (favorite negative). */
export function addClv(acc: ClvAccumulator, r: ResultLike, opening: OpeningLike): void {
  if (opening?.openingSpread != null && r.vegasSpread != null && r.predictedSpread != null) {
    const pickHome = r.predictedSpread < r.vegasSpread;          // same pick logic as ATS grading
    // Beat the close when the line moved toward our side after open.
    const clv = pickHome
      ? opening.openingSpread - r.vegasSpread                    // home: line got more negative
      : r.vegasSpread - opening.openingSpread;                   // away: line got less negative
    acc.sSum += clv; if (clv > 0) acc.sBeat++; acc.sN++;
  }
  if (opening?.openingTotal != null && r.vegasTotal != null && r.predictedTotal != null) {
    const pickOver = r.predictedTotal > r.vegasTotal;
    const clv = pickOver
      ? r.vegasTotal - opening.openingTotal                      // over: total moved up
      : opening.openingTotal - r.vegasTotal;                     // under: total moved down
    acc.tSum += clv; if (clv > 0) acc.tBeat++; acc.tN++;
  }
}

export function finalizeClv(acc: ClvAccumulator): ClvSummary {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const pct = (b: number, n: number) => (n ? Math.round((b / n) * 1000) / 10 : 0);
  return {
    spread: { avgClv: acc.sN ? r2(acc.sSum / acc.sN) : 0, pctBeatClose: pct(acc.sBeat, acc.sN), n: acc.sN },
    total: { avgClv: acc.tN ? r2(acc.tSum / acc.tN) : 0, pctBeatClose: pct(acc.tBeat, acc.tN), n: acc.tN },
  };
}
