import { NextResponse } from 'next/server';
import {
  saveTeamsBatch,
  saveGamesBatch,
  getAllTeams,
  getUnprocessedCompletedGames,
  markGamesEloProcessedBatch,
  updateTeamElosBatch,
  getAllGames,
} from '@/services/database';
import { fetchNFLTeams, fetchNFLSchedule, fetchAllCompletedGames } from '@/services/espn';
import { fetchNFLOdds } from '@/services/odds';
import { processGamesForElo } from '@/services/elo';

export async function GET(request: Request) {
  // Verify cron secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  try {
    // 1. Sync teams (with scoring stats)
    const teams = await fetchNFLTeams();
    if (teams.length > 0) {
      await saveTeamsBatch(teams as Array<{ id: string } & typeof teams[0]>);
      results.teams = `Synced ${teams.length} teams with PPG stats`;
    }

    // 2. Sync current week games
    const games = await fetchNFLSchedule();
    if (games.length > 0) {
      await saveGamesBatch(games as Array<{ id: string } & typeof games[0]>);
      results.games = `Synced ${games.length} current games`;
    }

    // 3. Check if this is first run (fetch all historical games if needed)
    const allStoredGames = await getAllGames('nfl');
    const completedStoredGames = allStoredGames.filter(g => g.status === 'final');

    if (completedStoredGames.length < 10) {
      // First run - fetch all historical games
      const historicalGames = await fetchAllCompletedGames();
      if (historicalGames.length > 0) {
        await saveGamesBatch(historicalGames as Array<{ id: string } & typeof historicalGames[0]>);
        results.historicalGames = `Fetched ${historicalGames.length} historical games`;
      }
    }

    // 4. Get current team Elos
    const allTeams = await getAllTeams('nfl');
    const initialTeamElos = new Map<string, number>();
    for (const team of allTeams) {
      initialTeamElos.set(team.id, team.eloRating || 1500);
    }

    // 5. Process unprocessed completed games for Elo
    const unprocessedGames = await getUnprocessedCompletedGames('nfl');

    if (unprocessedGames.length > 0) {
      // Process games chronologically
      const { teamElos, processedGameIds } = processGamesForElo(
        unprocessedGames,
        initialTeamElos
      );

      // Update team Elos in database
      const eloUpdates = Array.from(teamElos.entries()).map(([id, eloRating]) => ({
        id,
        eloRating,
      }));
      await updateTeamElosBatch(eloUpdates);

      // Mark games as processed
      await markGamesEloProcessedBatch(processedGameIds);

      results.eloProcessing = `Processed ${processedGameIds.length} games, updated ${eloUpdates.length} team Elos`;
    } else {
      results.eloProcessing = 'No new games to process';
    }

    // 6. Sync odds
    try {
      const oddsMap = await fetchNFLOdds();
      results.odds = `Fetched odds for ${oddsMap.size} games`;
    } catch (oddsError) {
      results.odds = `Odds sync failed: ${oddsError instanceof Error ? oddsError.message : 'Unknown error'}`;
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });
  } catch (error) {
    console.error('Cron sync error:', error);
    return NextResponse.json({
      error: 'Sync failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
