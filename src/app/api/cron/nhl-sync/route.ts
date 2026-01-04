import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { updateEloAfterGame } from '@/services/elo';
import { Team } from '@/types';
import {
  getSportState,
  setSportState,
  getDocsList,
  getDocsMap,
  saveDocsBatch,
} from '@/services/firestore-admin-store';
import { SportKey } from '@/services/firestore-types';
import { fetchNHLTeams, fetchNHLSchedule, fetchNHLScheduleRange, fetchAllCompletedNHLGames } from '@/services/espn';

// NHL Constants - Initial estimates, will optimize via backtesting
const LEAGUE_AVG_GPG = 3.1;             // NHL average ~3.1 goals per team per game
const ELO_TO_POINTS = 0.018;            // 100 Elo = 1.8 goals
const HOME_ICE_ADVANTAGE = 0.25;        // NHL home ice ~0.25 goals
const ELO_HOME_ADVANTAGE = 48;          // Same Elo bonus structure
const SPREAD_REGRESSION = 0.15;         // 15% regression to mean (was 40% - too aggressive)
const ELO_CAP = 3;                      // Max ±1.5 goals per team

function getSeasonStartDate(seasonYear: number): Date {
  return new Date(Date.UTC(seasonYear - 1, 9, 1)); // October 1 of previous year
}

function getSeasonEndDate(seasonYear: number): Date {
  return new Date(Date.UTC(seasonYear, 5, 30)); // June 30
}

const NHL_DIVISIONS: Record<string, string[]> = {
  Atlantic: ['BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TB', 'TOR'],
  Metropolitan: ['CAR', 'CBJ', 'NJ', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH'],
  Central: ['ARI', 'CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'WPG'],
  Pacific: ['ANA', 'CGY', 'EDM', 'LA', 'SEA', 'SJ', 'VAN', 'VGK'],
};

function getDivision(abbr: string): string | undefined {
  return Object.entries(NHL_DIVISIONS).find(([, teams]) => teams.includes(abbr))?.[0];
}

function isLateSeasonGame(gameTime: string | undefined, seasonYear: number): boolean {
  if (!gameTime) return false;
  const gameDate = new Date(gameTime);
  const cutoff = new Date(Date.UTC(seasonYear, 2, 1)); // March 1
  return gameDate >= cutoff;
}

interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;       // Goals per game
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
  lockedAt?: string;
}

interface BlobState {
  generated: string;
  teams: TeamData[];
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

// Fetch odds from ESPN's FREE odds API (no API key needed!) - with retry logic
async function fetchESPNOdds(eventId: string, retries = 2): Promise<{ homeSpread: number; total: number; homeML?: number; awayML?: number } | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const url = `https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl/events/${eventId}/competitions/${eventId}/odds`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' },
        signal: AbortSignal.timeout(5000), // 5 second timeout
      });

      if (!response.ok) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, 200 * (attempt + 1))); // Exponential backoff
          continue;
        }
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
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        continue;
      }
      // Silently fail after all retries
      return null;
    }
  }
  return null;
}

function predictScore(
  homeElo: number,
  awayElo: number,
  homeGPG: number,
  homeGPGAllowed: number,
  awayGPG: number,
  awayGPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_GPG * 0.3;

  const regHomeGPG = regress(homeGPG);
  const regHomeGPGAllowed = regress(homeGPGAllowed);
  const regAwayGPG = regress(awayGPG);
  const regAwayGPGAllowed = regress(awayGPGAllowed);

  const baseHomeScore = (regHomeGPG + regAwayGPGAllowed) / 2;
  const baseAwayScore = (regAwayGPG + regHomeGPGAllowed) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  const homeScore = baseHomeScore + eloAdj + HOME_ICE_ADVANTAGE / 2;
  const awayScore = baseAwayScore - eloAdj - HOME_ICE_ADVANTAGE / 2;  // Fixed: subtract from away (was adding)

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
    calc: {
      homeGPG,
      homeGPGAllowed,
      awayGPG,
      awayGPGAllowed,
      regHomeGPG: Math.round(regHomeGPG * 10) / 10,
      regHomeGPGAllowed: Math.round(regHomeGPGAllowed * 10) / 10,
      regAwayGPG: Math.round(regAwayGPG * 10) / 10,
      regAwayGPGAllowed: Math.round(regAwayGPGAllowed * 10) / 10,
      baseHomeScore: Math.round(baseHomeScore * 10) / 10,
      baseAwayScore: Math.round(baseAwayScore * 10) / 10,
      homeElo,
      awayElo,
      eloDiff,
      eloAdj: Math.round(eloAdj * 100) / 100,
      homeIceAdv: HOME_ICE_ADVANTAGE,
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
  const seasonParam = searchParams.get('season');
  const backfillDaysParam = searchParams.get('backfillDays');
  const parsedSeason = seasonParam ? Number.parseInt(seasonParam, 10) : Number.NaN;
  const parsedBackfillDays = backfillDaysParam ? Number.parseInt(backfillDaysParam, 10) : Number.NaN;
  const backfillDays = Number.isFinite(parsedBackfillDays) ? Math.max(0, parsedBackfillDays) : 1;

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('Starting NHL sync...');

    const sport: SportKey = 'nhl';
    const rawState = await getSportState(sport);

    // Fetch current schedule to detect season
    const fullSchedule = await fetchNHLSchedule();
    const scheduleSeasons = fullSchedule.map(g => g.season).filter(Boolean) as number[];
    const inferredSeason = scheduleSeasons.length > 0
      ? Math.max(...scheduleSeasons)
      : rawState?.season || new Date().getFullYear();
    const targetSeason = Number.isFinite(parsedSeason) ? parsedSeason : inferredSeason;
    log(`Target season: ${targetSeason}`);

    const UPCOMING_DAYS = 8; // Extra day to handle UTC/US timezone difference
    const today = new Date();
    // Start from yesterday to capture today's games when cron runs after midnight UTC
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const rangeSchedule = await fetchNHLScheduleRange(yesterday, UPCOMING_DAYS);
    const currentSchedule = rangeSchedule.length > 0
      ? rangeSchedule.filter(g => g.season === targetSeason)
      : fullSchedule.filter(game => game.season === targetSeason);
    const currentSeason = targetSeason;

    const seasonChanged = rawState?.season && rawState.season !== currentSeason;
    const shouldReset = forceReset || seasonChanged;

    if (seasonChanged) {
      log(`Season changed (${rawState?.season} -> ${currentSeason}) - resetting state`);
    }

    log(shouldReset ? 'RESET requested - reprocessing all games' : 'Loading Firestore state...');
    const existingState = shouldReset ? null : rawState;

    const historicalOdds: Record<string, HistoricalOdds> = await getDocsMap<HistoricalOdds>(sport, 'oddsLocks');
    log(`Loaded ${Object.keys(historicalOdds).length} historical odds records`);

    const isFirstRun = !existingState || !existingState.processedGameIds?.length;
    const processedCount = existingState?.processedGameIds?.length || 0;
    log(isFirstRun ? 'First run - will initialize teams' : `Found ${processedCount} processed games`);

    // Build team map
    const teamsMap = new Map<string, TeamData>();

    const existingTeams = shouldReset ? [] : await getDocsList<TeamData>(sport, 'teams');
    let espnTeams: Partial<Team>[] | null = null;
    if (existingTeams.length && !shouldReset) {
      for (const team of existingTeams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos from Firestore`);
    } else {
      log('Fetching NHL teams from ESPN...');
      espnTeams = await fetchNHLTeams();
      for (const team of espnTeams) {
        if (!team.id) continue;
        teamsMap.set(team.id, {
          id: team.id,
          name: team.name || '',
          abbreviation: team.abbreviation || '',
          eloRating: 1500,
          ppg: team.ppg,
          ppgAllowed: team.ppgAllowed,
        });
      }
      log(`Fetched ${teamsMap.size} teams (starting Elo: 1500)`);
    }

    // Refresh stats each run
    const latestTeams = espnTeams ?? await fetchNHLTeams();
    for (const team of latestTeams) {
      if (!team.id) continue;
      const existing = teamsMap.get(team.id);
      if (existing) {
        existing.name = team.name || existing.name;
        existing.abbreviation = team.abbreviation || existing.abbreviation;
        existing.ppg = team.ppg || existing.ppg;
        existing.ppgAllowed = team.ppgAllowed || existing.ppgAllowed;
      }
    }

    // Get processed game IDs
    const processedGameIds = new Set<string>(existingState?.processedGameIds || []);

    // Fetch games
    let allGames: Partial<Team & { homeScore?: number; awayScore?: number; homeTeamId?: string; awayTeamId?: string; gameTime?: Date; status?: string; venue?: string; season?: number }>[];
    let completedGames: any[];

    if (isFirstRun) {
      log('First run - fetching ALL completed NHL games from season start...');
      completedGames = await fetchAllCompletedNHLGames(targetSeason);
      const scheduledGames = currentSchedule.filter(g => g.status !== 'final');
      allGames = [...completedGames, ...scheduledGames];
      log(`Found ${completedGames.length} completed games + ${scheduledGames.length} upcoming`);
    } else {
      log('Fetching NHL schedule...');
      allGames = currentSchedule;
      const backfillStart = new Date();
      backfillStart.setDate(backfillStart.getDate() - backfillDays);
      const backfillSchedule = await fetchNHLScheduleRange(backfillStart, backfillDays + 1);
      const backfillCompleted = backfillSchedule.filter(g => g.status === 'final');
      const completedMap = new Map<string, any>();
      for (const game of backfillCompleted) {
        if (game.id) completedMap.set(game.id, game);
      }
      for (const game of allGames.filter(g => g.status === 'final')) {
        if (game.id) completedMap.set(game.id, game);
      }
      completedGames = Array.from(completedMap.values());
      log(`Found ${allGames.length} games (${completedGames.length} completed, backfillDays=${backfillDays})`);
    }

    // Filter to only unprocessed games
    const newGames = completedGames.filter((g: any) => g.id && !processedGameIds.has(g.id));
    log(`Found ${newGames.length} new completed games to process`);

    // Sort chronologically
    newGames.sort((a: any, b: any) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    // Process new games - update Elos and backtest
    let spreadWins = existingState?.backtestSummary?.spread?.wins || 0;
    let spreadLosses = existingState?.backtestSummary?.spread?.losses || 0;
    let spreadPushes = existingState?.backtestSummary?.spread?.pushes || 0;
    let mlWins = existingState?.backtestSummary?.moneyline?.wins || 0;
    let mlLosses = existingState?.backtestSummary?.moneyline?.losses || 0;
    let ouWins = existingState?.backtestSummary?.overUnder?.wins || 0;
    let ouLosses = existingState?.backtestSummary?.overUnder?.losses || 0;
    let ouPushes = existingState?.backtestSummary?.overUnder?.pushes || 0;

    // High conviction tracking (use type assertion since Firestore state may have extended data)
    const hcState = (existingState?.backtestSummary as any)?.highConviction;
    let hcSpreadWins = hcState?.spread?.wins || 0;
    let hcSpreadLosses = hcState?.spread?.losses || 0;
    let hcSpreadPushes = hcState?.spread?.pushes || 0;
    let hcMlWins = hcState?.moneyline?.wins || 0;
    let hcMlLosses = hcState?.moneyline?.losses || 0;
    let hcOuWins = hcState?.overUnder?.wins || 0;
    let hcOuLosses = hcState?.overUnder?.losses || 0;
    let hcOuPushes = hcState?.overUnder?.pushes || 0;

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
        homeTeam.ppg || LEAGUE_AVG_GPG, homeTeam.ppgAllowed || LEAGUE_AVG_GPG,
        awayTeam.ppg || LEAGUE_AVG_GPG, awayTeam.ppgAllowed || LEAGUE_AVG_GPG
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

      // Get Vegas odds from historical storage
      const storedOdds = historicalOdds[game.id];
      const vegasSpread = storedOdds?.vegasSpread;
      const vegasTotal = storedOdds?.vegasTotal;

      // Calculate ATS result vs Vegas (if we have odds)
      let atsResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasSpread !== undefined) {
        const pickHome = predictedSpread < vegasSpread;
        if (pickHome) {
          atsResult = actualSpread < vegasSpread ? 'win' : actualSpread > vegasSpread ? 'loss' : 'push';
        } else {
          atsResult = actualSpread > vegasSpread ? 'win' : actualSpread < vegasSpread ? 'loss' : 'push';
        }

        // Update backtest counters
        if (atsResult === 'win') spreadWins++;
        else if (atsResult === 'loss') spreadLosses++;
        else spreadPushes++;
      }

      // ML result
      const mlPick = homeWinProb > 0.5 ? 'home' : 'away';
      const mlResult = (mlPick === 'home' && homeWon) || (mlPick === 'away' && !homeWon) ? 'win' : 'loss';
      if (vegasSpread !== undefined) {
        if (mlResult === 'win') mlWins++;
        else mlLosses++;
      }

      // O/U result vs Vegas
      let ouVegasResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasTotal !== undefined && vegasTotal > 0) {
        const pickOver = predictedTotal > vegasTotal;
        if (pickOver) {
          ouVegasResult = actualTotal > vegasTotal ? 'win' : actualTotal < vegasTotal ? 'loss' : 'push';
        } else {
          ouVegasResult = actualTotal < vegasTotal ? 'win' : actualTotal > vegasTotal ? 'loss' : 'push';
        }
        if (ouVegasResult === 'win') ouWins++;
        else if (ouVegasResult === 'loss') ouLosses++;
        else ouPushes++;
      }

      // High conviction: Spread Edge >= 1.5 (optimized from backtest - 73.2% vs 56.1% with Elo gap)
      const eloGap = Math.abs(homeElo - awayElo);
      const spreadEdge = vegasSpread !== undefined ? Math.abs(predictedSpread - vegasSpread) : 0;
      const isHighConviction = spreadEdge >= 1.5 && vegasSpread !== undefined;
      if (isHighConviction && atsResult) {
        if (atsResult === 'win') hcSpreadWins++;
        else if (atsResult === 'loss') hcSpreadLosses++;
        else hcSpreadPushes++;
        if (mlResult === 'win') hcMlWins++;
        else hcMlLosses++;
        if (ouVegasResult === 'win') hcOuWins++;
        else if (ouVegasResult === 'loss') hcOuLosses++;
        else if (ouVegasResult === 'push') hcOuPushes++;
      }

      const absVegasSpread = vegasSpread !== undefined ? Math.abs(vegasSpread) : 0;
      const isDivisional = getDivision(homeTeam.abbreviation) === getDivision(awayTeam.abbreviation);
      const isLateSeason = isLateSeasonGame(game.gameTime, targetSeason);

      newBacktestResults.push({
        gameId: game.id,
        gameTime: game.gameTime,
        homeTeam: homeTeam.abbreviation,
        awayTeam: awayTeam.abbreviation,
        homeElo,
        awayElo,
        predictedHomeScore: predHome,
        predictedAwayScore: predAway,
        predictedSpread,
        predictedTotal,
        vegasSpread,
        vegasTotal,
        actualHomeScore,
        actualAwayScore,
        actualSpread,
        actualTotal,
        homeWinProb: Math.round(homeWinProb * 1000) / 10,
        atsResult,
        mlResult: vegasSpread !== undefined ? mlResult : undefined,
        ouResult: ouVegasResult,
        isHighConviction,
        eloGap,
        spreadEdge,
        isDivisional,
        isLateSeason,
        absVegasSpread,
      });

      // Update Elo
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeElo } as Team,
        { id: game.awayTeamId, eloRating: awayElo } as Team,
        actualHomeScore, actualAwayScore
      );
      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;

      processedGameIds.add(game.id);
    }

    log(`Processed ${newGames.length} new games, updated Elos`);

    // HEALTH CHECK: Warn if completed games are missing odds
    const allCompletedGameIds = [...processedGameIds];
    const initialMissingOdds = allCompletedGameIds.filter(id => !historicalOdds[id]?.vegasSpread);
    if (initialMissingOdds.length > 0) {
      log(`⚠️ ${initialMissingOdds.length}/${allCompletedGameIds.length} completed games missing odds - will attempt backfill`);
    }

    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // HARDENED: Fetch odds for ALL games - both upcoming AND completed games missing odds
    const upcomingGames = (allGames as any[]).filter(g => g.status !== 'final');
    const completedGamesMissingOdds = completedGames.filter((g: any) =>
      g.id && !historicalOdds[g.id]?.vegasSpread
    );

    log(`Fetching odds for ${upcomingGames.length} upcoming + ${completedGamesMissingOdds.length} completed games missing odds...`);

    // Fetch odds for completed games that are missing them (ESPN retains historical odds)
    let backfilledCount = 0;
    for (const game of completedGamesMissingOdds) {
      if (!game.id) continue;

      const espnOdds = await fetchESPNOdds(game.id);
      if (espnOdds) {
        historicalOdds[game.id] = {
          openingSpread: espnOdds.homeSpread,
          openingTotal: espnOdds.total,
          vegasSpread: espnOdds.homeSpread,
          vegasTotal: espnOdds.total,
          capturedAt: now.toISOString(),
          lockedAt: now.toISOString(), // Already completed, so lock immediately
        };
        backfilledCount++;

        // Small delay to avoid rate limiting
        if (backfilledCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    }
    if (backfilledCount > 0) {
      log(`Backfilled ${backfilledCount} completed games with ESPN odds`);
    }

    // Final odds coverage check
    const finalMissingOdds = allCompletedGameIds.filter(id => !historicalOdds[id]?.vegasSpread);
    if (finalMissingOdds.length > 0) {
      const pct = Math.round((1 - finalMissingOdds.length / allCompletedGameIds.length) * 100);
      log(`⚠️ WARNING: ${finalMissingOdds.length}/${allCompletedGameIds.length} games still missing odds after backfill (${pct}% coverage)`);
    } else if (allCompletedGameIds.length > 0) {
      log(`✅ All ${allCompletedGameIds.length} completed games have Vegas odds`);
    }

    // Fetch odds for upcoming games
    for (const game of upcomingGames) {
      if (!game.id) continue;
      const gameTime = new Date(game.gameTime);

      // Check if odds should be locked
      const storedOdds = historicalOdds[game.id];
      if (storedOdds?.lockedAt) {
        // Already locked, don't update
        continue;
      }

      // Lock odds 1 hour before game
      if (gameTime <= oneHourFromNow && storedOdds) {
        storedOdds.lockedAt = now.toISOString();
        continue;
      }

      // Fetch fresh odds
      const espnOdds = await fetchESPNOdds(game.id);
      if (espnOdds) {
        if (!storedOdds) {
          historicalOdds[game.id] = {
            openingSpread: espnOdds.homeSpread,
            openingTotal: espnOdds.total,
            vegasSpread: espnOdds.homeSpread,
            vegasTotal: espnOdds.total,
            capturedAt: now.toISOString(),
          };
        } else {
          storedOdds.lastSeenSpread = espnOdds.homeSpread;
          storedOdds.lastSeenTotal = espnOdds.total;
          storedOdds.vegasSpread = espnOdds.homeSpread;
          storedOdds.vegasTotal = espnOdds.total;
          storedOdds.lastUpdatedAt = now.toISOString();
        }
      }
    }

    // Generate predictions for upcoming games (matching NBA format)
    const predictions: unknown[] = [];
    for (const game of upcomingGames) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;

      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      const { homeScore: predHome, awayScore: predAway, calc } = predictScore(
        homeTeam.eloRating, awayTeam.eloRating,
        homeTeam.ppg || LEAGUE_AVG_GPG, homeTeam.ppgAllowed || LEAGUE_AVG_GPG,
        awayTeam.ppg || LEAGUE_AVG_GPG, awayTeam.ppgAllowed || LEAGUE_AVG_GPG
      );

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;
      const adjustedHomeElo = homeTeam.eloRating + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayTeam.eloRating - adjustedHomeElo) / 400));

      const storedOdds = historicalOdds[game.id];
      const vegasSpread = storedOdds?.vegasSpread;
      const vegasTotal = storedOdds?.vegasTotal;

      const spreadEdge = vegasSpread !== undefined ? vegasSpread - predictedSpread : 0;
      const totalEdge = vegasTotal !== undefined ? predictedTotal - vegasTotal : 0;
      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;

      // Confidence levels (adjusted for NHL's low-scoring nature)
      // NHL games average ~6 total goals, so a 0.5 goal edge is significant
      const absSpreadEdge = Math.abs(spreadEdge);
      const absTotalEdge = Math.abs(totalEdge);
      const eloGap = Math.abs(homeTeam.eloRating - awayTeam.eloRating);

      // When Vegas odds are available, use spread edge; otherwise use Elo gap
      let atsConfidence: 'high' | 'medium' | 'low';
      if (vegasSpread !== undefined) {
        atsConfidence = absSpreadEdge >= 0.5 ? 'high' : absSpreadEdge >= 0.2 ? 'medium' : 'low';
      } else {
        // No Vegas odds - use Elo gap (50+ = high, 25+ = medium)
        atsConfidence = eloGap >= 50 ? 'high' : eloGap >= 25 ? 'medium' : 'low';
      }

      let ouConfidence: 'high' | 'medium' | 'low';
      if (vegasTotal !== undefined) {
        ouConfidence = absTotalEdge >= 0.5 ? 'high' : absTotalEdge >= 0.2 ? 'medium' : 'low';
      } else {
        // No Vegas total - use predicted total deviation from league avg (6.2)
        const totalDev = Math.abs(predictedTotal - 6.2);
        ouConfidence = totalDev >= 0.5 ? 'high' : totalDev >= 0.3 ? 'medium' : 'low';
      }

      const mlConfidence: 'high' | 'medium' | 'low' =
        mlEdge >= 12 ? 'high' : mlEdge >= 5 ? 'medium' : 'low';

      // Keep backtest high conviction at 1.5 (validated at 72.7% ATS)
      const isHighConviction = absSpreadEdge >= 1.5 && vegasSpread !== undefined;

      // Match NBA structure exactly
      predictions.push({
        game: {
          id: game.id,
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          gameTime: game.gameTime,
          status: 'scheduled',
          venue: game.venue,
          season: currentSeason,
          homeTeam: {
            id: homeTeam.id,
            name: homeTeam.name,
            abbreviation: homeTeam.abbreviation,
          },
          awayTeam: {
            id: awayTeam.id,
            name: awayTeam.name,
            abbreviation: awayTeam.abbreviation,
          },
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
          lineMovement: storedOdds ? {
            openingSpread: storedOdds.openingSpread,
            openingTotal: storedOdds.openingTotal,
            lastSeenSpread: storedOdds.lastSeenSpread,
            lastSeenTotal: storedOdds.lastSeenTotal,
            lastUpdatedAt: storedOdds.lastUpdatedAt,
          } : undefined,
          spreadEdge: Math.round(spreadEdge * 10) / 10,
          totalEdge: Math.round(totalEdge * 10) / 10,
          atsConfidence,
          ouConfidence,
          mlConfidence,
          isAtsBestBet: atsConfidence === 'high',
          isOuBestBet: ouConfidence === 'high',
          isMlBestBet: mlConfidence === 'high',
          mlEdge: Math.round(mlEdge * 10) / 10,
          eloGap,
          isHighConviction,
          homeElo: homeTeam.eloRating,
          awayElo: awayTeam.eloRating,
          calc,
        },
      });
    }

    log(`Generated ${predictions.length} predictions`);

    // Build backtest summary (including high conviction for persistence)
    const totalGamesWithOdds = spreadWins + spreadLosses + spreadPushes;
    const hcTotal = hcSpreadWins + hcSpreadLosses + hcSpreadPushes;

    const backtestSummary = {
      totalGames: totalGamesWithOdds,
      spread: {
        wins: spreadWins,
        losses: spreadLosses,
        pushes: spreadPushes,
        winPct: totalGamesWithOdds > 0 ? Math.round((spreadWins / (spreadWins + spreadLosses)) * 1000) / 10 : 0,
      },
      moneyline: {
        wins: mlWins,
        losses: mlLosses,
        winPct: mlWins + mlLosses > 0 ? Math.round((mlWins / (mlWins + mlLosses)) * 1000) / 10 : 0,
      },
      overUnder: {
        wins: ouWins,
        losses: ouLosses,
        pushes: ouPushes,
        winPct: ouWins + ouLosses > 0 ? Math.round((ouWins / (ouWins + ouLosses)) * 1000) / 10 : 0,
      },
      // Include high conviction in saved state so it persists across runs
      highConviction: {
        spread: { wins: hcSpreadWins, losses: hcSpreadLosses, pushes: hcSpreadPushes },
        moneyline: { wins: hcMlWins, losses: hcMlLosses },
        overUnder: { wins: hcOuWins, losses: hcOuLosses, pushes: hcOuPushes },
      },
    };

    const highConvictionSummary = {
      spread: {
        wins: hcSpreadWins,
        losses: hcSpreadLosses,
        pushes: hcSpreadPushes,
        winPct: hcTotal > 0 ? Math.round((hcSpreadWins / (hcSpreadWins + hcSpreadLosses)) * 1000) / 10 : 0,
      },
      moneyline: {
        wins: hcMlWins,
        losses: hcMlLosses,
        winPct: hcMlWins + hcMlLosses > 0 ? Math.round((hcMlWins / (hcMlWins + hcMlLosses)) * 1000) / 10 : 0,
      },
      overUnder: {
        wins: hcOuWins,
        losses: hcOuLosses,
        pushes: hcOuPushes,
        winPct: hcOuWins + hcOuLosses > 0 ? Math.round((hcOuWins / (hcOuWins + hcOuLosses)) * 1000) / 10 : 0,
      },
    };

    log(`Backtest: ATS ${backtestSummary.spread.winPct}% (${spreadWins}-${spreadLosses}-${spreadPushes})`);

    // Save to Firestore
    log('Saving to Firestore...');
    const teamDocs = Array.from(teamsMap.values()).map(t => ({ id: t.id, data: t as unknown as Record<string, unknown> }));
    await saveDocsBatch(sport, 'teams', teamDocs);

    const oddsDocs = Object.entries(historicalOdds).map(([id, data]) => ({ id, data: data as unknown as Record<string, unknown> }));
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);

    await setSportState(sport, {
      season: currentSeason,
      processedGameIds: Array.from(processedGameIds),
      backtestSummary,
      lastSyncAt: now.toISOString(),
    });

    // Build blob state
    const sortedTeams = Array.from(teamsMap.values()).sort((a, b) => b.eloRating - a.eloRating);

    // Helper to convert Firestore timestamps to ISO strings (matching NBA sync)
    const coerceGameTime = (value: any) => {
      if (!value) return value;
      if (typeof value === 'string') return value;
      if (typeof value === 'number') return new Date(value).toISOString();
      if (typeof value === 'object' && typeof value._seconds === 'number') {
        return new Date(value._seconds * 1000).toISOString();
      }
      return value;
    };

    // Get all backtest results
    const existingResults = (await getDocsList<any>(sport, 'results')).map(r => ({
      ...r,
      gameId: r.gameId || r.id,
      gameTime: coerceGameTime(r.gameTime),
    }));
    const allResults = [...existingResults, ...newBacktestResults];

    // Get recent completed games for display (match NBA format exactly)
    const recentGames = [...allResults]
      .sort((a: any, b: any) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
      .slice(0, 10)
      .map((r: any) => ({
        id: r.gameId,
        homeTeam: { abbreviation: r.homeTeam },
        awayTeam: { abbreviation: r.awayTeam },
        homeScore: r.actualHomeScore,
        awayScore: r.actualAwayScore,
        gameTime: coerceGameTime(r.gameTime),
        status: 'final',
      }));

    // Save new results
    if (newBacktestResults.length > 0) {
      const resultDocs = newBacktestResults.map((r: any) => ({ id: r.gameId, data: r }));
      await saveDocsBatch(sport, 'results', resultDocs);
    }

    const blobState: BlobState = {
      generated: now.toISOString(),
      teams: sortedTeams,
      games: predictions,
      recentGames,
      backtest: {
        summary: backtestSummary,
        highConvictionSummary,
        results: allResults.filter((r: any) => {
          // Only include current season games (season starts in October of previous year)
          const gameDate = new Date(r.gameTime);
          const seasonStart = new Date(currentSeason - 1, 9, 1); // October 1 of previous year
          return gameDate >= seasonStart;
        }),
      },
    };

    // Upload to Vercel Blob
    log('Uploading to Vercel Blob...');
    const blob = await put('nhl-prediction-data.json', JSON.stringify(blobState), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Write heartbeat
    await put('cron-heartbeat-nhl.json', JSON.stringify({
      lastRun: now.toISOString(),
      gamesProcessed: newGames.length,
      predictionsGenerated: predictions.length,
      backtestGames: totalGamesWithOdds,
    }), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    log(`Done! Blob URL: ${blob.url}`);

    return NextResponse.json({
      success: true,
      logs,
      stats: {
        teamsLoaded: teamsMap.size,
        gamesProcessed: newGames.length,
        predictions: predictions.length,
        backtest: backtestSummary,
        highConviction: highConvictionSummary,
      },
      blobUrl: blob.url,
    });
  } catch (error) {
    console.error('NHL sync error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}
