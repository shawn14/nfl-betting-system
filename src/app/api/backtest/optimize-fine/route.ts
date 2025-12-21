import { NextResponse } from 'next/server';
import { getAllTeams, getAllGames } from '@/services/database';
import { updateEloAfterGame } from '@/services/elo';
import { Game, Team } from '@/types';

const LEAGUE_AVG_PPG = 22;

interface SimulationParams {
  eloToPoints: number;
  homeFieldAdv: number;
  spreadRegression: number;
  eloCap: number;
  minSpread: number;
  maxSpread: number;
  statsRegression: number;
}

interface SimulationResult {
  params: SimulationParams;
  spread: { wins: number; losses: number; pushes: number; winPct: number; bets: number };
  profit: number;
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

    const regress = (stat: number) => stat * (1 - params.statsRegression) + LEAGUE_AVG_PPG * params.statsRegression;
    const regHomePPG = regress(homeStats.ppg);
    const regHomePPGAllowed = regress(homeStats.ppgAllowed);
    const regAwayPPG = regress(awayStats.ppg);
    const regAwayPPGAllowed = regress(awayStats.ppgAllowed);

    let homeScore = (regHomePPG + regAwayPPGAllowed) / 2;
    let awayScore = (regAwayPPG + regHomePPGAllowed) / 2;

    const eloDiff = homeElo - awayElo;
    let eloAdj = (eloDiff * params.eloToPoints / 100) / 2;

    if (params.eloCap > 0) {
      eloAdj = Math.max(-params.eloCap / 2, Math.min(params.eloCap / 2, eloAdj));
    }

    homeScore += eloAdj;
    awayScore -= eloAdj;

    homeScore += params.homeFieldAdv / 2;
    awayScore -= params.homeFieldAdv / 2;

    let predictedSpread = awayScore - homeScore;
    predictedSpread = predictedSpread * (1 - params.spreadRegression);

    const actualHomeScore = game.homeScore!;
    const actualAwayScore = game.awayScore!;
    const actualSpread = actualAwayScore - actualHomeScore;

    const absSpread = Math.abs(predictedSpread);
    if (absSpread < params.minSpread || absSpread > params.maxSpread) {
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(homeTeamObj, awayTeamObj, actualHomeScore, actualAwayScore);
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
      continue;
    }

    const spreadPick = predictedSpread < 0 ? 'home' : 'away';

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

    const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
    const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
    const { homeNewElo, awayNewElo } = updateEloAfterGame(homeTeamObj, awayTeamObj, actualHomeScore, actualAwayScore);
    teamElos.set(game.homeTeamId, homeNewElo);
    teamElos.set(game.awayTeamId, awayNewElo);
  }

  const total = wins + losses;
  const winPct = total > 0 ? Math.round((wins / total) * 1000) / 10 : 0;
  const profit = wins * 100 - losses * 110;

  return { params, spread: { wins, losses, pushes, winPct, bets: total }, profit };
}

export async function GET() {
  try {
    const allTeams = await getAllTeams('nfl');
    const allGames = await getAllGames('nfl');

    const completedGames = allGames
      .filter((g): g is Game => g.status === 'final' && g.homeScore !== undefined && g.awayScore !== undefined)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    const results: SimulationResult[] = [];

    // Fine-tune around the best parameters found:
    // spreadRegression: 0.45, eloCap: 5, maxSpread: 8

    // Fine search on spread regression
    for (const sr of [0.40, 0.42, 0.44, 0.45, 0.46, 0.48, 0.50, 0.52, 0.55]) {
      for (const cap of [0, 4, 5, 6, 7]) {
        for (const max of [6, 7, 8, 9, 10, 12, 15, 20]) {
          results.push(runSimulation(completedGames, allTeams, {
            eloToPoints: 5.93,
            homeFieldAdv: 2.28,
            spreadRegression: sr,
            eloCap: cap,
            minSpread: 0,
            maxSpread: max,
            statsRegression: 0.3,
          }));
        }
      }
    }

    // Also test with different home field values
    for (const hf of [1.5, 2.0, 2.5, 3.0]) {
      results.push(runSimulation(completedGames, allTeams, {
        eloToPoints: 5.93,
        homeFieldAdv: hf,
        spreadRegression: 0.45,
        eloCap: 5,
        minSpread: 0,
        maxSpread: 8,
        statsRegression: 0.3,
      }));
    }

    // Test with different stats regression
    for (const sr of [0.2, 0.25, 0.35, 0.4]) {
      results.push(runSimulation(completedGames, allTeams, {
        eloToPoints: 5.93,
        homeFieldAdv: 2.28,
        spreadRegression: 0.45,
        eloCap: 5,
        minSpread: 0,
        maxSpread: 8,
        statsRegression: sr,
      }));
    }

    // Sort by profit
    results.sort((a, b) => b.profit - a.profit);

    // Get current baseline for comparison
    const currentBaseline = runSimulation(completedGames, allTeams, {
      eloToPoints: 5.93,
      homeFieldAdv: 2.28,
      spreadRegression: 0,
      eloCap: 0,
      minSpread: 0,
      maxSpread: 20,
      statsRegression: 0.3,
    });

    return NextResponse.json({
      totalSimulations: results.length,
      gamesAnalyzed: completedGames.length,
      currentBaseline,
      bestOverall: results[0],
      top10: results.slice(0, 10),
      // Group best by different max spread limits
      bestByMaxSpread: {
        'max6': results.filter(r => r.params.maxSpread === 6).sort((a, b) => b.profit - a.profit)[0],
        'max8': results.filter(r => r.params.maxSpread === 8).sort((a, b) => b.profit - a.profit)[0],
        'max10': results.filter(r => r.params.maxSpread === 10).sort((a, b) => b.profit - a.profit)[0],
        'max20': results.filter(r => r.params.maxSpread === 20).sort((a, b) => b.profit - a.profit)[0],
      },
    });
  } catch (error) {
    console.error('Fine optimization error:', error);
    return NextResponse.json({ error: 'Failed', message: error instanceof Error ? error.message : 'Unknown' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
