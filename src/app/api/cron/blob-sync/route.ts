import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import {
  saveTeamsBatch,
  saveGamesBatch,
  getAllTeams,
  getUnprocessedCompletedGames,
  markGamesEloProcessedBatch,
  updateTeamElosBatch,
  getAllGames,
  getUpcomingGames,
  getOddsForGame,
  savePrediction,
} from '@/services/database';
import { fetchNFLTeams, fetchNFLSchedule, fetchAllCompletedGames } from '@/services/espn';
import { fetchNFLOdds, getConsensusOdds } from '@/services/odds';
import { processGamesForElo, predictGameWithStats, updateEloAfterGame, calculateEdge, getEdgeStrength, getBetRecommendation } from '@/services/elo';
import { fetchWeatherForVenue } from '@/services/weather';
import { Game, Team } from '@/types';

// Constants from our calibrated model
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
  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  let homeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  let awayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  homeScore += eloAdj;
  awayScore -= eloAdj;
  homeScore += HOME_FIELD_ADVANTAGE / 2;
  awayScore -= HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('Starting blob sync...');

    // 1. Sync teams
    log('Fetching NFL teams...');
    const teams = await fetchNFLTeams();
    if (teams.length > 0) {
      await saveTeamsBatch(teams as Array<{ id: string } & typeof teams[0]>);
      log(`Synced ${teams.length} teams`);
    }

    // 2. Sync current week games
    log('Fetching NFL schedule...');
    const games = await fetchNFLSchedule();
    if (games.length > 0) {
      await saveGamesBatch(games as Array<{ id: string } & typeof games[0]>);
      log(`Synced ${games.length} current games`);
    }

    // 3. Check if this is first run
    const allStoredGames = await getAllGames('nfl');
    const completedStoredGames = allStoredGames.filter(g => g.status === 'final');

    if (completedStoredGames.length < 10) {
      log('First run - fetching historical games...');
      const historicalGames = await fetchAllCompletedGames();
      if (historicalGames.length > 0) {
        await saveGamesBatch(historicalGames as Array<{ id: string } & typeof historicalGames[0]>);
        log(`Fetched ${historicalGames.length} historical games`);
      }
    }

    // 4. Process Elo
    const allTeams = await getAllTeams('nfl');
    const initialTeamElos = new Map<string, number>();
    for (const team of allTeams) {
      initialTeamElos.set(team.id, team.eloRating || 1500);
    }

    const unprocessedGames = await getUnprocessedCompletedGames('nfl');
    if (unprocessedGames.length > 0) {
      const { teamElos, processedGameIds } = processGamesForElo(unprocessedGames, initialTeamElos);
      const eloUpdates = Array.from(teamElos.entries()).map(([id, eloRating]) => ({ id, eloRating }));
      await updateTeamElosBatch(eloUpdates);
      await markGamesEloProcessedBatch(processedGameIds);
      log(`Processed ${processedGameIds.length} games for Elo`);
    }

    // 5. Sync odds
    try {
      await fetchNFLOdds();
      log('Synced odds');
    } catch (e) {
      log(`Odds sync failed: ${e instanceof Error ? e.message : 'Unknown'}`);
    }

    // 6. Get fresh data for blob
    log('Generating predictions...');
    const freshTeams = await getAllTeams('nfl');
    const teamsMap = new Map(freshTeams.map(t => [t.id, t]));
    const upcomingGames = await getUpcomingGames('nfl');

    // Generate predictions for upcoming games
    const gamesWithPredictions = [];
    for (const game of upcomingGames) {
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      let weather = null;
      if (game.venue) {
        try {
          weather = await fetchWeatherForVenue(game.venue, game.gameTime);
        } catch {
          // Ignore weather errors
        }
      }

      const prediction = predictGameWithStats(homeTeam, awayTeam, weather);
      const odds = await getOddsForGame(game.id);
      const consensus = getConsensusOdds(odds);

      let edgeData = {};
      if (consensus?.homeSpread !== undefined && consensus?.total !== undefined) {
        const edge = calculateEdge(prediction, consensus.homeSpread, consensus.total);
        const recommendation = getBetRecommendation(
          edge.edgeSpread,
          edge.edgeTotal,
          prediction.homeWinProbability || 0.5
        );
        edgeData = {
          edgeSpread: edge.edgeSpread,
          edgeTotal: edge.edgeTotal,
          edgeSpreadStrength: getEdgeStrength(edge.edgeSpread),
          edgeTotalStrength: getEdgeStrength(edge.edgeTotal),
          recommendedBet: recommendation,
          vegasSpread: consensus.homeSpread,
          vegasTotal: consensus.total,
        };
      }

      const fullPrediction = { ...prediction, ...edgeData, gameId: game.id };
      await savePrediction(fullPrediction);

      gamesWithPredictions.push({
        game: {
          ...game,
          homeTeam: { id: homeTeam.id, name: homeTeam.name, abbreviation: homeTeam.abbreviation },
          awayTeam: { id: awayTeam.id, name: awayTeam.name, abbreviation: awayTeam.abbreviation },
        },
        prediction: fullPrediction,
      });
    }
    log(`Generated ${gamesWithPredictions.length} predictions`);

    // 7. Run backtest for recent games
    log('Running backtest...');
    const allGames = await getAllGames('nfl');
    const completedGames = allGames
      .filter((g): g is Game => g.status === 'final' && g.homeScore !== undefined && g.awayScore !== undefined)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    const teamStats = new Map<string, { ppg: number; ppgAllowed: number }>();
    for (const team of freshTeams) {
      teamStats.set(team.id, { ppg: team.ppg || LEAGUE_AVG_PPG, ppgAllowed: team.ppgAllowed || LEAGUE_AVG_PPG });
    }

    const teamElos = new Map<string, number>();
    for (const team of freshTeams) {
      teamElos.set(team.id, 1500);
    }

    const backtestResults = [];
    let spreadWins = 0, spreadLosses = 0, spreadPushes = 0;
    let mlWins = 0, mlLosses = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;

    for (const game of completedGames) {
      const homeElo = teamElos.get(game.homeTeamId) || 1500;
      const awayElo = teamElos.get(game.awayTeamId) || 1500;
      const homeTeamData = freshTeams.find(t => t.id === game.homeTeamId);
      const awayTeamData = freshTeams.find(t => t.id === game.awayTeamId);
      const homeStats = teamStats.get(game.homeTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };
      const awayStats = teamStats.get(game.awayTeamId) || { ppg: LEAGUE_AVG_PPG, ppgAllowed: LEAGUE_AVG_PPG };

      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo, homeStats.ppg, homeStats.ppgAllowed, awayStats.ppg, awayStats.ppgAllowed
      );

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;
      const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

      const actualHomeScore = game.homeScore!;
      const actualAwayScore = game.awayScore!;
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
        gameId: game.id,
        gameTime: game.gameTime.toString(),
        week: game.week,
        homeTeam: homeTeamData?.abbreviation || game.homeTeamId,
        awayTeam: awayTeamData?.abbreviation || game.awayTeamId,
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

      // Update Elos
      const homeTeamObj = { id: game.homeTeamId, eloRating: homeElo } as Team;
      const awayTeamObj = { id: game.awayTeamId, eloRating: awayElo } as Team;
      const { homeNewElo, awayNewElo } = updateEloAfterGame(homeTeamObj, awayTeamObj, actualHomeScore, actualAwayScore);
      teamElos.set(game.homeTeamId, homeNewElo);
      teamElos.set(game.awayTeamId, awayNewElo);
    }

    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    log(`Backtest: ${backtestResults.length} games processed`);

    // 8. Build blob payload
    const blobData = {
      generated: new Date().toISOString(),
      games: gamesWithPredictions.sort((a, b) =>
        new Date(a.game.gameTime).getTime() - new Date(b.game.gameTime).getTime()
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
      teams: freshTeams
        .map(t => ({
          id: t.id,
          name: t.name,
          abbreviation: t.abbreviation,
          eloRating: t.eloRating,
          ppg: t.ppg,
          ppgAllowed: t.ppgAllowed,
        }))
        .sort((a, b) => (b.eloRating || 1500) - (a.eloRating || 1500)),
      backtest: {
        summary: {
          totalGames: backtestResults.length,
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
        results: backtestResults.reverse(),
      },
    };

    // 9. Upload to blob
    log('Uploading to blob storage...');
    const blob = await put('prediction-matrix-data.json', JSON.stringify(blobData), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
    });

    log(`Blob uploaded: ${blob.url}`);

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      blobUrl: blob.url,
      stats: {
        teams: freshTeams.length,
        upcomingGames: gamesWithPredictions.length,
        backtestGames: backtestResults.length,
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
export const maxDuration = 300; // 5 minutes
