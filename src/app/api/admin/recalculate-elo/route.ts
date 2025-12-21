import { NextResponse } from 'next/server';
import {
  getAllTeams,
  getAllGames,
  resetAllTeamElos,
  resetAllGamesEloProcessed,
  updateTeamElosBatch,
  markGamesEloProcessedBatch,
  saveGamesBatch,
} from '@/services/database';
import { fetchAllCompletedGames } from '@/services/espn';
import { processGamesForElo } from '@/services/elo';
import { Game } from '@/types';

export async function POST(request: Request) {
  // Verify admin secret for security
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results: Record<string, unknown> = {};

  try {
    // 1. Reset all team Elos to 1500
    await resetAllTeamElos('nfl', 1500);
    results.resetTeams = 'Reset all team Elos to 1500';

    // 2. Reset all games to eloProcessed = false
    await resetAllGamesEloProcessed('nfl');
    results.resetGames = 'Reset all games eloProcessed to false';

    // 3. Fetch all historical games from ESPN
    const historicalGames = await fetchAllCompletedGames();
    if (historicalGames.length > 0) {
      await saveGamesBatch(historicalGames as Array<{ id: string } & typeof historicalGames[0]>);
      results.fetchedGames = `Fetched and saved ${historicalGames.length} historical games`;
    }

    // 4. Get all completed games sorted chronologically
    const allGames = await getAllGames('nfl');
    const completedGames = allGames
      .filter((g): g is Game => g.status === 'final' && g.homeScore !== undefined && g.awayScore !== undefined)
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    results.completedGamesCount = completedGames.length;

    // 5. Process all games for Elo from scratch
    const initialTeamElos = new Map<string, number>();
    const allTeams = await getAllTeams('nfl');
    for (const team of allTeams) {
      initialTeamElos.set(team.id, 1500); // Start fresh at 1500
    }

    const { teamElos, processedGameIds } = processGamesForElo(
      completedGames,
      initialTeamElos
    );

    // 6. Update all team Elos in database
    const eloUpdates = Array.from(teamElos.entries()).map(([id, eloRating]) => ({
      id,
      eloRating,
    }));
    await updateTeamElosBatch(eloUpdates);

    // 7. Mark all processed games
    await markGamesEloProcessedBatch(processedGameIds);

    results.processedGames = processedGameIds.length;
    results.updatedTeams = eloUpdates.length;

    // 8. Report final Elo rankings
    const finalRankings = Array.from(teamElos.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([id, elo]) => {
        const team = allTeams.find(t => t.id === id);
        return {
          team: team?.abbreviation || id,
          elo,
        };
      });

    results.topTeams = finalRankings;

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results
    });
  } catch (error) {
    console.error('Recalculate Elo error:', error);
    return NextResponse.json({
      error: 'Recalculation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 120; // May take longer than normal
