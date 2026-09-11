import { Team, Game } from '@/types';

const ESPN_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';
const ESPN_NHL_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings';

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

/**
 * Fetch JSON from ESPN with retry. ESPN's edge intermittently answers with an HTML block page
 * (text/html, "<HTML><HEAD>...") instead of JSON; a bare response.json() then throws
 * "Unexpected token '<'" and kills the whole sync (seen on every sport Aug 30 – Sep 8 2026).
 * Retries twice with backoff and surfaces a clear error naming the status and content type.
 * Never add a spoofed browser User-Agent here: ESPN's edge 403s those; the default works.
 */
export async function fetchEspnJson<T = any>(url: string, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url);
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('json')) {
        throw new Error(`ESPN ${response.status} ${contentType.split(';')[0] || 'no content-type'}: ${url}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
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
  const data = await fetchEspnJson<ESPNResponse>(`${ESPN_BASE_URL}/football/nfl/teams`);

  // Fetch standings to get records and scoring stats
  const standingsData = await fetchEspnJson(ESPN_STANDINGS_URL);

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

  const data = await fetchEspnJson<ESPNResponse>(url);

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
  const data = await fetchEspnJson(`${ESPN_BASE_URL}/football/nfl/summary?event=${gameId}`);

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
      const data = await fetchEspnJson<ESPNResponse>(url);

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

// ============================================
// NHL Functions
// ============================================

export async function fetchNHLTeams(): Promise<Partial<Team>[]> {
  // Fetch teams
  const data = await fetchEspnJson<ESPNResponse>(`${ESPN_BASE_URL}/hockey/nhl/teams`);

  // Fetch standings to get records and scoring stats
  const standingsData = await fetchEspnJson(ESPN_NHL_STANDINGS_URL);

  // Build map of team records and stats
  const teamRecords = new Map<string, TeamStats & { otLosses: number }>();
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
      const otLosses = stats.otLosses || 0;
      const gamesPlayed = wins + losses + otLosses;
      teamRecords.set(teamId, {
        wins,
        losses,
        otLosses,
        diff: stats.differential || stats.goalDifferential || 0,
        pointsFor: stats.pointsFor || stats.goalsFor || 0,
        pointsAgainst: stats.pointsAgainst || stats.goalsAgainst || 0,
        gamesPlayed,
      });
    }
  }

  const teams: Partial<Team>[] = [];

  if (data.sports?.[0]?.leagues?.[0]?.teams) {
    for (const { team } of data.sports[0].leagues[0].teams) {
      const record = teamRecords.get(team.id);
      const eloRating = record
        ? calculateInitialElo(record.wins, record.losses + record.otLosses, record.diff)
        : 1500;

      // Calculate goals per game stats
      const gamesPlayed = record?.gamesPlayed || 0;
      const ppg = gamesPlayed > 0 ? Math.round((record!.pointsFor / gamesPlayed) * 10) / 10 : 3.0;
      const ppgAllowed = gamesPlayed > 0 ? Math.round((record!.pointsAgainst / gamesPlayed) * 10) / 10 : 3.0;

      teams.push({
        id: team.id,
        sport: 'nhl',
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

export async function fetchNHLSchedule(dateStr?: string): Promise<Partial<Game>[]> {
  // NHL uses date-based scoreboard, not week-based
  const url = dateStr
    ? `${ESPN_BASE_URL}/hockey/nhl/scoreboard?dates=${dateStr}`
    : `${ESPN_BASE_URL}/hockey/nhl/scoreboard`;

  const data = await fetchEspnJson<ESPNResponse>(url);

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
      sport: 'nhl',
      homeTeamId: homeTeam.team.id,
      awayTeamId: awayTeam.team.id,
      gameTime: new Date(event.date),
      status,
      homeScore: homeTeam.score ? parseInt(homeTeam.score) : undefined,
      awayScore: awayTeam.score ? parseInt(awayTeam.score) : undefined,
      venue: competition.venue?.fullName,
      season: event.season?.year || new Date().getFullYear(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  return games;
}

// Fetch NHL schedule for a date range (for backfill)
export async function fetchNHLScheduleRange(startDate: Date, days: number): Promise<Partial<Game>[]> {
  const allGames: Partial<Game>[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');

    try {
      const games = await fetchNHLSchedule(dateStr);
      allGames.push(...games);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error fetching NHL schedule for ${dateStr}:`, error);
    }
  }

  return allGames;
}

// Fetch all completed NHL games for current season
export async function fetchAllCompletedNHLGames(seasonYear?: number): Promise<Partial<Game>[]> {
  // Default to current season if not specified
  const year = seasonYear || (new Date().getMonth() < 9 ? new Date().getFullYear() : new Date().getFullYear() + 1);
  // NHL season 2026 = Oct 2025 - Jun 2026, so season start year is (year - 1)
  const seasonStartYear = year - 1;

  // Season starts in October of previous year
  const startDate = new Date(seasonStartYear, 9, 1); // October 1
  const endDate = new Date();

  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

  console.log(`Fetching NHL games from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (${daysDiff} days)`);

  const allGames = await fetchNHLScheduleRange(startDate, Math.min(daysDiff, 300));

  // Filter to only completed games and sort chronologically
  return allGames
    .filter(g => g.status === 'final')
    .sort((a, b) => new Date(a.gameTime!).getTime() - new Date(b.gameTime!).getTime());
}

// ==================== COLLEGE BASKETBALL ====================

const ESPN_CBB_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const ESPN_CBB_STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/mens-college-basketball/standings';
const COLLEGE_LEAGUE_AVG_PPG = 72; // NCAA average ~72 PPG

export async function fetchCollegeBasketballTeams(): Promise<any[]> {
  try {
    const data = await fetchEspnJson(`${ESPN_CBB_URL}/teams?limit=400`);

    // Also fetch standings for PPG stats
    const standingsData = await fetchEspnJson(ESPN_CBB_STANDINGS_URL);

    // Build map of team stats from standings
    const teamStats = new Map<string, { ppg: number; ppgAllowed: number; conference?: string }>();
    for (const conf of standingsData.children || []) {
      const conferenceName = conf.name || conf.abbreviation;
      for (const entry of conf.standings?.entries || []) {
        const teamId = entry.team?.id;
        if (!teamId) continue;
        const stats: Record<string, number> = {};
        for (const s of entry.stats || []) {
          if (s.value !== undefined) {
            stats[s.name] = s.value;
          }
        }
        const gamesPlayed = (stats.wins || 0) + (stats.losses || 0);
        if (gamesPlayed > 0) {
          teamStats.set(teamId, {
            ppg: stats.avgPointsFor || stats.pointsFor / gamesPlayed || COLLEGE_LEAGUE_AVG_PPG,
            ppgAllowed: stats.avgPointsAgainst || stats.pointsAgainst / gamesPlayed || COLLEGE_LEAGUE_AVG_PPG,
            conference: conferenceName,
          });
        }
      }
    }

    const teams: any[] = [];
    for (const teamWrapper of data.sports?.[0]?.leagues?.[0]?.teams || []) {
      const team = teamWrapper.team;
      if (!team) continue;

      const stats = teamStats.get(team.id);

      teams.push({
        id: team.id,
        name: team.displayName || team.name,
        abbreviation: team.abbreviation || team.shortDisplayName,
        ppg: stats?.ppg || COLLEGE_LEAGUE_AVG_PPG,
        ppgAllowed: stats?.ppgAllowed || COLLEGE_LEAGUE_AVG_PPG,
        conference: stats?.conference,
      });
    }

    return teams;
  } catch (error) {
    console.error('Failed to fetch college basketball teams:', error);
    return [];
  }
}

export async function fetchESPNCollegeBasketballOdds(eventId: string): Promise<{ homeSpread?: number; total?: number } | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events/${eventId}/competitions/${eventId}/odds`;
    const data = await fetchEspnJson(url, 1);
    const oddsItem = data.items?.[0];
    if (!oddsItem) return null;

    return {
      homeSpread: oddsItem.spread,
      total: oddsItem.overUnder,
    };
  } catch (error) {
    return null;
  }
}
