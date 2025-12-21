import { NextResponse } from 'next/server';
import { getUpcomingGames, getGamesByWeek, saveGamesBatch, getAllTeams } from '@/services/database';
import { fetchNFLSchedule } from '@/services/espn';
import { Game } from '@/types';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') || 'nfl';
  const week = searchParams.get('week');
  const season = searchParams.get('season');

  try {
    let games: Game[];

    if (week && season) {
      games = await getGamesByWeek(sport, parseInt(week), parseInt(season));
    } else {
      games = await getUpcomingGames(sport);
    }

    // Attach team info
    const teams = await getAllTeams(sport);
    const teamsMap = new Map(teams.map(t => [t.id, t]));

    const gamesWithTeams = games.map(game => ({
      ...game,
      homeTeam: teamsMap.get(game.homeTeamId),
      awayTeam: teamsMap.get(game.awayTeamId),
    }));

    return NextResponse.json({ games: gamesWithTeams, count: games.length });
  } catch (error) {
    console.error('Error fetching games:', error);
    return NextResponse.json({ error: 'Failed to fetch games' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') || 'nfl';
  const week = searchParams.get('week');

  try {
    let games;
    if (sport === 'nfl') {
      games = await fetchNFLSchedule(week ? parseInt(week) : undefined);
    } else {
      return NextResponse.json({ error: `Sport ${sport} not supported yet` }, { status: 400 });
    }

    if (games.length > 0) {
      await saveGamesBatch(games as Array<{ id: string } & typeof games[0]>);
    }

    return NextResponse.json({
      message: `Synced ${games.length} games`,
      games
    });
  } catch (error) {
    console.error('Error syncing games:', error);
    return NextResponse.json({ error: 'Failed to sync games' }, { status: 500 });
  }
}
