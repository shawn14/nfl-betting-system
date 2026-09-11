/**
 * NBA Rest Days Detection Service
 *
 * Teams on back-to-backs (B2B) historically perform worse ATS:
 * - 0 rest days: ~47% ATS cover rate
 * - 1+ rest days: ~53% ATS cover rate
 * - Rest advantage matters more for road teams
 */

interface TeamScheduleGame {
  id: string;
  date: string; // ISO date string
  homeAway: 'home' | 'away';
}

interface RestDaysInfo {
  homeRestDays: number;
  awayRestDays: number;
  homeIsB2B: boolean;
  awayIsB2B: boolean;
  restAdvantage: number; // Positive = home has more rest, negative = away has more rest
  restAdvantageTeam: 'home' | 'away' | 'even';
}

// Cache team schedules to avoid repeated API calls
const scheduleCache = new Map<string, { games: TeamScheduleGame[]; fetchedAt: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

export type RestDaysLeague = 'nba' | 'wnba';

/**
 * Fetch a team's schedule from ESPN API.
 * `league` selects the ESPN league path. The WNBA sync reused this module for months while it
 * hardcoded basketball/nba — WNBA team ids were looked up against NBA schedules (wrong team or
 * 400 for expansion ids like Portland 132052), so every WNBA game read as 3 rest days each side.
 */
async function fetchTeamSchedule(teamId: string, league: RestDaysLeague = 'nba'): Promise<TeamScheduleGame[]> {
  // Check cache (keyed by league so NBA/WNBA ids that collide never share an entry)
  const cacheKey = `${league}:${teamId}`;
  const cached = scheduleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
    return cached.games;
  }

  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/${league}/teams/${teamId}/schedule`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error(`Failed to fetch ${league} schedule for team ${teamId}: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const games: TeamScheduleGame[] = [];

    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const isHome = competition.competitors?.some(
        (c: any) => c.homeAway === 'home' && c.team?.id === teamId
      );

      games.push({
        id: event.id,
        date: event.date,
        homeAway: isHome ? 'home' : 'away',
      });
    }

    // Sort by date
    games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Cache the result
    scheduleCache.set(cacheKey, { games, fetchedAt: Date.now() });

    return games;
  } catch (error) {
    console.error(`Error fetching ${league} schedule for team ${teamId}:`, error);
    return [];
  }
}

/**
 * Calculate rest days for a team before a specific game
 * Returns the number of days since their last game
 */
function calculateRestDays(schedule: TeamScheduleGame[], gameDate: Date, gameId: string): number {
  const gameDateMs = gameDate.getTime();

  // Find the previous game (game that happened before this one)
  let previousGame: TeamScheduleGame | null = null;

  for (const game of schedule) {
    // Skip the current game
    if (game.id === gameId) continue;

    const gameMs = new Date(game.date).getTime();

    // Only consider games before the target game
    if (gameMs < gameDateMs) {
      if (!previousGame || gameMs > new Date(previousGame.date).getTime()) {
        previousGame = game;
      }
    }
  }

  if (!previousGame) {
    // No previous game found - assume well rested (3 days)
    return 3;
  }

  const previousGameDate = new Date(previousGame.date);
  const diffMs = gameDateMs - previousGameDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // 0 means same day (not possible in NBA), 1 means back-to-back
  return Math.max(0, diffDays - 1);
}

/**
 * Get rest days info for both teams in a matchup
 */
export async function getRestDaysForGame(
  homeTeamId: string,
  awayTeamId: string,
  gameDate: Date | string,
  gameId: string,
  league: RestDaysLeague = 'nba'
): Promise<RestDaysInfo> {
  const gameDateObj = typeof gameDate === 'string' ? new Date(gameDate) : gameDate;

  // Fetch schedules in parallel
  const [homeSchedule, awaySchedule] = await Promise.all([
    fetchTeamSchedule(homeTeamId, league),
    fetchTeamSchedule(awayTeamId, league),
  ]);

  const homeRestDays = calculateRestDays(homeSchedule, gameDateObj, gameId);
  const awayRestDays = calculateRestDays(awaySchedule, gameDateObj, gameId);

  const homeIsB2B = homeRestDays === 0;
  const awayIsB2B = awayRestDays === 0;
  const restAdvantage = homeRestDays - awayRestDays;

  let restAdvantageTeam: 'home' | 'away' | 'even' = 'even';
  if (restAdvantage > 0) restAdvantageTeam = 'home';
  else if (restAdvantage < 0) restAdvantageTeam = 'away';

  return {
    homeRestDays,
    awayRestDays,
    homeIsB2B,
    awayIsB2B,
    restAdvantage,
    restAdvantageTeam,
  };
}

/**
 * Calculate rest-adjusted spread modifier
 *
 * Research shows:
 * - B2B teams cover ~47% (3% worse than expected)
 * - Each rest day advantage is worth ~0.5-1 point
 * - Road B2Bs are especially impactful
 */
export function calculateRestAdjustment(restInfo: RestDaysInfo): number {
  let adjustment = 0;

  // B2B penalty: ~1.5 points for the fatigued team
  if (restInfo.homeIsB2B && !restInfo.awayIsB2B) {
    adjustment -= 1.5; // Home team disadvantaged
  } else if (restInfo.awayIsB2B && !restInfo.homeIsB2B) {
    adjustment += 1.5; // Away team disadvantaged, benefits home
  }

  // Additional rest advantage (~0.5 points per day, capped at 2 days)
  const restDiff = Math.min(2, Math.max(-2, restInfo.restAdvantage));
  adjustment += restDiff * 0.5;

  return Math.round(adjustment * 2) / 2; // Round to nearest 0.5
}

/**
 * Check if rest situation favors covering the spread
 * Returns true if the team we're picking has favorable rest
 */
export function restFavorsPick(
  pickHome: boolean,
  restInfo: RestDaysInfo
): boolean {
  if (pickHome) {
    // We're picking home - favorable if home has rest advantage or away is on B2B
    return restInfo.awayIsB2B || restInfo.restAdvantage > 0;
  } else {
    // We're picking away - favorable if away has rest advantage or home is on B2B
    return restInfo.homeIsB2B || restInfo.restAdvantage < 0;
  }
}

/**
 * Clear the schedule cache (useful for testing or forced refresh)
 */
export function clearScheduleCache(): void {
  scheduleCache.clear();
}
