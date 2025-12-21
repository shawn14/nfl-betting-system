import { NextResponse } from 'next/server';
import { getAllTeams, saveTeamsBatch } from '@/services/database';
import { fetchNFLTeams } from '@/services/espn';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') || 'nfl';

  try {
    const teams = await getAllTeams(sport);
    return NextResponse.json({ teams, count: teams.length });
  } catch (error) {
    console.error('Error fetching teams:', error);
    return NextResponse.json({ error: 'Failed to fetch teams' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const sport = searchParams.get('sport') || 'nfl';

  try {
    let teams;
    if (sport === 'nfl') {
      teams = await fetchNFLTeams();
    } else {
      return NextResponse.json({ error: `Sport ${sport} not supported yet` }, { status: 400 });
    }

    if (teams.length > 0) {
      await saveTeamsBatch(teams as Array<{ id: string } & typeof teams[0]>);
    }

    return NextResponse.json({
      message: `Synced ${teams.length} teams`,
      teams
    });
  } catch (error) {
    console.error('Error syncing teams:', error);
    return NextResponse.json({ error: 'Failed to sync teams' }, { status: 500 });
  }
}
