import { NextResponse } from 'next/server';
import { head } from '@vercel/blob';

interface BacktestGame {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  actualHomeScore: number;
  actualAwayScore: number;
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  conviction?: {
    isHighConviction: boolean;
  };
}

interface SimulationResult {
  params: {
    spreadRegression: number;
    eloToPoints: number;
    homeCourtAdv: number;
    eloCap: number;
  };
  ats: { wins: number; losses: number; pushes: number; winPct: number };
  highConvictionATS: { wins: number; losses: number; pushes: number; winPct: number; total: number };
  ou: { wins: number; losses: number; pushes: number; winPct: number };
  totalGames: number;
}

const LEAGUE_AVG_PPG = 112;
const ELO_HOME_ADVANTAGE = 48;

function predictWithParams(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number,
  params: { eloToPoints: number; homeCourtAdv: number; eloCap: number }
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;

  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  const baseHomeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  const baseAwayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * params.eloToPoints) / 2;
  if (params.eloCap > 0) {
    eloAdj = Math.max(-params.eloCap / 2, Math.min(params.eloCap / 2, eloAdj));
  }

  const homeScore = baseHomeScore + eloAdj + params.homeCourtAdv / 2;
  const awayScore = baseAwayScore - eloAdj + params.homeCourtAdv / 2;

  return { homeScore, awayScore };
}

function calculateSpread(homeScore: number, awayScore: number, spreadRegression: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - spreadRegression) * 2) / 2;
}

function runSimulation(
  games: BacktestGame[],
  params: { spreadRegression: number; eloToPoints: number; homeCourtAdv: number; eloCap: number }
): SimulationResult {
  let atsWins = 0, atsLosses = 0, atsPushes = 0;
  let highConvAtsWins = 0, highConvAtsLosses = 0, highConvAtsPushes = 0;
  let ouWins = 0, ouLosses = 0, ouPushes = 0;
  let gamesWithSpread = 0, gamesWithTotal = 0;

  for (const game of games) {
    // Skip games without Vegas data
    if (game.vegasSpread === undefined || game.vegasSpread === null) continue;

    // Use stored PPG or estimate from scores (rough proxy)
    const homePPG = game.predictedHomeScore;
    const awayPPG = game.predictedAwayScore;
    const homePPGAllowed = LEAGUE_AVG_PPG;
    const awayPPGAllowed = LEAGUE_AVG_PPG;

    // Recalculate prediction with new params
    const { homeScore, awayScore } = predictWithParams(
      game.homeElo,
      game.awayElo,
      homePPG,
      homePPGAllowed,
      awayPPG,
      awayPPGAllowed,
      params
    );

    const predictedSpread = calculateSpread(homeScore, awayScore, params.spreadRegression);
    const predictedTotal = homeScore + awayScore;
    const actualSpread = game.actualAwayScore - game.actualHomeScore;
    const actualTotal = game.actualHomeScore + game.actualAwayScore;

    // ATS vs Vegas
    gamesWithSpread++;
    const vegasSpread = game.vegasSpread;
    const pickHome = predictedSpread < vegasSpread;

    let atsResult: 'win' | 'loss' | 'push';
    if (pickHome) {
      if (actualSpread < vegasSpread) atsResult = 'win';
      else if (actualSpread > vegasSpread) atsResult = 'loss';
      else atsResult = 'push';
    } else {
      if (actualSpread > vegasSpread) atsResult = 'win';
      else if (actualSpread < vegasSpread) atsResult = 'loss';
      else atsResult = 'push';
    }

    // Track overall ATS
    if (atsResult === 'win') atsWins++;
    else if (atsResult === 'loss') atsLosses++;
    else atsPushes++;

    // Track high conviction ATS (games that were marked as high conviction in original data)
    if (game.conviction?.isHighConviction === true) {
      if (atsResult === 'win') highConvAtsWins++;
      else if (atsResult === 'loss') highConvAtsLosses++;
      else highConvAtsPushes++;
    }

    // O/U vs Vegas
    if (game.vegasTotal !== undefined && game.vegasTotal !== null && game.vegasTotal > 0) {
      gamesWithTotal++;
      const vegasTotal = game.vegasTotal;
      const pickOver = predictedTotal > vegasTotal;

      if (pickOver) {
        if (actualTotal > vegasTotal) ouWins++;
        else if (actualTotal < vegasTotal) ouLosses++;
        else ouPushes++;
      } else {
        if (actualTotal < vegasTotal) ouWins++;
        else if (actualTotal > vegasTotal) ouLosses++;
        else ouPushes++;
      }
    }
  }

  const atsTotal = atsWins + atsLosses;
  const highConvAtsTotal = highConvAtsWins + highConvAtsLosses;
  const ouTotal = ouWins + ouLosses;

  return {
    params,
    ats: {
      wins: atsWins,
      losses: atsLosses,
      pushes: atsPushes,
      winPct: atsTotal > 0 ? Math.round((atsWins / atsTotal) * 1000) / 10 : 0,
    },
    highConvictionATS: {
      wins: highConvAtsWins,
      losses: highConvAtsLosses,
      pushes: highConvAtsPushes,
      winPct: highConvAtsTotal > 0 ? Math.round((highConvAtsWins / highConvAtsTotal) * 1000) / 10 : 0,
      total: highConvAtsTotal + highConvAtsPushes,
    },
    ou: {
      wins: ouWins,
      losses: ouLosses,
      pushes: ouPushes,
      winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0,
    },
    totalGames: gamesWithSpread,
  };
}

export async function GET() {
  try {
    // Fetch backtest data from blob
    const blobInfo = await head('nba-prediction-data.json');
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'No NBA blob data found' }, { status: 404 });
    }

    const response = await fetch(blobInfo.url);
    const blobData = await response.json();
    const games: BacktestGame[] = blobData.backtest?.results || [];

    const gamesWithVegas = games.filter(g => g.vegasSpread !== undefined && g.vegasSpread !== null);
    const highConvGames = gamesWithVegas.filter(g => g.conviction?.isHighConviction === true);

    console.log(`Total games: ${games.length}`);
    console.log(`Games with Vegas lines: ${gamesWithVegas.length}`);
    console.log(`High conviction games: ${highConvGames.length}`);

    // Current parameters (from nba-sync/route.ts)
    const currentParams = {
      spreadRegression: 0.4,
      eloToPoints: 0.06,
      homeCourtAdv: 4.5,
      eloCap: 20,
    };

    // Grid search ranges - focus on home court advantage
    const spreadRegressionRange = [0.35, 0.4, 0.45];
    const eloToPointsRange = [0.05, 0.055, 0.06, 0.065, 0.07];
    const homeCourtAdvRange = [2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
    const eloCapRange = [16, 18, 20, 22, 24];

    const results: SimulationResult[] = [];

    // Test current params first
    console.log('Testing current params...');
    const currentResult = runSimulation(gamesWithVegas, currentParams);
    results.push(currentResult);

    // Grid search - test home court advantage primarily
    console.log('Testing home court advantage...');
    for (const hca of homeCourtAdvRange) {
      if (hca === currentParams.homeCourtAdv) continue;
      results.push(runSimulation(gamesWithVegas, { ...currentParams, homeCourtAdv: hca }));
    }

    console.log('Testing spread regression...');
    for (const sr of spreadRegressionRange) {
      if (sr === currentParams.spreadRegression) continue;
      results.push(runSimulation(gamesWithVegas, { ...currentParams, spreadRegression: sr }));
    }

    console.log('Testing elo to points...');
    for (const etp of eloToPointsRange) {
      if (etp === currentParams.eloToPoints) continue;
      results.push(runSimulation(gamesWithVegas, { ...currentParams, eloToPoints: etp }));
    }

    console.log('Testing elo cap...');
    for (const ec of eloCapRange) {
      if (ec === currentParams.eloCap) continue;
      results.push(runSimulation(gamesWithVegas, { ...currentParams, eloCap: ec }));
    }

    // Focused grid search - combinations around best values
    console.log('Running focused grid search...');
    const focusedHCA = [2.5, 3.0, 3.5, 4.0];
    const focusedSR = [0.35, 0.4, 0.45];
    const focusedETP = [0.055, 0.06, 0.065];
    const focusedEC = [18, 20, 22];

    for (const hca of focusedHCA) {
      for (const sr of focusedSR) {
        for (const etp of focusedETP) {
          for (const ec of focusedEC) {
            results.push(runSimulation(gamesWithVegas, {
              spreadRegression: sr,
              eloToPoints: etp,
              homeCourtAdv: hca,
              eloCap: ec,
            }));
          }
        }
      }
    }

    // Sort by overall ATS win percentage
    const sortedByATS = [...results].sort((a, b) => b.ats.winPct - a.ats.winPct);

    // Sort by high conviction ATS
    const sortedByHighConv = [...results].sort((a, b) => b.highConvictionATS.winPct - a.highConvictionATS.winPct);

    // Sort by O/U
    const sortedByOU = [...results].sort((a, b) => b.ou.winPct - a.ou.winPct);

    // Combined score (weighted: 40% overall ATS, 40% high conviction ATS, 20% O/U)
    const sortedByCombined = [...results].sort((a, b) => {
      const scoreA = a.ats.winPct * 0.4 + a.highConvictionATS.winPct * 0.4 + a.ou.winPct * 0.2;
      const scoreB = b.ats.winPct * 0.4 + b.highConvictionATS.winPct * 0.4 + b.ou.winPct * 0.2;
      return scoreB - scoreA;
    });

    return NextResponse.json({
      totalGames: games.length,
      gamesWithVegas: gamesWithVegas.length,
      highConvictionGames: highConvGames.length,
      currentParams,
      currentPerformance: currentResult,
      bestOverallATS: sortedByATS.slice(0, 10),
      bestHighConvictionATS: sortedByHighConv.slice(0, 10),
      bestOU: sortedByOU.slice(0, 10),
      bestCombined: sortedByCombined.slice(0, 10),
      totalSimulations: results.length,
    });
  } catch (error) {
    console.error('NBA optimization error:', error);
    return NextResponse.json({
      error: 'NBA optimization failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
