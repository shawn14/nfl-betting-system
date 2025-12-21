import { NextResponse } from 'next/server';
import { getAllTeams, getAllGames } from '@/services/database';
import { updateEloAfterGame } from '@/services/elo';
import { Game, Team } from '@/types';

const LEAGUE_AVG_PPG = 22;
const BASE_HOME_FIELD = 2.28;

interface SimulationParams {
  eloToPoints: number;      // How many points per 100 Elo
  homeFieldAdv: number;     // Home field advantage in points
  spreadRegression: number; // Shrink spread toward 0 (0 = no shrink, 0.5 = halve it)
  eloCap: number;           // Max Elo adjustment in points (0 = no cap)
  minSpread: number;        // Only bet if |spread| >= this
  maxSpread: number;        // Only bet if |spread| <= this
  statsRegression: number;  // Regress PPG stats toward mean (0-1)
}

interface SimulationResult {
  params: SimulationParams;
  spread: { wins: number; losses: number; pushes: number; winPct: number; bets: number };
  profit: number; // Assuming -110 odds
}

function runSimulation(
  completedGames: Game[],
  allTeams: Team[],
  params: SimulationParams
): SimulationResult {
  const teamStats = new Map<string, { ppg: number; ppgAllowed: number }>();
  for (const team of allTeams) {
    teamStats.set(team.id, {
      ppg: team.ppg || LEAGUE_AVG_PPG,
      ppgAllowed: team.ppgAllowed || LEAGUE_AVG_PPG,
    });
  }

  const teamElos = new Map<string, number>();
  for (const team of allTeams) {
    teamElos.set(team.id, 1500);
  }

  let wins = 0, losses = 0, pushes = 0;

  for (const game of completedGames) {
    const homeElo = teamElos.get(game.homeTeamId) || 1500;
    const awayElo = teamElos.get(game.awayTeamId) || 1500;

    const homeStats = teamStats.get(game.homeTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };
    const awayStats = teamStats.get(game.awayTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };

    // Predict score with params
    const regress = (stat: number) => stat * (1 - params.statsRegression) + LEAGUE_AVG_PPG * params.statsRegression;
    const regHomePPG = regress(homeStats.ppg);
    const regHomePPGAllowed = regress(homeStats.ppgAllowed);
    const regAwayPPG = regress(awayStats.ppg);
    const regAwayPPGAllowed = regress(awayStats.ppgAllowed);

    let homeScore = (regHomePPG + regAwayPPGAllowed) / 2;
    let awayScore = (regAwayPPG + regHomePPGAllowed) / 2;

    // Elo adjustment
    const eloDiff = homeElo - awayElo;
    let eloAdj = (eloDiff * params.eloToPoints / 100) / 2;

    // Apply Elo cap if set
    if (params.eloCap > 0) {
      eloAdj = Math.max(-params.eloCap / 2, Math.min(params.eloCap / 2, eloAdj));
    }

    homeScore += eloAdj;
    awayScore -= eloAdj;

    // Home field
    homeScore += params.homeFieldAdv / 2;
    awayScore -= params.homeFieldAdv / 2;

    // Calculate spread (away - home, negative = home favored)
    let predictedSpread = awayScore - homeScore;

    // Apply spread regression toward 0
    predictedSpread = predictedSpread * (1 - params.spreadRegression);

    const actualHomeScore = game.homeScore!;
    const actualAwayScore = game.awayScore!;
    const actualSpread = actualAwayScore - actualHomeScore;

    // Check if we should bet based on spread size filters
    const absSpread = Math.abs(predictedSpread);
    if (absSpread < params.minSpread || absSpread > params.maxSpread) {
      // Skip this game - update Elos and continue
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        homeTeamObj, awayTeamObj,
        actualHomeScore, actualAwayScore
      );
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
      continue;
    }

    // Our pick
    const spreadPick = predictedSpread < 0 ? 'home' : 'away';

    // Determine result
    let spreadResult: 'win' | 'loss' | 'push';
    if (spreadPick === 'home') {
      if (actualSpread < predictedSpread) spreadResult = 'win';
      else if (actualSpread > predictedSpread) spreadResult = 'loss';
      else spreadResult = 'push';
    } else {
      if (actualSpread > predictedSpread) spreadResult = 'win';
      else if (actualSpread < predictedSpread) spreadResult = 'loss';
      else spreadResult = 'push';
    }

    if (spreadResult === 'win') wins++;
    else if (spreadResult === 'loss') losses++;
    else pushes++;

    // Update Elos
    const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
    const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
    const { homeNewElo, awayNewElo } = updateEloAfterGame(
      homeTeamObj, awayTeamObj,
      actualHomeScore, actualAwayScore
    );
    teamElos.set(game.homeTeamId, homeNewElo);
    teamElos.set(game.awayTeamId, awayNewElo);
  }

  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;

  // Calculate profit assuming -110 odds (risk 110 to win 100)
  // Each win: +100, each loss: -110
  const profit = wins * 100 - losses * 110;

  return {
    params,
    spread: { wins, losses, pushes, winPct, bets: total },
    profit,
  };
}

export async function GET() {
  try {
    const allTeams = await getAllTeams('nfl');
    const allGames = await getAllGames('nfl');

    const completedGames = allGames
      .filter((g): g is Game =>
        g.status === 'final' &&
        g.homeScore !== undefined &&
        g.awayScore !== undefined
      )
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    const results: SimulationResult[] = [];

    // Test different parameter combinations
    const eloToPointsOptions = [4, 5, 5.93, 7, 8];
    const homeFieldOptions = [1.5, 2, 2.28, 2.5, 3];
    const spreadRegressionOptions = [0, 0.1, 0.2, 0.3, 0.4, 0.5];
    const eloCapOptions = [0, 4, 6, 8, 10];
    const minSpreadOptions = [0, 1, 2, 3];
    const maxSpreadOptions = [3, 5, 7, 10, 20];
    const statsRegressionOptions = [0.2, 0.3, 0.4];

    // First pass: test key parameters individually against baseline
    const baseline: SimulationParams = {
      eloToPoints: 5.93,
      homeFieldAdv: 2.28,
      spreadRegression: 0,
      eloCap: 0,
      minSpread: 0,
      maxSpread: 20,
      statsRegression: 0.3,
    };

    // Baseline
    results.push(runSimulation(completedGames, allTeams, baseline));

    // Test spread regression (most promising based on analysis)
    for (const sr of spreadRegressionOptions) {
      if (sr === 0) continue;
      results.push(runSimulation(completedGames, allTeams, { ...baseline, spreadRegression: sr }));
    }

    // Test Elo cap
    for (const cap of eloCapOptions) {
      if (cap === 0) continue;
      results.push(runSimulation(completedGames, allTeams, { ...baseline, eloCap: cap }));
    }

    // Test max spread filter
    for (const max of maxSpreadOptions) {
      if (max === 20) continue;
      results.push(runSimulation(completedGames, allTeams, { ...baseline, maxSpread: max }));
    }

    // Test min spread filter
    for (const min of minSpreadOptions) {
      if (min === 0) continue;
      results.push(runSimulation(completedGames, allTeams, { ...baseline, minSpread: min }));
    }

    // Test combined: spread regression + max spread
    for (const sr of [0.2, 0.3, 0.4]) {
      for (const max of [5, 7, 10]) {
        results.push(runSimulation(completedGames, allTeams, {
          ...baseline,
          spreadRegression: sr,
          maxSpread: max,
        }));
      }
    }

    // Test combined: Elo cap + spread regression
    for (const cap of [4, 6, 8]) {
      for (const sr of [0.2, 0.3]) {
        results.push(runSimulation(completedGames, allTeams, {
          ...baseline,
          eloCap: cap,
          spreadRegression: sr,
        }));
      }
    }

    // Test different Elo-to-points values with spread regression
    for (const etp of eloToPointsOptions) {
      if (etp === 5.93) continue;
      for (const sr of [0, 0.2, 0.3]) {
        results.push(runSimulation(completedGames, allTeams, {
          ...baseline,
          eloToPoints: etp,
          spreadRegression: sr,
        }));
      }
    }

    // Test home field variations
    for (const hf of homeFieldOptions) {
      if (hf === 2.28) continue;
      results.push(runSimulation(completedGames, allTeams, { ...baseline, homeFieldAdv: hf }));
    }

    // Deep search on most promising combinations
    // Based on preliminary results, do a finer search
    for (const sr of [0.15, 0.25, 0.35, 0.45]) {
      for (const cap of [0, 5, 7]) {
        for (const max of [6, 8, 12]) {
          results.push(runSimulation(completedGames, allTeams, {
            ...baseline,
            spreadRegression: sr,
            eloCap: cap,
            maxSpread: max,
          }));
        }
      }
    }

    // Sort by profit
    results.sort((a, b) => b.profit - a.profit);

    // Filter to only show results with enough bets (at least 50)
    const viableResults = results.filter(r => r.spread.bets >= 50);

    // Get unique top results (avoid near-duplicates)
    const topResults: SimulationResult[] = [];
    for (const result of viableResults) {
      if (topResults.length >= 20) break;

      // Check if similar params already in top results
      const isDuplicate = topResults.some(tr =>
        Math.abs(tr.params.spreadRegression - result.params.spreadRegression) < 0.05 &&
        Math.abs(tr.params.eloCap - result.params.eloCap) < 1 &&
        Math.abs(tr.params.maxSpread - result.params.maxSpread) < 1
      );

      if (!isDuplicate) {
        topResults.push(result);
      }
    }

    // Find the best by different metrics
    const bestByWinPct = [...viableResults].sort((a, b) => b.spread.winPct - a.spread.winPct)[0];
    const bestByProfit = viableResults[0];
    const bestByVolume = [...viableResults]
      .filter(r => r.spread.winPct >= 52.4)
      .sort((a, b) => b.spread.bets - a.spread.bets)[0];

    return NextResponse.json({
      totalSimulations: results.length,
      gamesAnalyzed: completedGames.length,
      baseline: results.find(r =>
        r.params.spreadRegression === 0 &&
        r.params.eloCap === 0 &&
        r.params.maxSpread === 20
      ),
      bestByWinPct,
      bestByProfit,
      bestByVolume,
      top20: topResults,
    });
  } catch (error) {
    console.error('Optimization error:', error);
    return NextResponse.json({
      error: 'Optimization failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
