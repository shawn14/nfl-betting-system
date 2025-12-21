import { Team, Game } from '@/types';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';

interface ESPNTeam {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
}

interface ESPNCompetitor {
  id: string;
  homeAway: 'home' | 'away';
  score?: string;
  team: ESPNTeam;
}

interface ESPNEvent {
  id: string;
  date: string;
  status: {
    type: {
      state: 'pre' | 'in' | 'post';
    };
  };
  competitions: Array<{
    id: string;
    venue?: { fullName: string };
    competitors: ESPNCompetitor[];
  }>;
  week?: { number: number };
  season?: { year: number };
}

interface ESPNResponse {
  events: ESPNEvent[];
  sports?: Array<{
    leagues: Array<{
      teams: Array<{ team: ESPNTeam & { logos?: Array<{ href: string }> } }>;
    }>;
  }>;
}

// Calculate Elo from win percentage and point differential
function calculateInitialElo(wins: number, losses: number, pointDiff: number): number {
  const games = wins + losses;
  if (games === 0) return 1500;

  const winPct = wins / games;
  // Base Elo from win percentage: 1500 + (winPct - 0.5) * 400
  // So a .750 team = 1600, .500 = 1500, .250 = 1400
  let elo = 1500 + (winPct - 0.5) * 400;

  // Adjust for point differential (roughly 1 point diff = 2 Elo points)
  const pointDiffPerGame = pointDiff / games;
  elo += pointDiffPerGame * 2;

  return Math.round(elo);
}

interface StandingsEntry {
  team: { id: string };
  stats: Array<{ name: string; value?: number }>;
}

interface TeamStats {
  wins: number;
  losses: number;
  diff: number;
  pointsFor: number;
  pointsAgainst: number;
  gamesPlayed: number;
}

export async function fetchNFLTeams(): Promise<Partial<Team>[]> {
  // Fetch teams
  const response = await fetch(`${ESPN_BASE_URL}/football/nfl/teams`);
  const data: ESPNResponse = await response.json();

  // Fetch standings to get records and scoring stats
  const standingsRes = await fetch(ESPN_STANDINGS_URL);
  const standingsData = await standingsRes.json();

  // Build map of team records and stats
  const teamRecords = new Map<string, TeamStats>();
  for (const conf of standingsData.children || []) {
    for (const entry of (conf.standings?.entries || []) as StandingsEntry[]) {
      const teamId = entry.team.id;
      const stats: Record<string, number> = {};
      for (const s of entry.stats) {
        if (s.value !== undefined) {
          stats[s.name] = s.value;
        }
      }
      const wins = stats.wins || 0;
      const losses = stats.losses || 0;
      const gamesPlayed = wins + losses;
      teamRecords.set(teamId, {
        wins,
        losses,
        diff: stats.differential || 0,
        pointsFor: stats.pointsFor || 0,
        pointsAgainst: stats.pointsAgainst || 0,
        gamesPlayed,
      });
    }
  }

  const teams: Partial<Team>[] = [];

  if (data.sports?.[0]?.leagues?.[0]?.teams) {
    for (const { team } of data.sports[0].leagues[0].teams) {
      const record = teamRecords.get(team.id);
      const eloRating = record
        ? calculateInitialElo(record.wins, record.losses, record.diff)
        : 1500;

      // Calculate PPG stats
      const gamesPlayed = record?.gamesPlayed || 0;
      const ppg = gamesPlayed > 0 ? Math.round((record!.pointsFor / gamesPlayed) * 10) / 10 : 22;
      const ppgAllowed = gamesPlayed > 0 ? Math.round((record!.pointsAgainst / gamesPlayed) * 10) / 10 : 22;

      teams.push({
        id: team.id,
        sport: 'nfl',
        name: team.displayName,
        abbreviation: team.abbreviation,
        eloRating,
        pointsFor: record?.pointsFor || 0,
        pointsAgainst: record?.pointsAgainst || 0,
        gamesPlayed: gamesPlayed,
        ppg,
        ppgAllowed,
      });
    }
  }

  return teams;
}

export async function fetchNFLSchedule(week?: number): Promise<Partial<Game>[]> {
  const url = week
    ? `${ESPN_BASE_URL}/football/nfl/scoreboard?week=${week}`
    : `${ESPN_BASE_URL}/football/nfl/scoreboard`;

  const response = await fetch(url);
  const data: ESPNResponse = await response.json();

  const games: Partial<Game>[] = [];

  for (const event of data.events || []) {
    const competition = event.competitions[0];
    if (!competition) continue;

    const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
    const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

    if (!homeTeam || !awayTeam) continue;

    let status: Game['status'] = 'scheduled';
    if (event.status.type.state === 'in') status = 'in_progress';
    if (event.status.type.state === 'post') status = 'final';

    games.push({
      id: event.id,
      sport: 'nfl',
      homeTeamId: homeTeam.team.id,
      awayTeamId: awayTeam.team.id,
      gameTime: new Date(event.date),
      status,
      homeScore: homeTeam.score ? parseInt(homeTeam.score) : undefined,
      awayScore: awayTeam.score ? parseInt(awayTeam.score) : undefined,
      venue: competition.venue?.fullName,
      week: event.week?.number,
      season: event.season?.year || new Date().getFullYear(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return games;
}

export async function fetchGameDetails(gameId: string): Promise<Partial<Game> | null> {
  const response = await fetch(`${ESPN_BASE_URL}/football/nfl/summary?event=${gameId}`);
  const data = await response.json();

  if (!data.header) return null;

  const competition = data.header.competitions?.[0];
  if (!competition) return null;

  const homeTeam = competition.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'home');
  const awayTeam = competition.competitors?.find((c: ESPNCompetitor) => c.homeAway === 'away');

  if (!homeTeam || !awayTeam) return null;

  return {
    id: gameId,
    homeTeamId: homeTeam.id,
    awayTeamId: awayTeam.id,
    homeScore: homeTeam.score ? parseInt(homeTeam.score) : undefined,
    awayScore: awayTeam.score ? parseInt(awayTeam.score) : undefined,
  };
}

// Fetch all completed games for current season (for Elo calculation)
export async function fetchAllCompletedGames(): Promise<Partial<Game>[]> {
  const allGames: Partial<Game>[] = [];

  // Fetch weeks 1-18 for regular season (ESPN API uses current season by default)
  for (let week = 1; week <= 18; week++) {
    try {
      const url = `${ESPN_BASE_URL}/football/nfl/scoreboard?week=${week}`;
      const response = await fetch(url);
      const data: ESPNResponse = await response.json();

      for (const event of data.events || []) {
        // Only include completed games
        if (event.status.type.state !== 'post') continue;

        const competition = event.competitions[0];
        if (!competition) continue;

        const homeTeam = competition.competitors.find(c => c.homeAway === 'home');
        const awayTeam = competition.competitors.find(c => c.homeAway === 'away');

        if (!homeTeam || !awayTeam) continue;

        allGames.push({
          id: event.id,
          sport: 'nfl',
          homeTeamId: homeTeam.team.id,
          awayTeamId: awayTeam.team.id,
          gameTime: new Date(event.date),
          status: 'final',
          homeScore: homeTeam.score ? parseInt(homeTeam.score) : undefined,
          awayScore: awayTeam.score ? parseInt(awayTeam.score) : undefined,
          venue: competition.venue?.fullName,
          week: event.week?.number || week,
          season: event.season?.year || new Date().getFullYear(),
          eloProcessed: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
    } catch (error) {
      console.error(`Error fetching week ${week}:`, error);
    }
  }

  // Sort chronologically by game time
  return allGames.sort((a, b) =>
    new Date(a.gameTime!).getTime() - new Date(b.gameTime!).getTime()
  );
}
