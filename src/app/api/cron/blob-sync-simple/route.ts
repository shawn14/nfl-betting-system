import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { fetchNFLTeams, fetchNFLSchedule, fetchAllCompletedGames } from '@/services/espn';
import { updateEloAfterGame } from '@/services/elo';
import { fetchWeatherForVenue, getWeatherImpact } from '@/services/weather';
import { fetchInjuries, getGameInjuryImpact, InjuryReport } from '@/services/injuries';
import { Team, WeatherData } from '@/types';
import {
  getSportState,
  setSportState,
  getDocsList,
  getDocsMap,
  saveDocsBatch,
} from '@/services/firestore-admin-store';
import { SportKey } from '@/services/firestore-types';

// Constants - Optimized via simulation (927 parameter combinations tested)
// Previous: ELO_TO_POINTS=0.0593, HOME_FIELD_ADVANTAGE=2.28, SPREAD_REGRESSION=0.55, ELO_CAP=4
// Result: ATS 53.3%, O/U 52.7%
// Optimized: ATS 55.1%, O/U 55.1%
const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.11;        // Was 0.0593 - weight Elo differences more heavily
const HOME_FIELD_ADVANTAGE = 4.5; // Increased from 3.25 to fix away team bias (was picking away 80%)
const ELO_HOME_ADVANTAGE = 48;
const SPREAD_REGRESSION = 0.45;    // Was 0.55 - less regression toward 0
const ELO_CAP = 16;                // Max ±8 pts per team to prevent unrealistic scores


// Fetch odds from ESPN's FREE odds API (no API key needed!)
async function fetchESPNOdds(eventId: string): Promise<{ homeSpread: number; total: number; homeML?: number; awayML?: number } | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/${eventId}/competitions/${eventId}/odds`;
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();

    // Get the first provider's odds (typically ESPN BET)
    const odds = data.items?.[0];
    if (!odds) return null;

    const homeSpread = odds.spread;
    const total = odds.overUnder;

    if (homeSpread === undefined || total === undefined) return null;

    return {
      homeSpread,
      total,
      homeML: odds.homeTeamOdds?.moneyLine,
      awayML: odds.awayTeamOdds?.moneyLine,
    };
  } catch (error) {
    // Silently fail - odds just won't be available for this game
    return null;
  }
}

interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
}

interface HistoricalOdds {
  openingSpread?: number;
  openingTotal?: number;
  closingSpread?: number;
  closingTotal?: number;
  lastSeenSpread?: number;
  lastSeenTotal?: number;
  lastUpdatedAt?: string;
  vegasSpread: number;
  vegasTotal: number;
  capturedAt: string;
  lockedAt?: string; // Timestamp when odds were locked (1 hour before game)
}

interface CachedWeather {
  data: WeatherData;
  fetchedAt: string;
  gameId: string;
}

interface GameInjuryInfo {
  homeInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  awayInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  impactLevel: 'none' | 'minor' | 'significant' | 'major';
}

interface CachedInjuries {
  data: InjuryReport;
  fetchedAt: string;
  week: number;
}

interface BlobState {
  generated: string;
  teams: TeamData[];
  processedGameIds: string[];
  historicalOdds: Record<string, HistoricalOdds>; // gameId -> odds (persists across resets)
  weatherCache: Record<string, CachedWeather>; // gameId -> weather (refresh every 6 hours)
  injuriesByWeek: Record<string, CachedInjuries>; // week -> injuries (permanent once week is done)
  currentWeekInjuriesCache?: CachedInjuries; // current week only (refresh every 6 hours)
  games: unknown[];
  recentGames: unknown[];
  backtest: {
    summary: {
      totalGames: number;
      spread: { wins: number; losses: number; pushes: number; winPct: number };
      moneyline: { wins: number; losses: number; winPct: number };
      overUnder: { wins: number; losses: number; pushes: number; winPct: number };
    };
    highConvictionSummary: {
      spread: { wins: number; losses: number; pushes: number; winPct: number };
      moneyline: { wins: number; losses: number; winPct: number };
      overUnder: { wins: number; losses: number; pushes: number; winPct: number };
    };
    results: unknown[];
  };
}

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;

  // Store intermediate values for transparency
  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  const baseHomeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  const baseAwayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  const homeScore = baseHomeScore + eloAdj + HOME_FIELD_ADVANTAGE / 2;
  const awayScore = baseAwayScore - eloAdj + HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
    // Calculation breakdown for game detail page
    calc: {
      homePPG,
      homePPGAllowed,
      awayPPG,
      awayPPGAllowed,
      regHomePPG: Math.round(regHomePPG * 10) / 10,
      regHomePPGAllowed: Math.round(regHomePPGAllowed * 10) / 10,
      regAwayPPG: Math.round(regAwayPPG * 10) / 10,
      regAwayPPGAllowed: Math.round(regAwayPPGAllowed * 10) / 10,
      baseHomeScore: Math.round(baseHomeScore * 10) / 10,
      baseAwayScore: Math.round(baseAwayScore * 10) / 10,
      homeElo,
      awayElo,
      eloDiff,
      eloAdj: Math.round(eloAdj * 100) / 100,
      homeFieldAdv: HOME_FIELD_ADVANTAGE,
    },
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forceReset = searchParams.get('reset') === 'true';

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    const sport: SportKey = 'nfl';
    const rawState = await getSportState(sport);

    // Fetch current week schedule early to detect season/week changes
    log('Fetching current week schedule...');
    const currentWeekSchedule = await fetchNFLSchedule();
    const currentWeek = currentWeekSchedule[0]?.week || rawState?.currentWeek || 1;
    const currentSeason = currentWeekSchedule[0]?.season || rawState?.season || new Date().getFullYear();

    const hasUpcomingGames = currentWeekSchedule.some(g => g.status !== 'final');
    const now = new Date();
    const easternParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(now);
    const weekday = easternParts.find(p => p.type === 'weekday')?.value || '';
    const hour = parseInt(easternParts.find(p => p.type === 'hour')?.value || '0', 10);
    const shouldShowNextWeek = weekday === 'Mon' && hour >= 15;

    let combinedSchedule = currentWeekSchedule;
    if (shouldShowNextWeek || !hasUpcomingGames) {
      const nextWeek = currentWeek + 1;
      const nextWeekSchedule = await fetchNFLSchedule(nextWeek);
      if (nextWeekSchedule.length > 0) {
        log(`Including next week schedule (Week ${nextWeek})`);
        const combinedMap = new Map<string, typeof nextWeekSchedule[0]>();
        for (const game of currentWeekSchedule) {
          if (game.id) combinedMap.set(game.id, game);
        }
        for (const game of nextWeekSchedule) {
          if (game.id) combinedMap.set(game.id, game);
        }
        combinedSchedule = Array.from(combinedMap.values());
      }
    }

    const seasonChanged = rawState?.season && rawState.season !== currentSeason;
    const shouldReset = forceReset || seasonChanged;

    if (seasonChanged) {
      log(`Season changed (${rawState?.season} -> ${currentSeason}) - resetting state`);
    }

    log(shouldReset ? 'RESET requested - reprocessing all games with new parameters' : 'Loading Firestore state...');
    const existingState = shouldReset ? null : rawState;

    // Load cached data from Firestore
    const historicalOdds: Record<string, HistoricalOdds> = await getDocsMap<HistoricalOdds>(sport, 'oddsLocks');
    log(`Loaded ${Object.keys(historicalOdds).length} historical odds records`);

    const weatherCache: Record<string, CachedWeather> = shouldReset
      ? {}
      : await getDocsMap<CachedWeather>(sport, 'weather');
    const WEATHER_CACHE_HOURS = 6;

    const injuriesByWeek: Record<string, CachedInjuries> = shouldReset
      ? {}
      : await getDocsMap<CachedInjuries>(sport, 'injuries');

    const isFirstRun = !existingState || !existingState.processedGameIds?.length;
    const processedCount = existingState?.processedGameIds?.length || 0;
    log(isFirstRun ? 'First run - will process all games' : `Found ${processedCount} processed games`);

    // 2. Build team map from existing state or fresh from ESPN
    const teamsMap = new Map<string, TeamData>();

    const existingTeams = shouldReset ? [] : await getDocsList<TeamData>(sport, 'teams');
    if (existingTeams.length && !shouldReset) {
      for (const team of existingTeams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos from Firestore`);
    } else {
      // First run or reset - fetch fresh from ESPN
      log('Fetching NFL teams from ESPN...');
      const espnTeams = await fetchNFLTeams();
      for (const team of espnTeams) {
        if (!team.id) continue;
        teamsMap.set(team.id, {
          id: team.id,
          name: team.name || '',
          abbreviation: team.abbreviation || '',
          eloRating: 1500, // Start fresh
          ppg: team.ppg,
          ppgAllowed: team.ppgAllowed,
        });
      }
      log(`Fetched ${teamsMap.size} teams (starting Elo: 1500)`);
    }

    // Also update PPG stats from ESPN (these change weekly)
    const espnTeams = await fetchNFLTeams();
    for (const team of espnTeams) {
      if (!team.id) continue;
      const existing = teamsMap.get(team.id);
      if (existing) {
        existing.ppg = team.ppg;
        existing.ppgAllowed = team.ppgAllowed;
      }
    }

    // 3. Get processed game IDs set
    const processedGameIds = new Set<string>(existingState?.processedGameIds || []);

    // 4. Fetch completed games
    let completedGames;
    if (isFirstRun) {
      log('Fetching all completed games (first run)...');
      completedGames = await fetchAllCompletedGames();
    } else {
      log('Fetching current week games...');
      completedGames = currentWeekSchedule.filter(g => g.status === 'final');
    }

    // Filter to only unprocessed games
    const newGames = completedGames.filter(g => g.id && !processedGameIds.has(g.id));
    log(`Found ${newGames.length} new completed games to process`);

    // Sort chronologically
    newGames.sort((a, b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    // 5. Process new games - update Elos and track results
    let spreadWins = existingState?.backtestSummary?.spread?.wins || 0;
    let spreadLosses = existingState?.backtestSummary?.spread?.losses || 0;
    let spreadPushes = existingState?.backtestSummary?.spread?.pushes || 0;
    let mlWins = existingState?.backtestSummary?.moneyline?.wins || 0;
    let mlLosses = existingState?.backtestSummary?.moneyline?.losses || 0;
    let ouWins = existingState?.backtestSummary?.overUnder?.wins || 0;
    let ouLosses = existingState?.backtestSummary?.overUnder?.losses || 0;
    let ouPushes = existingState?.backtestSummary?.overUnder?.pushes || 0;

    const newBacktestResults: unknown[] = [];

    for (const game of newGames) {
      if (game.homeScore === undefined || game.awayScore === undefined) continue;
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;

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

      // Update totals
      if (spreadResult === 'win') spreadWins++;
      else if (spreadResult === 'loss') spreadLosses++;
      else spreadPushes++;
      if (mlResult === 'win') mlWins++;
      else mlLosses++;
      if (ouResult === 'win') ouWins++;
      else if (ouResult === 'loss') ouLosses++;
      else ouPushes++;

      // Get Vegas odds from historical storage
      const storedOdds = historicalOdds[game.id];
      const vegasSpread = storedOdds?.vegasSpread;
      const vegasTotal = storedOdds?.vegasTotal;

      // Calculate ATS result vs Vegas
      let atsResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasSpread !== undefined) {
        const pickHome = predictedSpread < vegasSpread;
        if (pickHome) {
          atsResult = actualSpread < vegasSpread ? 'win' : actualSpread > vegasSpread ? 'loss' : 'push';
        } else {
          atsResult = actualSpread > vegasSpread ? 'win' : actualSpread < vegasSpread ? 'loss' : 'push';
        }
      }

      // Calculate O/U result vs Vegas
      let ouVegasResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasTotal !== undefined && vegasTotal > 0) {
        const pickOver = predictedTotal > vegasTotal;
        if (pickOver) {
          ouVegasResult = actualTotal > vegasTotal ? 'win' : actualTotal < vegasTotal ? 'loss' : 'push';
        } else {
          ouVegasResult = actualTotal < vegasTotal ? 'win' : actualTotal > vegasTotal ? 'loss' : 'push';
        }
      }

      newBacktestResults.push({
        gameId: game.id,
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
        vegasSpread,
        vegasTotal,
        atsResult,
        ouVegasResult,
      });

      // Update Elo for next game
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeElo } as Team,
        { id: game.awayTeamId, eloRating: awayElo } as Team,
        actualHomeScore, actualAwayScore
      );
      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;

      // Mark as processed
      processedGameIds.add(game.id);
    }

    log(`Processed ${newGames.length} new games. Spread: ${spreadWins}-${spreadLosses}`);

    // HEALTH CHECK: Warn if completed games are missing odds
    const allCompletedGameIds = [...processedGameIds];
    const gamesMissingOdds = allCompletedGameIds.filter(id => !historicalOdds[id]?.vegasSpread);
    if (gamesMissingOdds.length > 0) {
      const pct = Math.round((1 - gamesMissingOdds.length / allCompletedGameIds.length) * 100);
      log(`⚠️ WARNING: ${gamesMissingOdds.length}/${allCompletedGameIds.length} completed games missing Vegas odds (${pct}% coverage)`);
    } else {
      log(`✅ All ${allCompletedGameIds.length} completed games have Vegas odds`);
    }

    // 6. Merge backtest results (new + existing)
    const coerceGameTime = (value: any) => {
      if (!value) return value;
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return new Date(value).toISOString();
      if (typeof value === 'object' && typeof value._seconds === 'number') {
        return new Date(value._seconds * 1000).toISOString();
      }
      return value;
    };

    const existingResults = shouldReset
      ? []
      : (await getDocsList<any>(sport, 'results')).map(r => ({
        ...r,
        gameId: r.gameId || r.id,
        gameTime: coerceGameTime(r.gameTime),
      }));

    // Division lookup for situation flags
    const DIVISIONS: Record<string, string[]> = {
      'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
      'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
      'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
      'AFC West': ['DEN', 'KC', 'LV', 'LAC'],
      'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'],
      'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
      'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
      'NFC West': ['ARI', 'LAR', 'SEA', 'SF'],
    };
    const getDivision = (abbr: string) => Object.entries(DIVISIONS).find(([, teams]) => teams.includes(abbr))?.[0];

    // Enrich existing results with historical odds and situation flags
    const enrichedExistingResults = existingResults.map((r: any) => {
      const storedOdds = historicalOdds[r.gameId];
      const vegasSpread = storedOdds?.vegasSpread ?? r.vegasSpread;
      const vegasTotal = storedOdds?.vegasTotal ?? r.vegasTotal;

      // Calculate ATS result vs Vegas (if not already set)
      let atsResult = r.atsResult;
      if (!atsResult && vegasSpread !== undefined && r.actualSpread !== undefined) {
        const pickHome = r.predictedSpread < vegasSpread;
        if (pickHome) {
          atsResult = r.actualSpread < vegasSpread ? 'win' : r.actualSpread > vegasSpread ? 'loss' : 'push';
        } else {
          atsResult = r.actualSpread > vegasSpread ? 'win' : r.actualSpread < vegasSpread ? 'loss' : 'push';
        }
      }

      // Calculate O/U result vs Vegas (if not already set)
      let ouVegasResult = r.ouVegasResult;
      if (!ouVegasResult && vegasTotal !== undefined && vegasTotal > 0 && r.actualTotal !== undefined) {
        const pickOver = r.predictedTotal > vegasTotal;
        if (pickOver) {
          ouVegasResult = r.actualTotal > vegasTotal ? 'win' : r.actualTotal < vegasTotal ? 'loss' : 'push';
        } else {
          ouVegasResult = r.actualTotal < vegasTotal ? 'win' : r.actualTotal > vegasTotal ? 'loss' : 'push';
        }
      }

      // Calculate situation flags (if not already set)
      const week = r.week || 0;
      const absVegasSpread = vegasSpread !== undefined ? Math.abs(vegasSpread) : 0;
      const eloDiff = Math.abs((r.homeElo || 1500) - (r.awayElo || 1500));

      // Always recalculate situation flags to ensure accuracy
      const isDivisional = getDivision(r.homeTeam) === getDivision(r.awayTeam);
      const isLateSeasonGame = week >= 13;
      const isLargeSpread = absVegasSpread >= 7;
      const isSmallSpread = absVegasSpread > 0 && absVegasSpread <= 3;
      const isMediumSpread = absVegasSpread > 3 && absVegasSpread < 7;
      const isEloMismatch = eloDiff > 100;

      return {
        ...r,
        vegasSpread,
        vegasTotal,
        atsResult,
        ouVegasResult,
        isDivisional,
        isLateSeasonGame,
        isLargeSpread,
        isSmallSpread,
        isMediumSpread,
        isEloMismatch,
      };
    });

    // Deduplicate by gameId (new results take priority over existing)
    const seenGameIds = new Set<string>();
    const allBacktestResults = [
      ...newBacktestResults,
      ...enrichedExistingResults,
    ].filter(r => {
      if (seenGameIds.has(r.gameId)) return false;
      seenGameIds.add(r.gameId);
      return true;
    });

    // 7. Fetch all current week games (already loaded)
    const allWeekGames = combinedSchedule;
    // Include all games (final, in-progress, and scheduled) for the current + next week window
    const upcoming = allWeekGames;
    log(`Found ${upcoming.length} games for current/next week window`);

    // Track how many odds we fetch from ESPN FREE API
    let oddsFetched = 0;

    // Injury caching strategy:
    // - Past weeks: stored permanently in injuriesByWeek (never refetch)
    // - Current week: refresh every 6 hours
    const INJURY_CACHE_HOURS = 6;
    let currentWeekInjuriesCache: CachedInjuries | undefined = injuriesByWeek[String(currentWeek)];
    let injuryReport: InjuryReport | null = null;

    // Check if current week cache is still valid
    const cacheIsCurrentWeek = currentWeekInjuriesCache?.week === currentWeek;
    const injuryCacheAge = currentWeekInjuriesCache
      ? (new Date().getTime() - new Date(currentWeekInjuriesCache.fetchedAt).getTime()) / (1000 * 60 * 60)
      : Infinity;

    // Allow forcing injury refresh via query param
    const forceInjuryRefresh = searchParams.get('forceInjuries') === 'true';

    if (!forceInjuryRefresh && cacheIsCurrentWeek && currentWeekInjuriesCache && injuryCacheAge < INJURY_CACHE_HOURS) {
      injuryReport = currentWeekInjuriesCache.data;
      log(`Using cached Week ${currentWeek} injuries (${Math.round(injuryCacheAge * 10) / 10}h old)`);
    } else {
      log(`Fetching fresh Week ${currentWeek} injuries...`);
      try {
        injuryReport = await fetchInjuries();
        if (injuryReport) {
          const teamsWithInjuries = Object.keys(injuryReport.teams).length;
          const totalInjuries = Object.values(injuryReport.teams).reduce((sum, t) => sum + t.injuries.length, 0);
          log(`Fetched injuries: ${totalInjuries} players across ${teamsWithInjuries} teams`);
          // Update current week cache
          currentWeekInjuriesCache = {
            data: injuryReport,
            fetchedAt: new Date().toISOString(),
            week: currentWeek,
          };
          injuriesByWeek[String(currentWeek)] = currentWeekInjuriesCache;
        }
      } catch (err) {
        log(`Failed to fetch injuries: ${err instanceof Error ? err.message : 'Unknown error'}`);
        // Fall back to cached data if available
        if (currentWeekInjuriesCache) {
          injuryReport = currentWeekInjuriesCache.data;
          log('Using stale cached injuries as fallback');
        }
      }
    }

    log(`Stored injuries for ${Object.keys(injuriesByWeek).length} past weeks`);

    const gamesWithPredictions = [];
    for (const game of upcoming) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      // Get odds for this game
      let vegasSpread: number | undefined;
      let vegasTotal: number | undefined;
      const gameTime = new Date(game.gameTime || '');
      const now = new Date();
      const hoursUntilGame = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Check if odds are already locked (stored and within 1 hour of game time)
      let existingOdds = historicalOdds[game.id];
      const shouldLockNow = existingOdds && hoursUntilGame <= 1 && !existingOdds.lockedAt;
      const oddsAreLocked = existingOdds?.lockedAt !== undefined;

      if (shouldLockNow) {
        // Lock the odds now - set lockedAt timestamp
        existingOdds.lockedAt = new Date().toISOString();
        existingOdds.closingSpread = existingOdds.lastSeenSpread ?? existingOdds.vegasSpread;
        existingOdds.closingTotal = existingOdds.lastSeenTotal ?? existingOdds.vegasTotal;
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
        log(`Locked odds for ${awayTeam.abbreviation}@${homeTeam.abbreviation}: spread ${vegasSpread}, total ${vegasTotal}`);
      } else if (oddsAreLocked) {
        // Use already locked odds - don't update
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
      } else if (game.status !== 'final') {
        // Fetch latest odds from ESPN's FREE API (only for non-final games)
        const espnOdds = await fetchESPNOdds(game.id);
        if (espnOdds) {
          vegasSpread = espnOdds.homeSpread;
          vegasTotal = espnOdds.total;
          oddsFetched++;
          const nowIso = new Date().toISOString();
          // Store in historical odds (will be locked once within 1 hour of game)
          const existing = historicalOdds[game.id];
          if (existing) {
            if (existing.openingSpread === undefined) {
              existing.openingSpread = vegasSpread;
              existing.openingTotal = vegasTotal;
            }
            existing.vegasSpread = vegasSpread;
            existing.vegasTotal = vegasTotal;
            existing.lastSeenSpread = vegasSpread;
            existing.lastSeenTotal = vegasTotal;
            existing.lastUpdatedAt = nowIso;
          } else {
            historicalOdds[game.id] = {
              vegasSpread,
              vegasTotal,
              openingSpread: vegasSpread,
              openingTotal: vegasTotal,
              lastSeenSpread: vegasSpread,
              lastSeenTotal: vegasTotal,
              lastUpdatedAt: nowIso,
              capturedAt: nowIso,
            };
          }
          existingOdds = historicalOdds[game.id];
        }
      }

      // Fetch weather (use cache if less than 6 hours old)
      let weather: WeatherData | null = null;
      const cachedWeather = weatherCache[game.id];
      const cacheAge = cachedWeather ? (now.getTime() - new Date(cachedWeather.fetchedAt).getTime()) / (1000 * 60 * 60) : Infinity;

      if (cachedWeather && cacheAge < WEATHER_CACHE_HOURS) {
        weather = cachedWeather.data;
      } else if (game.venue && game.gameTime) {
        try {
          weather = await fetchWeatherForVenue(game.venue, new Date(game.gameTime));
          if (weather) {
            weatherCache[game.id] = {
              data: weather,
              fetchedAt: now.toISOString(),
              gameId: game.id,
            };
          }
        } catch (err) {
          // Weather fetch failed, continue without
        }
      }

      const weatherImpact = getWeatherImpact(weather);

      const { homeScore: predHomeRaw, awayScore: predAwayRaw, calc } = predictScore(
        homeTeam.eloRating, awayTeam.eloRating,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      // Apply weather impact to both team scores (split evenly)
      // This keeps scores summing to total and spread mostly unchanged
      const weatherDelta = weatherImpact * 3;  // Optimal multiplier from backtesting
      const perTeamDelta = weatherDelta / 2;

      // Get injury data for this game
      const gameInjuries = injuryReport && game.week === currentWeek
        ? getGameInjuryImpact(injuryReport, homeTeam.abbreviation, awayTeam.abbreviation)
        : null;

      // QB OUT adjustment: -3 points per team (industry standard value)
      // We don't have historical injury data to backtest, but this is well-established
      const QB_OUT_ADJUSTMENT = 3;
      const homeQBAdj = gameInjuries?.homeInjuries.hasQBOut ? QB_OUT_ADJUSTMENT : 0;
      const awayQBAdj = gameInjuries?.awayInjuries.hasQBOut ? QB_OUT_ADJUSTMENT : 0;

      const predHome = predHomeRaw - perTeamDelta - homeQBAdj;
      const predAway = predAwayRaw - perTeamDelta - awayQBAdj;

      const adjustedHomeElo = homeTeam.eloRating + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayTeam.eloRating - adjustedHomeElo) / 400));

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;

      // 60%+ Situation Detection (based on backtesting 169 games)
      const absVegasSpread = vegasSpread !== undefined ? Math.abs(vegasSpread) : 3;
      const eloDiff = Math.abs(homeTeam.eloRating - awayTeam.eloRating);
      const week = game.week || 1;

      // Check divisions for divisional game detection
      const DIVISIONS: Record<string, string[]> = {
        'AFC East': ['BUF', 'MIA', 'NE', 'NYJ'],
        'AFC North': ['BAL', 'CIN', 'CLE', 'PIT'],
        'AFC South': ['HOU', 'IND', 'JAX', 'TEN'],
        'AFC West': ['DEN', 'KC', 'LAC', 'LV'],
        'NFC East': ['DAL', 'NYG', 'PHI', 'WAS'],
        'NFC North': ['CHI', 'DET', 'GB', 'MIN'],
        'NFC South': ['ATL', 'CAR', 'NO', 'TB'],
        'NFC West': ['ARI', 'LAR', 'SEA', 'SF'],
      };
      const getDiv = (abbr: string) => Object.entries(DIVISIONS).find(([, teams]) => teams.includes(abbr))?.[0];
      const isDivisional = getDiv(homeTeam.abbreviation) === getDiv(awayTeam.abbreviation);

      // 60%+ situations from backtesting:
      // - Late Season (Wks 13+): 62.9%
      // - Large Spreads (≥7): 61.7%
      // - Divisional Games: 61.5%
      // - Elo Mismatch (>100): 61.4%
      // - Small Spreads (≤3): 60.0%
      // AVOID: Medium Spreads (3.5-6.5): 46.7%

      const isLateSeasonGame = week >= 13;
      const isLargeSpread = absVegasSpread >= 7;
      const isSmallSpread = absVegasSpread <= 3;
      const isMediumSpread = absVegasSpread > 3 && absVegasSpread < 7;
      const isEloMismatch = eloDiff > 100;

      // Count 60%+ factors
      const sixtyPlusFactors = [
        isLateSeasonGame,
        isLargeSpread,
        isDivisional,
        isEloMismatch,
        isSmallSpread,
      ].filter(Boolean).length;

      const lineOpeningSpread = existingOdds?.openingSpread;
      const lineCurrentSpread = existingOdds?.closingSpread ?? existingOdds?.lastSeenSpread ?? vegasSpread;

      // Confidence based on 60%+ situations
      let atsConfidence: 'high' | 'medium' | 'low';
      if (isMediumSpread) {
        atsConfidence = 'low'; // 46.7% - avoid!
      } else if (sixtyPlusFactors >= 2) {
        atsConfidence = 'high'; // Multiple 60%+ factors
      } else if (sixtyPlusFactors === 1) {
        atsConfidence = 'high'; // Single 60%+ factor still good
      } else {
        atsConfidence = 'medium';
      }

      // Line movement adjustment (>= 2 points)
      if (lineOpeningSpread !== undefined && lineCurrentSpread !== undefined) {
        const lineMove = Math.round((lineCurrentSpread - lineOpeningSpread) * 2) / 2;
        if (lineMove !== 0) {
          const moveTowardHome = lineMove < 0;
          const pickHome = predictedSpread < (vegasSpread ?? predictedSpread);
          const aligned = (moveTowardHome && pickHome) || (!moveTowardHome && !pickHome);
          if (Math.abs(lineMove) >= 2) {
            if (aligned) {
              atsConfidence = atsConfidence === 'low' ? 'medium' : 'high';
            } else {
              atsConfidence = atsConfidence === 'high' ? 'medium' : 'low';
            }
          }
        }
      }

      // O/U confidence - edge >= 5 points = 59.7% hit rate
      const totalEdge = vegasTotal !== undefined ? Math.abs(predictedTotal - vegasTotal) : 0;
      let ouConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (totalEdge >= 5) ouConfidence = 'high';
      else if (totalEdge >= 3) ouConfidence = 'medium';
      else ouConfidence = 'low';

      // ML confidence - based on win probability edge from 50%
      // Edge >= 10% = 70.3%, Edge >= 15% = 77.9%, Edge >= 20% = 81.1%
      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;
      let mlConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (mlEdge >= 15) mlConfidence = 'high';
      else if (mlEdge >= 7) mlConfidence = 'medium';
      else mlConfidence = 'low';

      // Best bet flags
      const isAtsBestBet = sixtyPlusFactors >= 1 && !isMediumSpread;
      const isOuBestBet = totalEdge >= 5;
      const isMlBestBet = mlEdge >= 15;

      let lineMovement = existingOdds ? {
          openingSpread: existingOdds.openingSpread,
          openingTotal: existingOdds.openingTotal,
          closingSpread: existingOdds.closingSpread,
          closingTotal: existingOdds.closingTotal,
          lastSeenSpread: existingOdds.lastSeenSpread,
          lastSeenTotal: existingOdds.lastSeenTotal,
          lastUpdatedAt: existingOdds.lastUpdatedAt,
        } : undefined;

        if (lineMovement) {
          for (const key of Object.keys(lineMovement)) {
            if (lineMovement[key as keyof typeof lineMovement] === undefined) {
              delete lineMovement[key as keyof typeof lineMovement];
            }
          }
          if (Object.keys(lineMovement).length === 0) {
            lineMovement = undefined;
          }
        }

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
          predictedSpread,
          predictedTotal,
          homeWinProbability: homeWinProb,
          confidence: 0.5,
          vegasSpread,
          vegasTotal,
          oddsLockedAt: existingOdds?.lockedAt,
          lineMovement,
          spreadEdge: vegasSpread !== undefined ? Math.round((predictedSpread - vegasSpread) * 2) / 2 : undefined,
          totalEdge: vegasTotal !== undefined ? Math.round((predictedTotal - vegasTotal) * 2) / 2 : undefined,
          atsConfidence,
          ouConfidence,
          mlConfidence,
          isAtsBestBet,
          isOuBestBet,
          isMlBestBet,
          mlEdge: Math.round(mlEdge * 10) / 10,
          // 60%+ situation flags
          isDivisional,
          isLateSeasonGame,
          isLargeSpread,
          isSmallSpread,
          isMediumSpread,
          isEloMismatch,
          sixtyPlusFactors,
          eloDiff: Math.round(eloDiff),
          week,
          // Weather data
          weather: weather ? {
            temperature: weather.temperature,
            windSpeed: weather.windSpeed,
            conditions: weather.conditions,
            precipitation: weather.precipitation,
            impact: weatherImpact,
            totalDelta: weatherDelta,
            perTeamDelta,
          } : null,
          weatherImpact,  // Keep for backwards compatibility
          // Injury data
          injuries: injuryReport ? getGameInjuryImpact(injuryReport, homeTeam.abbreviation, awayTeam.abbreviation) : null,
          // Calculation breakdown for game detail page
          calc: {
            ...calc,
            weatherDelta,
            perTeamDelta,
          },
        },
      });
    }

    // Log odds and weather stats
    log(`Fetched ${oddsFetched} odds from ESPN FREE API`);
    const gamesWithWeather = gamesWithPredictions.filter((g: any) => g.prediction.weather).length;
    log(`Weather data: ${gamesWithWeather}/${gamesWithPredictions.length} games`);

    // Log injury stats
    const gamesWithInjuries = gamesWithPredictions.filter((g: any) => g.prediction.injuries).length;
    const majorInjuryGames = gamesWithPredictions.filter((g: any) => g.prediction.injuries?.impactLevel === 'major').length;
    log(`Injury data: ${gamesWithInjuries}/${gamesWithPredictions.length} games (${majorInjuryGames} with QB out)`);

    // Compute high conviction stats from backtest results
    let hiAtsW = 0, hiAtsL = 0, hiAtsP = 0;
    let hiOuW = 0, hiOuL = 0, hiOuP = 0;
    let hiMlW = 0, hiMlL = 0;
    for (const r of allBacktestResults as any[]) {
      const spreadEdge = r.vegasSpread !== undefined ? Math.abs(r.predictedSpread - r.vegasSpread) : 0;
      const totalEdge = r.vegasTotal !== undefined ? Math.abs(r.predictedTotal - r.vegasTotal) : 0;
      const mlEdge = Math.abs((r.homeWinProb || 0.5) - 0.5) * 100;

      // High conviction ATS (edge >= 2 pts)
      if (spreadEdge >= 2 && r.atsResult) {
        if (r.atsResult === 'win') hiAtsW++;
        else if (r.atsResult === 'loss') hiAtsL++;
        else hiAtsP++;
      }
      // High conviction O/U (edge >= 5 pts)
      if (totalEdge >= 5 && r.ouVegasResult) {
        if (r.ouVegasResult === 'win') hiOuW++;
        else if (r.ouVegasResult === 'loss') hiOuL++;
        else hiOuP++;
      }
      // High conviction ML (edge >= 15%)
      if (mlEdge >= 15 && r.mlResult) {
        if (r.mlResult === 'win') hiMlW++;
        else hiMlL++;
      }
    }
    const hiAtsTotal = hiAtsW + hiAtsL;
    const hiOuTotal = hiOuW + hiOuL;
    const hiMlTotal = hiMlW + hiMlL;

    // 8. Build blob data
    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    log(`Storing ${Object.keys(historicalOdds).length} historical odds, ${Object.keys(weatherCache).length} weather records`);

    const blobData: BlobState = {
      generated: new Date().toISOString(),
      teams: Array.from(teamsMap.values()).sort((a, b) => b.eloRating - a.eloRating),
      processedGameIds: Array.from(processedGameIds),
      historicalOdds, // Persists Vegas odds across resets
      weatherCache, // Weather by gameId (permanent for completed games, 6h refresh for upcoming)
      injuriesByWeek, // Past weeks injuries (permanent)
      currentWeekInjuriesCache, // Current week injuries (6h refresh)
      games: gamesWithPredictions.sort((a, b) =>
        new Date(a.game.gameTime || 0).getTime() - new Date(b.game.gameTime || 0).getTime()
      ),
      recentGames: [...allBacktestResults]
        .sort((a: any, b: any) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
        .slice(0, 10)
        .map((r: any) => ({
          id: r.gameId,
          homeTeam: { abbreviation: r.homeTeam },
          awayTeam: { abbreviation: r.awayTeam },
          homeScore: r.actualHomeScore,
          awayScore: r.actualAwayScore,
          gameTime: r.gameTime,
          status: 'final',
          week: r.week,
        })),
      backtest: {
        summary: {
          totalGames: processedGameIds.size,
          spread: { wins: spreadWins, losses: spreadLosses, pushes: spreadPushes, winPct: spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0 },
          moneyline: { wins: mlWins, losses: mlLosses, winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0 },
          overUnder: { wins: ouWins, losses: ouLosses, pushes: ouPushes, winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0 },
        },
        highConvictionSummary: {
          spread: { wins: hiAtsW, losses: hiAtsL, pushes: hiAtsP, winPct: hiAtsTotal > 0 ? Math.round((hiAtsW / hiAtsTotal) * 1000) / 10 : 0 },
          moneyline: { wins: hiMlW, losses: hiMlL, winPct: hiMlTotal > 0 ? Math.round((hiMlW / hiMlTotal) * 1000) / 10 : 0 },
          overUnder: { wins: hiOuW, losses: hiOuL, pushes: hiOuP, winPct: hiOuTotal > 0 ? Math.round((hiOuW / hiOuTotal) * 1000) / 10 : 0 },
        },
        results: allBacktestResults,
      },
    };

    // 9. Persist to Firestore (source of truth)
    const syncTimestamp = new Date().toISOString();

    const teamDocs = Array.from(teamsMap.values()).map(team => ({
      id: team.id,
      data: {
        ...team,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    const gamesToStore = new Map<string, any>();
    for (const game of upcoming) {
      if (game.id) gamesToStore.set(game.id, game);
    }
    for (const game of newGames) {
      if (game.id) gamesToStore.set(game.id, game);
    }

    const gameDocs = Array.from(gamesToStore.values()).map(game => ({
      id: game.id,
      data: {
        ...game,
        sport,
        gameTime: game.gameTime ? new Date(game.gameTime).toISOString() : undefined,
        updatedAt: syncTimestamp,
      },
    }));

    const predictionDocs = gamesWithPredictions.map((entry: any) => ({
      id: entry.game.id,
      data: {
        ...entry.prediction,
        sport,
        gameId: entry.game.id,
        updatedAt: syncTimestamp,
      },
    }));

    const resultDocs = allBacktestResults.map((result: any) => ({
      id: result.gameId,
      data: {
        ...result,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    const oddsDocs = Object.entries(historicalOdds).map(([gameId, odds]) => ({
      id: gameId,
      data: {
        ...odds,
        gameId,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    const weatherDocs = Object.entries(weatherCache).map(([gameId, weather]) => ({
      id: gameId,
      data: {
        ...weather,
        gameId,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    const injuriesDocs = Object.entries(injuriesByWeek).map(([weekKey, injuries]) => ({
      id: weekKey,
      data: {
        ...injuries,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    await saveDocsBatch(sport, 'teams', teamDocs);
    await saveDocsBatch(sport, 'games', gameDocs);
    await saveDocsBatch(sport, 'predictions', predictionDocs);
    await saveDocsBatch(sport, 'results', resultDocs);
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);
    await saveDocsBatch(sport, 'weather', weatherDocs);
    await saveDocsBatch(sport, 'injuries', injuriesDocs);

    // 10. Upload
    const jsonString = JSON.stringify(blobData);
    const blobSizeKb = Math.round(jsonString.length / 1024);
    log(`Uploading to blob... (${blobSizeKb}KB)`);

    const blob = await put('prediction-matrix-data.json', jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    await setSportState(sport, {
      lastSyncAt: syncTimestamp,
      lastBlobWriteAt: new Date().toISOString(),
      lastBlobUrl: blob.url,
      lastBlobSizeKb: blobSizeKb,
      season: currentSeason,
      currentWeek,
      processedGameIds: Array.from(processedGameIds),
      backtestSummary: blobData.backtest.summary,
    });

    // Write heartbeat for cron monitoring
    await put('cron-heartbeat-nfl.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      route: 'blob-sync-simple',
      success: true,
      blobUrl: blob.url,
      blobSizeKb,
      gamesProcessed: newGames.length,
      totalGamesProcessed: processedGameIds.size,
    }), {
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
        newGamesProcessed: newGames.length,
        totalGamesProcessed: processedGameIds.size,
        upcomingGames: gamesWithPredictions.length,
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
