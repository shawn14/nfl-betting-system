import { NextResponse } from 'next/server';
import { getAllTeams, getAllGames } from '@/services/database';
import { updateEloAfterGame } from '@/services/elo';
import { Game, Team } from '@/types';

// Constants from our calibrated model
const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.0593;
const HOME_FIELD_ADVANTAGE = 2.28;
const ELO_HOME_ADVANTAGE = 48;

// Optimized spread betting parameters (from backtesting 227 games)
const SPREAD_REGRESSION = 0.55;   // Shrink spread predictions 55% toward 0
const ELO_CAP = 4;                // Max Elo adjustment in points (±4)

interface BacktestResult {
  gameId: string;
  gameTime: string;
  week?: number;
  homeTeam: string;
  awayTeam: string;
  // Pre-game state
  homeElo: number;
  awayElo: number;
  // Our predictions (using pre-game Elo)
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number; // From home team perspective (negative = home favored)
  predictedTotal: number;
  homeWinProb: number;
  // Vegas lines (if available)
  vegasSpread?: number;
  vegasTotal?: number;
  // Actual results
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  homeWon: boolean;
  // Betting results
  spreadPick: 'home' | 'away';
  spreadResult?: 'win' | 'loss' | 'push';
  mlPick: 'home' | 'away';
  mlResult: 'win' | 'loss';
  ouPick?: 'over' | 'under';
  ouResult?: 'win' | 'loss' | 'push';
}

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  // Regress stats toward league average
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  // Base scores
  let homeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  let awayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  // Elo adjustment with cap
  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;

  // Cap Elo adjustment to prevent overconfidence on big mismatches
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  homeScore += eloAdj;
  awayScore -= eloAdj;

  // Home field
  homeScore += HOME_FIELD_ADVANTAGE / 2;
  awayScore -= HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

// Calculate spread with regression applied
function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET() {
  try {
    const allTeams = await getAllTeams('nfl');
    const allGames = await getAllGames('nfl');

    // Filter completed games and sort chronologically
    const completedGames = allGames
      .filter((g): g is Game =>
        g.status === 'final' &&
        g.homeScore !== undefined &&
        g.awayScore !== undefined
      )
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    // Build team stats map (PPG data)
    const teamStats = new Map<string, { ppg: number; ppgAllowed: number }>();
    for (const team of allTeams) {
      teamStats.set(team.id, {
        ppg: team.ppg || LEAGUE_AVG_PPG,
        ppgAllowed: team.ppgAllowed || LEAGUE_AVG_PPG,
      });
    }

    // Track running Elo for each team
    const teamElos = new Map<string, number>();
    for (const team of allTeams) {
      teamElos.set(team.id, 1500); // Start fresh
    }

    const results: BacktestResult[] = [];
    let spreadWins = 0, spreadLosses = 0, spreadPushes = 0;
    let mlWins = 0, mlLosses = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;

    for (const game of completedGames) {
      const homeElo = teamElos.get(game.homeTeamId) || 1500;
      const awayElo = teamElos.get(game.awayTeamId) || 1500;

      const homeTeamData = allTeams.find(t => t.id === game.homeTeamId);
      const awayTeamData = allTeams.find(t => t.id === game.awayTeamId);

      const homeStats = teamStats.get(game.homeTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };
      const awayStats = teamStats.get(game.awayTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };

      // Predict using pre-game Elo
      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo,
        homeStats.ppg, homeStats.ppgAllowed,
        awayStats.ppg, awayStats.ppgAllowed
      );

      const predictedSpread = calculateSpread(predHome, predAway); // With regression applied
      const predictedTotal = predHome + predAway;

      // Win probability
      const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

      // Actual results
      const actualHomeScore = game.homeScore!;
      const actualAwayScore = game.awayScore!;
      const actualSpread = actualAwayScore - actualHomeScore;
      const actualTotal = actualHomeScore + actualAwayScore;
      const homeWon = actualHomeScore > actualAwayScore;

      // Our picks
      const spreadPick = predictedSpread < 0 ? 'home' : 'away'; // We pick whoever we predict to cover
      const mlPick = homeWinProb > 0.5 ? 'home' : 'away';

      // Spread result (using our predicted spread as the line)
      // If we picked home and actual spread < predicted spread, we win
      let spreadResult: 'win' | 'loss' | 'push' | undefined;
      if (spreadPick === 'home') {
        if (actualSpread < predictedSpread) spreadResult = 'win';
        else if (actualSpread > predictedSpread) spreadResult = 'loss';
        else spreadResult = 'push';
      } else {
        if (actualSpread > predictedSpread) spreadResult = 'win';
        else if (actualSpread < predictedSpread) spreadResult = 'loss';
        else spreadResult = 'push';
      }

      // ML result
      const mlResult: 'win' | 'loss' = (mlPick === 'home' && homeWon) || (mlPick === 'away' && !homeWon) ? 'win' : 'loss';

      // O/U result
      const ouPick = predictedTotal > actualTotal ? 'under' : 'over'; // We're predicting, so pick based on our total vs league avg
      // Actually, let's use a fixed baseline - if our total > 44 (avg), lean over
      const ouPickActual: 'over' | 'under' = predictedTotal > 44 ? 'over' : 'under';
      let ouResult: 'win' | 'loss' | 'push' | undefined;
      if (ouPickActual === 'over') {
        if (actualTotal > 44) ouResult = 'win';
        else if (actualTotal < 44) ouResult = 'loss';
        else ouResult = 'push';
      } else {
        if (actualTotal < 44) ouResult = 'win';
        else if (actualTotal > 44) ouResult = 'loss';
        else ouResult = 'push';
      }

      // Track records
      if (spreadResult === 'win') spreadWins++;
      else if (spreadResult === 'loss') spreadLosses++;
      else spreadPushes++;

      if (mlResult === 'win') mlWins++;
      else mlLosses++;

      if (ouResult === 'win') ouWins++;
      else if (ouResult === 'loss') ouLosses++;
      else ouPushes++;

      results.push({
        gameId: game.id,
        gameTime: game.gameTime.toString(),
        week: game.week,
        homeTeam: homeTeamData?.abbreviation || game.homeTeamId,
        awayTeam: awayTeamData?.abbreviation || game.awayTeamId,
        homeElo,
        awayElo,
        predictedHomeScore: predHome,
        predictedAwayScore: predAway,
        predictedSpread: Math.round(predictedSpread * 2) / 2,
        predictedTotal: Math.round(predictedTotal * 2) / 2,
        homeWinProb: Math.round(homeWinProb * 100) / 100,
        actualHomeScore,
        actualAwayScore,
        actualSpread,
        actualTotal,
        homeWon,
        spreadPick,
        spreadResult,
        mlPick,
        mlResult,
        ouPick: ouPickActual,
        ouResult,
      });

      // Update Elos for next game
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        homeTeamObj, awayTeamObj,
        actualHomeScore, actualAwayScore
      );
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
    }

    // Calculate win percentages
    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    return NextResponse.json({
      summary: {
        totalGames: results.length,
        spread: {
          wins: spreadWins,
          losses: spreadLosses,
          pushes: spreadPushes,
          winPct: spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0,
        },
        moneyline: {
          wins: mlWins,
          losses: mlLosses,
          winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0,
        },
        overUnder: {
          wins: ouWins,
          losses: ouLosses,
          pushes: ouPushes,
          winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0,
        },
      },
      results: results.reverse(), // Most recent first
    });
  } catch (error) {
    console.error('Backtest error:', error);
    return NextResponse.json({
      error: 'Backtest failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
