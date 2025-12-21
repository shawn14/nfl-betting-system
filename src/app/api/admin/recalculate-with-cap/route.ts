import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';

// Match constants from blob-sync-simple
const ELO_TO_POINTS = 0.11;
const ELO_CAP = 16;  // ±8 pts per team max

interface BacktestResult {
  gameId: string;
  gameTime: string;
  week?: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  homeWon: boolean;
  spreadPick: 'home' | 'away';
  spreadResult: 'win' | 'loss' | 'push';
  mlPick: 'home' | 'away';
  mlResult: 'win' | 'loss' | 'push';
  ouPick: 'over' | 'under';
  ouResult: 'win' | 'loss' | 'push';
  vegasSpread?: number;
  vegasTotal?: number;
  atsVegasResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
  // Situation flags
  isDivisional?: boolean;
  isLateSeasonGame?: boolean;
  isLargeSpread?: boolean;
  isSmallSpread?: boolean;
  isMediumSpread?: boolean;
  isEloMismatch?: boolean;
}

export async function GET() {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    // 1. Read existing blob
    log('Reading blob data...');
    const blobInfo = await head('prediction-matrix-data.json');
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'No blob data found' }, { status: 404 });
    }

    const response = await fetch(blobInfo.url, { cache: 'no-store' });
    const blobData = await response.json();

    const results: BacktestResult[] = blobData.backtest?.results || [];
    log(`Found ${results.length} backtest results`);

    // Track stats
    let gamesAffected = 0;
    let spreadFlipped = 0;
    let ouFlipped = 0;

    // New stats counters
    let atsWins = 0, atsLosses = 0, atsPushes = 0;
    let atsVegasWins = 0, atsVegasLosses = 0, atsVegasPushes = 0;
    let mlWins = 0, mlLosses = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;
    let ouVegasWins = 0, ouVegasLosses = 0, ouVegasPushes = 0;

    // Edge-filtered stats
    let mlHighEdgeWins = 0, mlHighEdgeLosses = 0;  // 15%+ edge
    let ouHighEdgeWins = 0, ouHighEdgeLosses = 0;  // 5+ pt edge

    for (const game of results) {
      // Calculate original uncapped Elo adjustment
      const eloDiff = game.homeElo - game.awayElo;
      const uncappedEloAdj = (eloDiff * ELO_TO_POINTS) / 2;

      // Calculate new capped adjustment
      let cappedEloAdj = uncappedEloAdj;
      if (ELO_CAP > 0) {
        cappedEloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, uncappedEloAdj));
      }

      // Calculate adjustment difference
      const adjDiff = cappedEloAdj - uncappedEloAdj;

      if (Math.abs(adjDiff) > 0.01) {
        gamesAffected++;

        // Recalculate predictions
        const oldHomeScore = game.predictedHomeScore;
        const oldAwayScore = game.predictedAwayScore;

        game.predictedHomeScore = oldHomeScore + adjDiff;
        game.predictedAwayScore = oldAwayScore - adjDiff;
        game.predictedSpread = game.predictedAwayScore - game.predictedHomeScore;
        game.predictedTotal = game.predictedHomeScore + game.predictedAwayScore;

        // Check if spread pick changed
        const oldSpreadPick = game.spreadPick;
        const newSpreadPick = game.predictedSpread < 0 ? 'home' : 'away';
        if (oldSpreadPick !== newSpreadPick) {
          spreadFlipped++;
          game.spreadPick = newSpreadPick;
        }

        // Check if O/U pick changed (vs raw prediction)
        const oldOuPick = game.ouPick;
        const newOuPick = game.predictedTotal > 44 ? 'over' : 'under';
        if (oldOuPick !== newOuPick) {
          ouFlipped++;
          game.ouPick = newOuPick;
        }
      }

      // Recalculate all results with current predictions

      // Spread result (vs actual)
      if (game.spreadPick === 'home') {
        if (game.actualSpread < 0) game.spreadResult = 'win';
        else if (game.actualSpread > 0) game.spreadResult = 'loss';
        else game.spreadResult = 'push';
      } else {
        if (game.actualSpread > 0) game.spreadResult = 'win';
        else if (game.actualSpread < 0) game.spreadResult = 'loss';
        else game.spreadResult = 'push';
      }

      // O/U result (vs actual)
      if (game.ouPick === 'over') {
        if (game.actualTotal > 44) game.ouResult = 'win';
        else if (game.actualTotal < 44) game.ouResult = 'loss';
        else game.ouResult = 'push';
      } else {
        if (game.actualTotal < 44) game.ouResult = 'win';
        else if (game.actualTotal > 44) game.ouResult = 'loss';
        else game.ouResult = 'push';
      }

      // ML result
      const mlPick = game.predictedSpread < 0 ? 'home' : 'away';
      game.mlPick = mlPick;
      game.mlResult = (mlPick === 'home' && game.homeWon) || (mlPick === 'away' && !game.homeWon) ? 'win' : 'loss';

      // ATS vs Vegas
      if (game.vegasSpread !== undefined) {
        const pickHome = game.predictedSpread < game.vegasSpread;
        if (pickHome) {
          // Betting home to cover
          if (game.actualSpread < game.vegasSpread) game.atsVegasResult = 'win';
          else if (game.actualSpread > game.vegasSpread) game.atsVegasResult = 'loss';
          else game.atsVegasResult = 'push';
        } else {
          // Betting away to cover
          if (game.actualSpread > game.vegasSpread) game.atsVegasResult = 'win';
          else if (game.actualSpread < game.vegasSpread) game.atsVegasResult = 'loss';
          else game.atsVegasResult = 'push';
        }

        if (game.atsVegasResult === 'win') atsVegasWins++;
        else if (game.atsVegasResult === 'loss') atsVegasLosses++;
        else atsVegasPushes++;
      }

      // O/U vs Vegas
      if (game.vegasTotal !== undefined) {
        const pickOver = game.predictedTotal > game.vegasTotal;
        if (pickOver) {
          if (game.actualTotal > game.vegasTotal) game.ouVegasResult = 'win';
          else if (game.actualTotal < game.vegasTotal) game.ouVegasResult = 'loss';
          else game.ouVegasResult = 'push';
        } else {
          if (game.actualTotal < game.vegasTotal) game.ouVegasResult = 'win';
          else if (game.actualTotal > game.vegasTotal) game.ouVegasResult = 'loss';
          else game.ouVegasResult = 'push';
        }

        if (game.ouVegasResult === 'win') ouVegasWins++;
        else if (game.ouVegasResult === 'loss') ouVegasLosses++;
        else ouVegasPushes++;

        // High edge O/U (5+ pts)
        const totalEdge = Math.abs(game.predictedTotal - game.vegasTotal);
        if (totalEdge >= 5) {
          if (game.ouVegasResult === 'win') ouHighEdgeWins++;
          else if (game.ouVegasResult === 'loss') ouHighEdgeLosses++;
        }
      }

      // Count overall stats
      if (game.spreadResult === 'win') atsWins++;
      else if (game.spreadResult === 'loss') atsLosses++;
      else atsPushes++;

      if (game.mlResult === 'win') mlWins++;
      else mlLosses++;

      if (game.ouResult === 'win') ouWins++;
      else if (game.ouResult === 'loss') ouLosses++;
      else ouPushes++;

      // High edge ML (15%+ = homeWinProb >= 0.65 or <= 0.35)
      const mlEdge = Math.abs(game.homeWinProb - 0.5) * 100;
      if (mlEdge >= 15) {
        if (game.mlResult === 'win') mlHighEdgeWins++;
        else mlHighEdgeLosses++;
      }
    }

    // Calculate percentages
    const atsVegasPct = atsVegasWins + atsVegasLosses > 0
      ? ((atsVegasWins / (atsVegasWins + atsVegasLosses)) * 100).toFixed(1)
      : '0';
    const ouVegasPct = ouVegasWins + ouVegasLosses > 0
      ? ((ouVegasWins / (ouVegasWins + ouVegasLosses)) * 100).toFixed(1)
      : '0';
    const mlPct = mlWins + mlLosses > 0
      ? ((mlWins / (mlWins + mlLosses)) * 100).toFixed(1)
      : '0';
    const mlHighEdgePct = mlHighEdgeWins + mlHighEdgeLosses > 0
      ? ((mlHighEdgeWins / (mlHighEdgeWins + mlHighEdgeLosses)) * 100).toFixed(1)
      : '0';
    const ouHighEdgePct = ouHighEdgeWins + ouHighEdgeLosses > 0
      ? ((ouHighEdgeWins / (ouHighEdgeWins + ouHighEdgeLosses)) * 100).toFixed(1)
      : '0';

    log(`Games affected by cap: ${gamesAffected}`);
    log(`Spread picks flipped: ${spreadFlipped}`);
    log(`O/U picks flipped: ${ouFlipped}`);
    log(`ATS vs Vegas: ${atsVegasWins}-${atsVegasLosses}-${atsVegasPushes} (${atsVegasPct}%)`);
    log(`O/U vs Vegas: ${ouVegasWins}-${ouVegasLosses}-${ouVegasPushes} (${ouVegasPct}%)`);
    log(`ML overall: ${mlWins}-${mlLosses} (${mlPct}%)`);
    log(`ML 15%+ edge: ${mlHighEdgeWins}-${mlHighEdgeLosses} (${mlHighEdgePct}%)`);
    log(`O/U 5+ pt edge: ${ouHighEdgeWins}-${ouHighEdgeLosses} (${ouHighEdgePct}%)`);

    // Update blob with recalculated results
    blobData.backtest.results = results;
    blobData.backtest.recalculatedWithCap = new Date().toISOString();
    blobData.backtest.eloCap = ELO_CAP;

    // Save updated blob
    const jsonString = JSON.stringify(blobData);
    log(`Uploading updated blob (${Math.round(jsonString.length / 1024)}KB)...`);

    await put('prediction-matrix-data.json', jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    log('Done!');

    return NextResponse.json({
      success: true,
      eloCap: ELO_CAP,
      gamesAffected,
      spreadFlipped,
      ouFlipped,
      stats: {
        atsVsVegas: {
          record: `${atsVegasWins}-${atsVegasLosses}-${atsVegasPushes}`,
          pct: atsVegasPct,
          games: atsVegasWins + atsVegasLosses + atsVegasPushes,
        },
        ouVsVegas: {
          record: `${ouVegasWins}-${ouVegasLosses}-${ouVegasPushes}`,
          pct: ouVegasPct,
          games: ouVegasWins + ouVegasLosses + ouVegasPushes,
        },
        ml: {
          record: `${mlWins}-${mlLosses}`,
          pct: mlPct,
        },
        mlHighEdge: {
          record: `${mlHighEdgeWins}-${mlHighEdgeLosses}`,
          pct: mlHighEdgePct,
          threshold: '15%+ edge',
        },
        ouHighEdge: {
          record: `${ouHighEdgeWins}-${ouHighEdgeLosses}`,
          pct: ouHighEdgePct,
          threshold: '5+ pt edge',
        },
      },
      logs,
    });
  } catch (error) {
    console.error('Recalculate error:', error);
    return NextResponse.json({
      error: 'Failed to recalculate',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
