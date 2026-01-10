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
  const cappedEloHome = Math.max(homeElo - ELO_CAP, Math.min(homeElo + ELO_CAP, homeElo));
  const cappedEloAway = Math.max(awayElo - ELO_CAP, Math.min(awayElo + ELO_CAP, awayElo));

  const homeEloPts = cappedEloHome * ELO_TO_POINTS;
  const awayEloPts = cappedEloAway * ELO_TO_POINTS;

  const homeOff = (homePPG + awayPPGAllowed) / 2;
  const homeOffWithElo = homeOff + homeEloPts + HOME_COURT_ADVANTAGE;

  const awayOff = (awayPPG + homePPGAllowed) / 2;
  const awayOffWithElo = awayOff + awayEloPts;

  return {
    homeScore: Math.round(homeOffWithElo),
    awayScore: Math.round(awayOffWithElo),
    calc: {
      rawHomeElo: homeElo,
      rawAwayElo: awayElo,
      homeOff: homeOffWithElo,
      awayOff: awayOffWithElo,
    },
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  const regressed = rawSpread * SPREAD_REGRESSION;
  return Math.round(regressed * 2) / 2;
}

function calculateConviction(
  homeTeamAbbr: string,
  awayTeamAbbr: string,
  homeElo: number,
  awayElo: number,
  predictedSpread: number,
  vegasSpread: number | undefined
): { level: 'high' | 'moderate' | 'low'; isHighConviction: boolean; expectedWinPct: number } {
  const eloGap = Math.abs(homeElo - awayElo);
  const eloFavorite = homeElo > awayElo ? 'home' : 'away';

  const vegasFavorite = vegasSpread !== undefined ? (vegasSpread < 0 ? 'home' : 'away') : null;
  const ourPick = predictedSpread < (vegasSpread ?? 0) ? 'home' : 'away';
  const picksVegasFavorite = vegasFavorite !== null && ourPick === vegasFavorite;
  const eloAligned = ourPick === eloFavorite;

  const picksHome = ourPick === 'home';
  const hasEdge = vegasSpread !== undefined && Math.abs(vegasSpread - predictedSpread) >= 2;

  let level: 'high' | 'moderate' | 'low';
  let expectedWinPct: number;

  if (!picksHome) {
    level = 'low';
    expectedWinPct = 52;
  } else if (eloAligned && hasEdge && eloGap > 50) {
    level = 'high';
    expectedWinPct = 60;
  } else if (eloAligned && hasEdge) {
    level = 'high';
    expectedWinPct = 58;
  } else if (eloAligned) {
    level = 'moderate';
    expectedWinPct = 55;
  } else if (picksHome && hasEdge) {
    level = 'moderate';
    expectedWinPct = 54;
  } else {
    level = 'low';
    expectedWinPct = 52;
  }

  return {
    level,
    isHighConviction: level === 'high',
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
        const tier = getConferenceTier(team.conference);
        const initialElo = INITIAL_ELO_BY_TIER[tier];
        teamsMap.set(team.id, {
          id: team.id,
          name: team.name || '',
          abbreviation: team.abbreviation || '',
          eloRating: initialElo,
          ppg: team.ppg,
          ppgAllowed: team.ppgAllowed,
          conference: team.conference,
        });
      }
      log(`Fetched ${teamsMap.size} teams with conference-based Elos`);
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

    // Process completed games for Elo updates
    const sortedCompleted = completedGames
      .filter(g => !processedGameIds.has(g.id))
      .sort((a, b) => new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime());

    log(`Processing ${sortedCompleted.length} new completed games for Elo updates...`);
    for (const game of sortedCompleted) {
      if (!game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      const { homeNewElo, awayNewElo } = updateEloAfterGame(
        { id: game.homeTeamId, eloRating: homeTeam.eloRating } as Team,
        { id: game.awayTeamId, eloRating: awayTeam.eloRating } as Team,
        game.homeScore,
        game.awayScore
      );

      homeTeam.eloRating = homeNewElo;
      awayTeam.eloRating = awayNewElo;
      processedGameIds.add(game.id);
    }

    log(`Elo updates complete. Now generating predictions...`);

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
          confidence: {
            spread: conviction.level,
            moneyline: mlConfidence,
            overUnder: ouConfidence,
          },
          highConviction: conviction.isHighConviction,
          expectedWinPct: conviction.expectedWinPct,
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

    // Calculate backtest
    const finalGames = allGames.filter(g => g.status === 'final');
    const backtestResults = [];
    let atsWins = 0, atsLosses = 0, atsPushes = 0;
    let mlWins = 0, mlLosses = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;

    for (const gameWithPred of gamesWithPredictions) {
      const { game, prediction } = gameWithPred;
      if (game.status !== 'final') continue;

      const actualSpread = game.awayScore - game.homeScore;
      const actualTotal = game.homeScore + game.awayScore;
      const homeWon = game.homeScore > game.awayScore;

      const predictedHomeWin = prediction.homeWinProbability > 50;
      const mlResult = predictedHomeWin === homeWon ? 'win' : 'loss';
      if (mlResult === 'win') mlWins++;
      else mlLosses++;

      if (prediction.vegasSpread !== undefined) {
        const vegasPredictedSpread = actualSpread - prediction.vegasSpread;
        const ourPredictedSpread = actualSpread - prediction.predictedSpread;
        if (Math.abs(vegasPredictedSpread) < 0.5) {
          atsPushes++;
        } else if ((vegasPredictedSpread > 0 && ourPredictedSpread > 0) || (vegasPredictedSpread < 0 && ourPredictedSpread < 0)) {
          atsWins++;
        } else {
          atsLosses++;
        }
      }

      if (prediction.vegasTotal !== undefined) {
        const vegasPredictedTotal = actualTotal - prediction.vegasTotal;
        const ourPredictedTotal = actualTotal - prediction.predictedTotal;
        if (Math.abs(vegasPredictedTotal) < 0.5) {
          ouPushes++;
        } else if ((vegasPredictedTotal > 0 && ourPredictedTotal > 0) || (vegasPredictedTotal < 0 && ourPredictedTotal < 0)) {
          ouWins++;
        } else {
          ouLosses++;
        }
      }

      backtestResults.push({
        gameId: game.id,
        home: game.home,
        away: game.away,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        predictedSpread: prediction.predictedSpread,
        vegasSpread: prediction.vegasSpread,
        predictedTotal: prediction.predictedTotal,
        vegasTotal: prediction.vegasTotal,
        atsResult: Math.abs(actualSpread - prediction.vegasSpread!) < 0.5 ? 'push' :
                   ((actualSpread - prediction.vegasSpread!) * (actualSpread - prediction.predictedSpread) > 0 ? 'win' : 'loss'),
        mlResult,
        ouResult: Math.abs(actualTotal - prediction.vegasTotal!) < 0.5 ? 'push' :
                  ((actualTotal - prediction.vegasTotal!) * (actualTotal - prediction.predictedTotal) > 0 ? 'win' : 'loss'),
      });
    }

    const atsTotal = atsWins + atsLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    const backtest = {
      summary: {
        totalGames: finalGames.length,
        spread: {
          wins: atsWins,
          losses: atsLosses,
          pushes: atsPushes,
          winPct: atsTotal > 0 ? Math.round((atsWins / atsTotal) * 100) : 0,
        },
        moneyline: {
          wins: mlWins,
          losses: mlLosses,
          winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 100) : 0,
        },
        overUnder: {
          wins: ouWins,
          losses: ouLosses,
          pushes: ouPushes,
          winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 100) : 0,
        },
      },
      results: backtestResults,
    };

    log(`Backtest: ATS ${atsWins}-${atsLosses}-${atsPushes} (${backtest.summary.spread.winPct}%), ML ${mlWins}-${mlLosses} (${backtest.summary.moneyline.winPct}%), O/U ${ouWins}-${ouLosses}-${ouPushes} (${backtest.summary.overUnder.winPct}%)`);

    // Save to Vercel Blob
    const teams = Array.from(teamsMap.values()).map(t => ({
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
      season: currentSeason,
      games: gamesWithPredictions,
      teams,
      backtest,
      historicalOdds,
    };

    const blob = await put('cbb-prediction-data.json', JSON.stringify(blobData), {
      access: 'public',
      contentType: 'application/json',
    });

    log(`Saved to Vercel Blob: ${blob.url}`);

    // Save to Firestore
    const syncTimestamp = new Date().toISOString();

    await setSportState(sport, {
      season: currentSeason,
      processedGameIds: Array.from(processedGameIds),
      lastSyncAt: syncTimestamp,
    });

    const teamDocs = teams.map(team => ({
      id: team.id,
      data: {
        ...team,
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

    await saveDocsBatch(sport, 'teams', teamDocs);
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);

    log('=== CBB Sync Complete ===');

    return NextResponse.json({
      success: true,
      logs,
      stats: {
        teams: teams.length,
        games: gamesWithPredictions.length,
        backtest: backtest.summary,
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
