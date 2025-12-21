import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fetchNFLTeams, fetchNFLSchedule, fetchAllCompletedGames } from '@/services/espn';
import { updateEloAfterGame } from '@/services/elo';
import { Team } from '@/types';

// Constants
const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.0593;
const HOME_FIELD_ADVANTAGE = 2.28;
const ELO_HOME_ADVANTAGE = 48;
const SPREAD_REGRESSION = 0.55;
const ELO_CAP = 4;

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  let homeScore = (regress(homePPG) + regress(awayPPGAllowed)) / 2;
  let awayScore = (regress(awayPPG) + regress(homePPGAllowed)) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  homeScore += eloAdj + HOME_FIELD_ADVANTAGE / 2;
  awayScore -= eloAdj + HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET() {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('Starting simple blob sync (no Firebase writes)...');

    // 1. Fetch teams from ESPN
    log('Fetching NFL teams from ESPN...');
    const espnTeams = await fetchNFLTeams();
    log(`Fetched ${espnTeams.length} teams`);

    // Build team map with Elo starting at 1500
    interface TeamData {
      id: string;
      name: string;
      abbreviation: string;
      eloRating: number;
      ppg?: number;
      ppgAllowed?: number;
    }
    const teamsMap = new Map<string, TeamData>();
    for (const team of espnTeams) {
      if (!team.id) continue;
      teamsMap.set(team.id, {
        id: team.id,
        name: team.name || '',
        abbreviation: team.abbreviation || '',
        eloRating: team.eloRating || 1500,
        ppg: team.ppg,
        ppgAllowed: team.ppgAllowed,
      });
    }

    // 2. Fetch all completed games
    log('Fetching completed games...');
    const completedGames = await fetchAllCompletedGames();
    log(`Fetched ${completedGames.length} completed games`);

    // 3. Process games chronologically to build Elo
    completedGames.sort((a, b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    const backtestResults = [];
    let spreadWins = 0, spreadLosses = 0, spreadPushes = 0;
    let mlWins = 0, mlLosses = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;

    for (const game of completedGames) {
      if (game.homeScore === undefined || game.awayScore === undefined) continue;
      if (!game.homeTeamId || !game.awayTeamId) continue;

      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      const homeElo = homeTeam.eloRating;
      const awayElo = awayTeam.eloRating;

      // Predict using current Elo
      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;
      const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

      const actualHomeScore = game.homeScore;
      const actualAwayScore = game.awayScore;
      const actualSpread = actualAwayScore - actualHomeScore;
      const actualTotal = actualHomeScore + actualAwayScore;
      const homeWon = actualHomeScore > actualAwayScore;

      const spreadPick = predictedSpread < 0 ? 'home' : 'away';
      const mlPick = homeWinProb > 0.5 ? 'home' : 'away';

      let spreadResult: 'win' | 'loss' | 'push';
      if (spreadPick === 'home') {
        spreadResult = actualSpread < predictedSpread ? 'win' : actualSpread > predictedSpread ? 'loss' : 'push';
      } else {
        spreadResult = actualSpread > predictedSpread ? 'win' : actualSpread < predictedSpread ? 'loss' : 'push';
      }

      const mlResult = (mlPick === 'home' && homeWon) || (mlPick === 'away' && !homeWon) ? 'win' : 'loss';
      const ouPickActual: 'over' | 'under' = predictedTotal > 44 ? 'over' : 'under';
      let ouResult: 'win' | 'loss' | 'push';
      if (ouPickActual === 'over') {
        ouResult = actualTotal > 44 ? 'win' : actualTotal < 44 ? 'loss' : 'push';
      } else {
        ouResult = actualTotal < 44 ? 'win' : actualTotal > 44 ? 'loss' : 'push';
      }

      if (spreadResult === 'win') spreadWins++;
      else if (spreadResult === 'loss') spreadLosses++;
      else spreadPushes++;
      if (mlResult === 'win') mlWins++;
      else mlLosses++;
      if (ouResult === 'win') ouWins++;
      else if (ouResult === 'loss') ouLosses++;
      else ouPushes++;

      backtestResults.push({
        gameId: game.id || '',
        gameTime: game.gameTime || '',
        week: game.week,
        homeTeam: homeTeam.abbreviation,
        awayTeam: awayTeam.abbreviation,
        homeElo, awayElo,
        predictedHomeScore: predHome,
        predictedAwayScore: predAway,
        predictedSpread: Math.round(predictedSpread * 2) / 2,
        predictedTotal: Math.round(predictedTotal * 2) / 2,
        homeWinProb: Math.round(homeWinProb * 100) / 100,
        actualHomeScore, actualAwayScore,
        actualSpread, actualTotal, homeWon,
        spreadPick, spreadResult,
        mlPick, mlResult,
        ouPick: ouPickActual, ouResult,
      });

      // Update Elo for next game
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeElo } as Team,
        { id: game.awayTeamId, eloRating: awayElo } as Team,
        actualHomeScore, actualAwayScore
      );
      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;
    }

    log(`Backtest: ${backtestResults.length} games, Spread: ${spreadWins}-${spreadLosses}`);

    // 4. Fetch upcoming games
    log('Fetching upcoming games...');
    const upcomingGames = await fetchNFLSchedule();
    const upcoming = upcomingGames.filter(g => g.status !== 'final');
    log(`Found ${upcoming.length} upcoming games`);

    // 5. Generate predictions for upcoming
    const gamesWithPredictions = [];
    for (const game of upcoming) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeTeam.eloRating, awayTeam.eloRating,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      const adjustedHomeElo = homeTeam.eloRating + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayTeam.eloRating - adjustedHomeElo) / 400));

      gamesWithPredictions.push({
        game: {
          ...game,
          homeTeam: { id: homeTeam.id, name: homeTeam.name, abbreviation: homeTeam.abbreviation },
          awayTeam: { id: awayTeam.id, name: awayTeam.name, abbreviation: awayTeam.abbreviation },
        },
        prediction: {
          gameId: game.id,
          predictedHomeScore: predHome,
          predictedAwayScore: predAway,
          predictedSpread: calculateSpread(predHome, predAway),
          predictedTotal: predHome + predAway,
          homeWinProbability: homeWinProb,
          confidence: 0.5,
        },
      });
    }

    // 6. Build blob
    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    const blobData = {
      generated: new Date().toISOString(),
      games: gamesWithPredictions.sort((a, b) =>
        new Date(a.game.gameTime || 0).getTime() - new Date(b.game.gameTime || 0).getTime()
      ),
      recentGames: backtestResults.slice().reverse().slice(0, 10).map(r => ({
        id: r.gameId,
        homeTeam: { abbreviation: r.homeTeam },
        awayTeam: { abbreviation: r.awayTeam },
        homeScore: r.actualHomeScore,
        awayScore: r.actualAwayScore,
        gameTime: r.gameTime,
        status: 'final',
        week: r.week,
      })),
      teams: Array.from(teamsMap.values())
        .map(t => ({
          id: t.id,
          name: t.name,
          abbreviation: t.abbreviation,
          eloRating: Math.round(t.eloRating),
          ppg: t.ppg,
          ppgAllowed: t.ppgAllowed,
        }))
        .sort((a, b) => b.eloRating - a.eloRating),
      backtest: {
        summary: {
          totalGames: backtestResults.length,
          spread: { wins: spreadWins, losses: spreadLosses, pushes: spreadPushes, winPct: spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0 },
          moneyline: { wins: mlWins, losses: mlLosses, winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0 },
          overUnder: { wins: ouWins, losses: ouLosses, pushes: ouPushes, winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0 },
        },
        results: backtestResults.reverse(),
      },
    };

    // 7. Upload
    const jsonString = JSON.stringify(blobData);
    log(`Uploading to blob... (${Math.round(jsonString.length / 1024)}KB)`);

    const blob = await put('prediction-matrix-data.json', jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    log(`Done! ${blob.url}`);

    return NextResponse.json({
      success: true,
      blobUrl: blob.url,
      stats: {
        teams: teamsMap.size,
        upcomingGames: gamesWithPredictions.length,
        backtestGames: backtestResults.length,
        spreadRecord: `${spreadWins}-${spreadLosses} (${spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0}%)`,
      },
      logs,
    });
  } catch (error) {
    console.error('Blob sync error:', error);
    return NextResponse.json({
      error: 'Blob sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
