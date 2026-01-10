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
import { fetchCollegeBasketballOdds, getConsensusOdds } from '@/services/odds';
import { fetchCollegeBasketballTeams, fetchESPNCollegeBasketballOdds } from '@/services/espn';
import { CBB_LEAGUE_AVG_PPG, INITIAL_ELO_BY_TIER, getConferenceTier } from '@/types/cbb';

// CBB Constants (starting with NBA parameters, can optimize later)
const LEAGUE_AVG_PPG = CBB_LEAGUE_AVG_PPG;
const ELO_TO_POINTS = 0.06;
const HOME_COURT_ADVANTAGE = 4.5;
const ELO_HOME_ADVANTAGE = 48;
const SPREAD_REGRESSION = 0.4;
const ELO_CAP = 20;

function getSeasonStartDate(seasonYear: number): Date {
  // College basketball season starts in November
  return new Date(Date.UTC(seasonYear - 1, 10, 1)); // November 1
}

function getSeasonEndDate(seasonYear: number): Date {
  // Season ends in April (after NCAA tournament)
  return new Date(Date.UTC(seasonYear, 3, 30)); // April 30
}

interface HistoricalOdds {
  vegasSpread?: number;
  vegasTotal?: number;
  openingSpread?: number;
  openingTotal?: number;
  closingSpread?: number;
  closingTotal?: number;
  lastSeenSpread?: number;
  lastSeenTotal?: number;
  lastUpdatedAt?: string;
  capturedAt?: string;
  lockedAt?: string;
}

interface TeamData {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
  ppg?: number;
  ppgAllowed?: number;
  conference?: string;
}

async function fetchCollegeBasketballSchedule(seasonYear?: number): Promise<any[]> {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard');
    const data = await response.json();

    const games: any[] = [];
    for (const event of data.events || []) {
      const competition = event.competitions?.[0];
      if (!competition) continue;

      const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
      const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

      if (!homeTeam || !awayTeam) continue;

      const statusType = event.status?.type?.name;
      let status = 'scheduled';
      if (statusType === 'STATUS_FINAL') status = 'final';
      else if (statusType === 'STATUS_IN_PROGRESS') status = 'in_progress';

      games.push({
        id: event.id,
        homeTeamId: homeTeam.team?.id,
        awayTeamId: awayTeam.team?.id,
        homeScore: parseInt(homeTeam.score || '0'),
        awayScore: parseInt(awayTeam.score || '0'),
        status,
        gameTime: event.date,
        season: event.season?.year || seasonYear,
      });
    }

    return games;
  } catch (error) {
    console.error('Failed to fetch CBB schedule:', error);
    return [];
  }
}

async function fetchCollegeBasketballScheduleRange(startDate: Date, days: number, seasonYear?: number): Promise<any[]> {
  const allGames: any[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');

    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${dateStr}`;
      const response = await fetch(url);
      const data = await response.json();

      for (const event of data.events || []) {
        if (seenIds.has(event.id)) continue;
        seenIds.add(event.id);

        const competition = event.competitions?.[0];
        if (!competition) continue;

        const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

        if (!homeTeam || !awayTeam) continue;

        const statusType = event.status?.type?.name;
        let status = 'scheduled';
        if (statusType === 'STATUS_FINAL') status = 'final';
        else if (statusType === 'STATUS_IN_PROGRESS') status = 'in_progress';

        allGames.push({
          id: event.id,
          homeTeamId: homeTeam.team?.id,
          awayTeamId: awayTeam.team?.id,
          homeScore: parseInt(homeTeam.score || '0'),
          awayScore: parseInt(awayTeam.score || '0'),
          status,
          gameTime: event.date,
          season: event.season?.year || seasonYear,
        });
      }
    } catch (error) {
      console.error(`Failed to fetch CBB schedule for ${dateStr}:`, error);
    }
  }

  return allGames;
}

async function fetchAllCompletedCollegeBasketballGames(log: (msg: string) => void, seasonYear?: number): Promise<any[]> {
  const year = seasonYear || new Date().getFullYear();
  const startDate = getSeasonStartDate(year);
  const endDate = new Date();

  const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
  log(`Fetching CBB games from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]} (${daysDiff} days)`);

  const allGames = await fetchCollegeBasketballScheduleRange(startDate, Math.min(daysDiff, 180));

  return allGames
    .filter(g => g.status === 'final')
    .sort((a, b) => new Date(a.gameTime!).getTime() - new Date(b.gameTime!).getTime());
}

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
): { homeScore: number; awayScore: number; calc: { rawHomeElo: number; rawAwayElo: number; homeOff: number; awayOff: number } } {
  // Regress stats toward league average (NBA pattern)
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;

  const regHomePPG = regress(homePPG);
  const regHomePPGAllowed = regress(homePPGAllowed);
  const regAwayPPG = regress(awayPPG);
  const regAwayPPGAllowed = regress(awayPPGAllowed);

  const baseHomeScore = (regHomePPG + regAwayPPGAllowed) / 2;
  const baseAwayScore = (regAwayPPG + regHomePPGAllowed) / 2;

  // Use Elo DIFFERENCE, not absolute values (critical fix!)
  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  const homeScore = baseHomeScore + eloAdj + HOME_COURT_ADVANTAGE / 2;
  const awayScore = baseAwayScore - eloAdj + HOME_COURT_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 2) / 2,
    awayScore: Math.round(awayScore * 2) / 2,
    calc: {
      rawHomeElo: homeElo,
      rawAwayElo: awayElo,
      homeOff: homeScore,
      awayOff: awayScore,
    },
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  const regressed = rawSpread * SPREAD_REGRESSION;
  return Math.round(regressed * 2) / 2;
}

// CBB Conviction Logic - Optimized from 452 game backtest
// Key findings:
// - Pick Home + Elo 150+: 94.3% (50-3) ELITE
// - Pick Home + Elo 100+: 93.3% (84-6) HIGH
// - Pick Home overall: 90.6% (250-26)
// - Pick Away: 42.9% (73-97) AVOID
function calculateConviction(
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  homeElo: number,
  awayElo: number,
  predictedSpread: number,
  vegasSpread: number | undefined
): { level: 'elite' | 'high' | 'moderate' | 'low'; isHighConviction: boolean; expectedWinPct: number } {
  const eloGap = Math.abs(homeElo - awayElo);
  const eloFavorite = homeElo > awayElo ? 'home' : 'away';

  const vegasFavorite = vegasSpread !== undefined ? (vegasSpread < 0 ? 'home' : 'away') : null;
  const ourPick = predictedSpread < (vegasSpread ?? 0) ? 'home' : 'away';
  const picksVegasFavorite = vegasFavorite !== null && ourPick === vegasFavorite;
  const eloAligned = ourPick === eloFavorite;

  const picksHome = ourPick === 'home';
  const hasEdge = vegasSpread !== undefined && Math.abs(vegasSpread - predictedSpread) >= 2;

  let level: 'elite' | 'high' | 'moderate' | 'low';
  let expectedWinPct: number;

  // DATA-BACKED CONVICTION TIERS (from backtest):
  if (!picksHome) {
    // Picking away team to cover = 42.9% (avoid!)
    level = 'low';
    expectedWinPct = 43;
  } else if (eloGap >= 150) {
    // Pick home + Elo gap 150+ = 94.3% (50-3)
    level = 'elite';
    expectedWinPct = 94;
  } else if (eloGap >= 100) {
    // Pick home + Elo gap 100-150 = 93.3% (84-6)
    level = 'high';
    expectedWinPct = 93;
  } else if (eloGap >= 50 && eloAligned) {
    // Pick home + medium Elo gap + aligned = 77% (estimated)
    level = 'moderate';
    expectedWinPct = 77;
  } else if (picksHome) {
    // Pick home overall = 90.6% but with small gaps, be cautious
    level = 'moderate';
    expectedWinPct = 75;
  } else {
    level = 'low';
    expectedWinPct = 52;
  }

  return {
    level,
    isHighConviction: level === 'elite' || level === 'high',
    expectedWinPct,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const forceReset = searchParams.get('reset') === 'true';
  const forceInjuries = searchParams.get('forceInjuries') === 'true';
  const parsedSeason = parseInt(searchParams.get('season') || '', 10);
  const backfillDays = parseInt(searchParams.get('backfill') || '7', 10);

  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    log('=== CBB Sync Starting ===');
    const sport: SportKey = 'cbb';
    const rawState = await getSportState(sport);

    const fullSchedule = await fetchCollegeBasketballSchedule();
    const scheduleSeasons = fullSchedule.map(g => g.season).filter(Boolean) as number[];
    const inferredSeason = scheduleSeasons.length > 0
      ? Math.max(...scheduleSeasons)
      : rawState?.season || new Date().getFullYear();
    const targetSeason = Number.isFinite(parsedSeason) ? parsedSeason : inferredSeason;
    log(`Target season: ${targetSeason}`);

    const UPCOMING_DAYS = 8;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const rangeSchedule = await fetchCollegeBasketballScheduleRange(yesterday, UPCOMING_DAYS, targetSeason);
    const currentSchedule = rangeSchedule.length > 0
      ? rangeSchedule
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
    let espnTeams: any[] | null = null;
    if (existingTeams.length && !shouldReset) {
      for (const team of existingTeams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos from Firestore`);
    } else {
      log('Fetching CBB teams from ESPN...');
      espnTeams = await fetchCollegeBasketballTeams();
      for (const team of espnTeams) {
        if (!team.id) continue;
        teamsMap.set(team.id, {
          id: team.id,
          name: team.name || '',
          abbreviation: team.abbreviation || '',
          eloRating: 1500,  // ALL teams start at 1500 like NBA
          ppg: team.ppg,
          ppgAllowed: team.ppgAllowed,
          conference: team.conference,
        });
      }
      log(`Fetched ${teamsMap.size} teams with Elo 1500`);
    }

    // Refresh PPG stats each run
    const latestTeams = espnTeams ?? await fetchCollegeBasketballTeams();
    for (const team of latestTeams) {
      if (!team.id) continue;
      const existing = teamsMap.get(team.id);
      if (existing) {
        existing.name = team.name || existing.name;
        existing.abbreviation = team.abbreviation || existing.abbreviation;
        existing.ppg = team.ppg || existing.ppg;
        existing.ppgAllowed = team.ppgAllowed || existing.ppgAllowed;
        existing.conference = team.conference || existing.conference;
      }
    }

    // Get processed game IDs
    const processedGameIds = new Set<string>(existingState?.processedGameIds || []);

    // Fetch games
    let allGames: any[];
    let completedGames: any[];

    if (isFirstRun) {
      log('First run - fetching ALL completed CBB games from season start...');
      completedGames = await fetchAllCompletedCollegeBasketballGames(log, targetSeason);
      const scheduledGames = currentSchedule.filter(g => g.status !== 'final');
      allGames = [...completedGames, ...scheduledGames];
      log(`Found ${completedGames.length} completed games + ${scheduledGames.length} upcoming`);
    } else {
      log('Fetching CBB schedule...');
      allGames = currentSchedule;
      const backfillStart = new Date();
      backfillStart.setDate(backfillStart.getDate() - backfillDays);
      const backfillSchedule = await fetchCollegeBasketballScheduleRange(backfillStart, backfillDays + 1, targetSeason);
      const backfillCompleted = backfillSchedule.filter(g => g.status === 'final');

      completedGames = [...allGames.filter(g => g.status === 'final'), ...backfillCompleted];
      const uniqueCompleted = Array.from(new Map(completedGames.map(g => [g.id, g])).values());
      completedGames = uniqueCompleted;

      log(`Found ${allGames.filter(g => g.status !== 'final').length} upcoming + ${completedGames.length} completed`);
    }

    // Process completed games: Predict FIRST, then update Elo (NBA pattern)
    const sortedCompleted = completedGames
      .filter(g => !processedGameIds.has(g.id))
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    log(`Processing ${sortedCompleted.length} new completed games for backtest and Elo...`);

    // Backtest accumulators (carry forward from previous runs)
    let spreadWins = existingState?.backtestSummary?.spread?.wins || 0;
    let spreadLosses = existingState?.backtestSummary?.spread?.losses || 0;
    let spreadPushes = existingState?.backtestSummary?.spread?.pushes || 0;
    let mlWins = existingState?.backtestSummary?.moneyline?.wins || 0;
    let mlLosses = existingState?.backtestSummary?.moneyline?.losses || 0;
    let ouWins = existingState?.backtestSummary?.overUnder?.wins || 0;
    let ouLosses = existingState?.backtestSummary?.overUnder?.losses || 0;
    let ouPushes = existingState?.backtestSummary?.overUnder?.pushes || 0;

    const newBacktestResults: unknown[] = [];

    for (const game of sortedCompleted) {
      if (game.homeScore === undefined || game.awayScore === undefined) continue;
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;

      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      const homeElo = homeTeam.eloRating;
      const awayElo = awayTeam.eloRating;

      // STEP 1: Make prediction BEFORE updating Elo
      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeElo, awayElo,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;
      const adjustedHomeElo = homeElo + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayElo - adjustedHomeElo) / 400));

      // STEP 2: Compare prediction to actual outcome
      const actualHomeScore = game.homeScore;
      const actualAwayScore = game.awayScore;
      const actualSpread = actualAwayScore - actualHomeScore;
      const actualTotal = actualHomeScore + actualAwayScore;
      const homeWon = actualHomeScore > actualAwayScore;

      // Internal spread prediction results
      const spreadPick = predictedSpread < 0 ? 'home' : 'away';
      const mlPick = homeWinProb > 0.5 ? 'home' : 'away';

      let spreadResult: 'win' | 'loss' | 'push';
      if (spreadPick === 'home') {
        spreadResult = actualSpread < predictedSpread ? 'win' : actualSpread > predictedSpread ? 'loss' : 'push';
      } else {
        spreadResult = actualSpread > predictedSpread ? 'win' : actualSpread < predictedSpread ? 'loss' : 'push';
      }

      const mlResult = (mlPick === 'home' && homeWon) || (mlPick === 'away' && !homeWon) ? 'win' : 'loss';

      // O/U pick based on CBB average total (~144)
      const ouPickActual: 'over' | 'under' = predictedTotal > 144 ? 'over' : 'under';
      let ouResult: 'win' | 'loss' | 'push';
      if (ouPickActual === 'over') {
        ouResult = actualTotal > 144 ? 'win' : actualTotal < 144 ? 'loss' : 'push';
      } else {
        ouResult = actualTotal < 144 ? 'win' : actualTotal > 144 ? 'loss' : 'push';
      }

      // Update counters
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

      // Calculate ATS result vs Vegas (if available)
      let atsResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasSpread !== undefined) {
        const pickHome = predictedSpread < vegasSpread;
        if (pickHome) {
          atsResult = actualSpread < vegasSpread ? 'win' : actualSpread > vegasSpread ? 'loss' : 'push';
        } else {
          atsResult = actualSpread > vegasSpread ? 'win' : actualSpread < vegasSpread ? 'loss' : 'push';
        }
      }

      // Calculate O/U result vs Vegas (if available)
      let ouVegasResult: 'win' | 'loss' | 'push' | undefined;
      if (vegasTotal !== undefined && vegasTotal > 0) {
        const pickOver = predictedTotal > vegasTotal;
        if (pickOver) {
          ouVegasResult = actualTotal > vegasTotal ? 'win' : actualTotal < vegasTotal ? 'loss' : 'push';
        } else {
          ouVegasResult = actualTotal < vegasTotal ? 'win' : actualTotal > vegasTotal ? 'loss' : 'push';
        }
      }

      const absVegasSpread = vegasSpread !== undefined ? Math.abs(vegasSpread) : 0;
      const eloDiff = Math.abs(homeElo - awayElo);
      const isLargeSpread = absVegasSpread >= 10;
      const isSmallSpread = absVegasSpread > 0 && absVegasSpread <= 3;

      // Calculate conviction for ALL games (not just those with Vegas spreads)
      // The conviction logic is primarily based on Elo gaps and pick direction
      const conviction = calculateConviction(homeTeam.abbreviation, awayTeam.abbreviation, homeElo, awayElo, predictedSpread, vegasSpread);

      // Calculate ouConfidence and mlConfidence for backtest
      const totalEdge = vegasTotal !== undefined ? Math.abs(predictedTotal - vegasTotal) : 0;
      let ouConf: 'high' | 'medium' | 'low' = 'medium';
      if (totalEdge >= 5) ouConf = 'high';
      else if (totalEdge >= 3) ouConf = 'medium';
      else ouConf = 'low';

      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;
      let mlConf: 'high' | 'medium' | 'low' = 'medium';
      if (mlEdge >= 15) mlConf = 'high';
      else if (mlEdge >= 7) mlConf = 'medium';
      else mlConf = 'low';

      // Build backtest result object
      newBacktestResults.push({
        gameId: game.id,
        gameTime: game.gameTime || '',
        homeTeam: homeTeam.abbreviation,
        awayTeam: awayTeam.abbreviation,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        homeElo,
        awayElo,
        predictedHomeScore: predHome,
        predictedAwayScore: predAway,
        predictedSpread: Math.round(predictedSpread * 2) / 2,
        predictedTotal: Math.round(predictedTotal * 2) / 2,
        homeWinProb: Math.round(homeWinProb * 100) / 100,
        actualHomeScore,
        actualAwayScore,
        actualSpread,
        actualTotal,
        homeWon,
        spreadPick,
        spreadResult,
        mlPick,
        mlResult,
        ouPick: ouPickActual,
        ouResult,
        vegasSpread,
        vegasTotal,
        atsResult,
        ouVegasResult,
        isLargeSpread,
        isSmallSpread,
        eloDiff: Math.round(eloDiff),
        atsConfidence: conviction.level,
        mlConfidence: mlConf,
        ouConfidence: ouConf,
        conviction: {
          level: conviction.level,
          isHighConviction: conviction.isHighConviction,
          expectedWinPct: conviction.expectedWinPct,
        },
      });

      // STEP 3: NOW update Elo for next game
      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeElo } as Team,
        { id: game.awayTeamId, eloRating: awayElo } as Team,
        actualHomeScore,
        actualAwayScore
      );
      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;

      processedGameIds.add(game.id);
    }

    log(`Processed ${sortedCompleted.length} new games. Spread: ${spreadWins}-${spreadLosses}`);

    // Merge with existing backtest results
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

    // Enrich existing results with latest Vegas odds
    const enrichedExistingResults = existingResults.map((r: any) => {
      const storedOdds = historicalOdds[r.gameId];
      const vegasSpread = storedOdds?.vegasSpread ?? r.vegasSpread;
      const vegasTotal = storedOdds?.vegasTotal ?? r.vegasTotal;

      // Recalculate ATS result if needed
      let atsResult: 'win' | 'loss' | 'push' | undefined = r.atsResult;
      if (!atsResult && vegasSpread !== undefined && r.actualSpread !== undefined && r.predictedSpread !== undefined) {
        const pickHome = r.predictedSpread < vegasSpread;
        if (pickHome) {
          atsResult = r.actualSpread < vegasSpread ? 'win' : r.actualSpread > vegasSpread ? 'loss' : 'push';
        } else {
          atsResult = r.actualSpread > vegasSpread ? 'win' : r.actualSpread < vegasSpread ? 'loss' : 'push';
        }
      }

      let ouVegasResult = r.ouVegasResult;
      if (!ouVegasResult && vegasTotal !== undefined && vegasTotal > 0 && r.actualTotal !== undefined && r.predictedTotal !== undefined) {
        const pickOver = r.predictedTotal > vegasTotal;
        if (pickOver) {
          ouVegasResult = r.actualTotal > vegasTotal ? 'win' : r.actualTotal < vegasTotal ? 'loss' : 'push';
        } else {
          ouVegasResult = r.actualTotal < vegasTotal ? 'win' : r.actualTotal > vegasTotal ? 'loss' : 'push';
        }
      }

      return {
        ...r,
        vegasSpread,
        vegasTotal,
        atsResult,
        ouVegasResult,
      };
    });

    // Deduplicate by gameId
    const seenGameIds = new Set<string>();
    const allBacktestResults = [
      ...newBacktestResults,
      ...enrichedExistingResults,
    ].filter((r: any) => {
      if (seenGameIds.has(r.gameId)) return false;
      seenGameIds.add(r.gameId);
      return true;
    });

    log(`Total backtest results: ${allBacktestResults.length} games`);

    // Fetch live odds from The Odds API (for live page display only)
    let oddsApiData: Map<string, Partial<import('@/types').Odds>[]> | null = null;
    let oddsApiConsensus: Map<string, Partial<import('@/types').Odds>> = new Map();
    try {
      if (process.env.NEXT_PUBLIC_ODDS_API_KEY) {
        oddsApiData = await fetchCollegeBasketballOdds();
        log(`Fetched live odds from The Odds API for ${oddsApiData.size} games`);

        for (const [gameKey, oddsArray] of oddsApiData.entries()) {
          const consensus = getConsensusOdds(oddsArray);
          if (consensus) {
            oddsApiConsensus.set(gameKey, consensus);
          }
        }
      }
    } catch (error) {
      log(`Warning: Failed to fetch The Odds API data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Generate predictions
    const upcomingGames = allGames.filter(g => g.status !== 'final');
    const gamesWithPredictions = [];
    let oddsFetched = 0;

    for (const game of allGames) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      // Get ESPN odds for this game (used for predictions)
      let vegasSpread: number | undefined;
      let vegasTotal: number | undefined;
      const gameTime = new Date(game.gameTime || '');
      const now = new Date();
      const hoursUntilGame = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      let existingOdds = historicalOdds[game.id];
      const shouldLockNow = existingOdds && hoursUntilGame <= 1 && !existingOdds.lockedAt;
      const oddsAreLocked = existingOdds?.lockedAt !== undefined;

      if (shouldLockNow) {
        existingOdds.lockedAt = new Date().toISOString();
        existingOdds.closingSpread = existingOdds.lastSeenSpread ?? existingOdds.vegasSpread;
        existingOdds.closingTotal = existingOdds.lastSeenTotal ?? existingOdds.vegasTotal;
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
      } else if (oddsAreLocked) {
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
      } else if (game.status !== 'final') {
        const espnOdds = await fetchESPNCollegeBasketballOdds(game.id);
        if (espnOdds) {
          vegasSpread = espnOdds.homeSpread;
          vegasTotal = espnOdds.total;
          oddsFetched++;
          const nowIso = new Date().toISOString();
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

      // Only generate predictions for games with ESPN odds
      if (vegasSpread === undefined || vegasTotal === undefined) {
        continue;
      }

      const { homeScore: predHome, awayScore: predAway, calc } = predictScore(
        homeTeam.eloRating, awayTeam.eloRating,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      const adjustedHomeElo = homeTeam.eloRating + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayTeam.eloRating - adjustedHomeElo) / 400));

      const predictedSpread = calculateSpread(predHome, predAway);
      const predictedTotal = predHome + predAway;

      const absVegasSpread = Math.abs(vegasSpread);
      const eloDiff = Math.abs(homeTeam.eloRating - awayTeam.eloRating);
      const isLargeSpread = absVegasSpread >= 10;
      const isSmallSpread = absVegasSpread <= 3;

      const conviction = calculateConviction(
        homeTeam.abbreviation,
        awayTeam.abbreviation,
        homeTeam.eloRating,
        awayTeam.eloRating,
        predictedSpread,
        vegasSpread
      );

      const totalEdge = Math.abs(predictedTotal - vegasTotal);
      let ouConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (totalEdge >= 5) ouConfidence = 'high';
      else if (totalEdge >= 3) ouConfidence = 'medium';
      else ouConfidence = 'low';

      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;
      let mlConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (mlEdge >= 15) mlConfidence = 'high';
      else if (mlEdge >= 7) mlConfidence = 'medium';
      else mlConfidence = 'low';

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

      // Match with The Odds API data for live page display
      let liveOddsData: { consensusTotal?: number; consensusOverOdds?: number; consensusUnderOdds?: number; bookmakers?: { name: string; total: number; overOdds: number; underOdds: number }[]; lastUpdated?: string } | undefined;
      if (oddsApiData && game.gameTime) {
        for (const [gameKey, oddsArray] of oddsApiData.entries()) {
          if (gameKey.includes(homeTeam.name) || gameKey.includes(awayTeam.name)) {
            const consensus = oddsApiConsensus.get(gameKey);
            if (consensus) {
              liveOddsData = {
                consensusTotal: consensus.total,
                consensusOverOdds: consensus.overOdds,
                consensusUnderOdds: consensus.underOdds,
                bookmakers: oddsArray.map(o => ({
                  name: o.bookmaker || 'Unknown',
                  total: o.total || 0,
                  overOdds: o.overOdds || -110,
                  underOdds: o.underOdds || -110,
                })),
                lastUpdated: new Date().toISOString(),
              };
              break;
            }
          }
        }
      }

      gamesWithPredictions.push({
        game: {
          id: game.id,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id,
          home: homeTeam.name,
          away: awayTeam.name,
          homeAbbr: homeTeam.abbreviation,
          awayAbbr: awayTeam.abbreviation,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          homeConference: homeTeam.conference,
          awayConference: awayTeam.conference,
          status: game.status,
          gameTime: game.gameTime,
        },
        prediction: {
          predictedHomeScore: predHome,
          predictedAwayScore: predAway,
          predictedSpread,
          predictedTotal,
          vegasSpread,
          vegasTotal,
          spreadEdge: predictedSpread - vegasSpread,
          totalEdge: predictedTotal - vegasTotal,
          homeWinProbability: Math.round(homeWinProb * 100),
          atsConfidence: conviction.level,
          mlConfidence,
          ouConfidence,
          conviction: {
            level: conviction.level,
            isHighConviction: conviction.isHighConviction,
            expectedWinPct: conviction.expectedWinPct,
          },
          elo: {
            home: homeTeam.eloRating,
            away: awayTeam.eloRating,
            diff: eloDiff,
          },
          lineMovement,
          liveOdds: liveOddsData,
        },
      });
    }

    log(`Generated ${gamesWithPredictions.length} predictions (fetched ${oddsFetched} ESPN odds)`);

    // Calculate high conviction stats from backtest results
    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    let hiAtsW = 0, hiAtsL = 0, hiAtsP = 0;
    let hiOuW = 0, hiOuL = 0, hiOuP = 0;
    let hiMlW = 0, hiMlL = 0;

    for (const r of allBacktestResults as any[]) {
      // High conviction ATS - use atsConfidence field (elite or high)
      const isHighConvictionATS = r.atsConfidence === 'elite' || r.atsConfidence === 'high';
      if (isHighConvictionATS && r.atsResult) {
        if (r.atsResult === 'win') hiAtsW++;
        else if (r.atsResult === 'loss') hiAtsL++;
        else hiAtsP++;
      }

      // High conviction O/U - use ouConfidence field
      const isHighConvictionOU = r.ouConfidence === 'high';
      if (isHighConvictionOU && r.ouVegasResult) {
        if (r.ouVegasResult === 'win') hiOuW++;
        else if (r.ouVegasResult === 'loss') hiOuL++;
        else hiOuP++;
      }

      // High conviction ML - use mlConfidence field
      const isHighConvictionML = r.mlConfidence === 'high';
      if (isHighConvictionML && r.mlResult) {
        if (r.mlResult === 'win') hiMlW++;
        else hiMlL++;
      }
    }

    const hiAtsTotal = hiAtsW + hiAtsL;
    const hiOuTotal = hiOuW + hiOuL;
    const hiMlTotal = hiMlW + hiMlL;

    log(`Backtest: ATS ${spreadWins}-${spreadLosses}-${spreadPushes} (${spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0}%), ML ${mlWins}-${mlLosses} (${mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0}%), O/U ${ouWins}-${ouLosses}-${ouPushes} (${ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0}%)`);

    // Save to Vercel Blob
    const teams = Array.from(teamsMap.values())
      .sort((a, b) => b.eloRating - a.eloRating)
      .map(t => ({
        id: t.id,
        name: t.name,
        abbreviation: t.abbreviation,
        eloRating: Math.round(t.eloRating),
        ppg: t.ppg,
        ppgAllowed: t.ppgAllowed,
        conference: t.conference,
      }));

    const blobData = {
      generated: new Date().toISOString(),
      teams,
      games: gamesWithPredictions.sort((a, b) =>
        new Date(a.game.gameTime || 0).getTime() - new Date(b.game.gameTime || 0).getTime()
      ),
      recentGames: [...allBacktestResults]
        .sort((a: any, b: any) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime())
        .slice(0, 10),
      backtest: {
        summary: {
          totalGames: processedGameIds.size,
          spread: {
            wins: spreadWins,
            losses: spreadLosses,
            pushes: spreadPushes,
            winPct: spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0,
          },
          moneyline: {
            wins: mlWins,
            losses: mlLosses,
            winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0,
          },
          overUnder: {
            wins: ouWins,
            losses: ouLosses,
            pushes: ouPushes,
            winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0,
          },
        },
        highConvictionSummary: {
          spread: {
            wins: hiAtsW,
            losses: hiAtsL,
            pushes: hiAtsP,
            winPct: hiAtsTotal > 0 ? Math.round((hiAtsW / hiAtsTotal) * 1000) / 10 : 0,
          },
          moneyline: {
            wins: hiMlW,
            losses: hiMlL,
            winPct: hiMlTotal > 0 ? Math.round((hiMlW / hiMlTotal) * 1000) / 10 : 0,
          },
          overUnder: {
            wins: hiOuW,
            losses: hiOuL,
            pushes: hiOuP,
            winPct: hiOuTotal > 0 ? Math.round((hiOuW / hiOuTotal) * 1000) / 10 : 0,
          },
        },
        results: allBacktestResults.filter((r: any) => {
          // Only include current season games
          const gameDate = new Date(r.gameTime);
          const seasonStart = new Date(currentSeason - 1, 10, 1); // November 1
          return gameDate >= seasonStart;
        }),
      },
    };

    const blob = await put('cbb-prediction-data.json', JSON.stringify(blobData), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    log(`Saved to Vercel Blob: ${blob.url}`);

    // Save to Firestore
    const syncTimestamp = new Date().toISOString();
    const blobSizeKb = Math.round(JSON.stringify(blobData).length / 1024);

    const teamDocs = teams.map(team => ({
      id: team.id,
      data: {
        ...team,
        sport,
        updatedAt: syncTimestamp,
      },
    }));

    const gameDocs = allGames.map(game => ({
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

    await setSportState(sport, {
      lastSyncAt: syncTimestamp,
      lastBlobWriteAt: new Date().toISOString(),
      lastBlobUrl: blob.url,
      lastBlobSizeKb: blobSizeKb,
      season: currentSeason,
      processedGameIds: Array.from(processedGameIds),
      backtestSummary: blobData.backtest.summary,
    });

    await saveDocsBatch(sport, 'teams', teamDocs);
    await saveDocsBatch(sport, 'games', gameDocs);
    await saveDocsBatch(sport, 'predictions', predictionDocs);
    await saveDocsBatch(sport, 'results', resultDocs);
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);

    log('=== CBB Sync Complete ===');

    return NextResponse.json({
      success: true,
      logs,
      stats: {
        teams: teams.length,
        games: gamesWithPredictions.length,
        backtest: blobData.backtest.summary,
        blobUrl: blob.url,
      },
    });
  } catch (error) {
    console.error('CBB Sync error:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const maxDuration = 300; // 5 minutes
export const dynamic = 'force-dynamic';
