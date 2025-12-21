import { NextResponse } from 'next/server';
import { getOddsForGame, saveOddsBatch, getUpcomingGames, getAllTeams } from '@/services/database';
import { fetchNFLOdds, getConsensusOdds } from '@/services/odds';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const gameId = searchParams.get('gameId');

  if (!gameId) {
    return NextResponse.json({ error: 'gameId required' }, { status: 400 });
  }

  try {
    const odds = await getOddsForGame(gameId);
    const consensus = getConsensusOdds(odds);

    return NextResponse.json({
      odds,
      consensus,
      count: odds.length
    });
  } catch (error) {
    console.error('Error fetching odds:', error);
    return NextResponse.json({ error: 'Failed to fetch odds' }, { status: 500 });
  }
}

export async function POST() {
  try {
    // Fetch latest odds from API
    const oddsMap = await fetchNFLOdds();

    // Get upcoming games to match odds with game IDs
    const games = await getUpcomingGames('nfl');
    const teams = await getAllTeams('nfl');
    const teamsMap = new Map(teams.map(t => [t.id, t]));

    const oddsToSave: Array<{ gameId: string; bookmaker: string; [key: string]: unknown }> = [];

    for (const game of games) {
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);

      if (!homeTeam || !awayTeam) continue;

      // Find matching odds (odds API uses team names)
      for (const [key, oddsArray] of oddsMap) {
        if (key.includes(homeTeam.name) || key.includes(awayTeam.name)) {
          for (const odds of oddsArray) {
            oddsToSave.push({
              ...odds,
              gameId: game.id,
              bookmaker: odds.bookmaker || 'unknown',
            });
          }
          break;
        }
      }
    }

    if (oddsToSave.length > 0) {
      await saveOddsBatch(oddsToSave);
    }

    return NextResponse.json({
      message: `Synced odds for ${oddsToSave.length} game/bookmaker combinations`,
      gamesWithOdds: new Set(oddsToSave.map(o => o.gameId)).size
    });
  } catch (error) {
    console.error('Error syncing odds:', error);
    return NextResponse.json({ error: 'Failed to sync odds' }, { status: 500 });
  }
}
