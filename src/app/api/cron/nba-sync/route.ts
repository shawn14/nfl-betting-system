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

// NBA Constants - Optimized via backtesting (178 games, 56.6% ATS, 59.9% O/U)
const LEAGUE_AVG_PPG = 112;          // NBA average ~112 PPG
const ELO_TO_POINTS = 0.04;          // Optimized - 100 Elo = 4 points
const HOME_COURT_ADVANTAGE = 3.0;    // Optimized - NBA home court
const ELO_HOME_ADVANTAGE = 48;       // Same Elo bonus structure
const SPREAD_REGRESSION = 0.55;      // Optimized - 55% regression to mean
const ELO_CAP = 20;                  // Optimized


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
  lockedAt?: string;
}

interface BlobState {
  generated: string;
  teams: TeamData[];
  processedGameIds: string[];
  historicalOdds: Record<string, HistoricalOdds>;
  games: unknown[];
  recentGames: unknown[];
  backtest: {
    summary: {
      totalGames: number;
      spread: { wins: number; losses: number; pushes: number; winPct: number };
      moneyline: { wins: number; losses: number; winPct: number };
      overUnder: { wins: number; losses: number; pushes: number; winPct: number };
    };
    results: unknown[];
  };
}

// ESPN NBA API functions
async function fetchNBATeams(): Promise<any[]> {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
    const data = await response.json();

    // Also fetch standings for PPG stats
    const standingsRes = await fetch('https://site.api.espn.com/apis/v2/sports/basketball/nba/standings');
    const standingsData = await standingsRes.json();

    // Build map of team stats from standings
    const teamStats = new Map<string, { ppg: number; ppgAllowed: number }>();
    for (const conf of standingsData.children || []) {
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
            ppg: stats.avgPointsFor || stats.pointsFor / gamesPlayed || LEAGUE_AVG_PPG,
            ppgAllowed: stats.avgPointsAgainst || stats.pointsAgainst / gamesPlayed || LEAGUE_AVG_PPG,
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
        abbreviation: team.abbreviation,
        ppg: stats?.ppg || LEAGUE_AVG_PPG,
        ppgAllowed: stats?.ppgAllowed || LEAGUE_AVG_PPG,
      });
    }

    return teams;
  } catch (error) {
    console.error('Failed to fetch NBA teams:', error);
    return [];
  }
}

async function fetchNBASchedule(): Promise<any[]> {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard');
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
        homeScore: status === 'final' || status === 'in_progress' ? parseInt(homeTeam.score || '0') : undefined,
        awayScore: status === 'final' || status === 'in_progress' ? parseInt(awayTeam.score || '0') : undefined,
        gameTime: event.date,
        status,
        venue: competition.venue?.fullName,
        season: event.season?.year,
      });
    }

    return games;
  } catch (error) {
    console.error('Failed to fetch NBA schedule:', error);
    return [];
  }
}

// Fetch all completed NBA games for the season (for Elo calculation)
async function fetchAllCompletedNBAGames(log: (msg: string) => void): Promise<any[]> {
  const allGames: any[] = [];

  // NBA 2024-25 season started October 22, 2024
  const seasonStart = new Date('2024-10-22');
  const today = new Date();

  // Fetch day by day (ESPN NBA API supports date parameter)
  let currentDate = new Date(seasonStart);
  let daysProcessed = 0;

  while (currentDate <= today) {
    const dateStr = currentDate.toISOString().split('T')[0].replace(/-/g, '');

    try {
      const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dateStr}`;
      const response = await fetch(url);
      const data = await response.json();

      for (const event of data.events || []) {
        // Only include completed games
        if (event.status?.type?.name !== 'STATUS_FINAL') continue;

        const competition = event.competitions?.[0];
        if (!competition) continue;

        const homeTeam = competition.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition.competitors?.find((c: any) => c.homeAway === 'away');

        if (!homeTeam || !awayTeam) continue;

        allGames.push({
          id: event.id,
          homeTeamId: homeTeam.team?.id,
          awayTeamId: awayTeam.team?.id,
          homeScore: parseInt(homeTeam.score || '0'),
          awayScore: parseInt(awayTeam.score || '0'),
          gameTime: event.date,
          status: 'final',
          venue: competition.venue?.fullName,
          season: event.season?.year,
        });
      }

      daysProcessed++;
      if (daysProcessed % 10 === 0) {
        log(`Processed ${daysProcessed} days, found ${allGames.length} games...`);
      }
    } catch (error) {
      console.error(`Error fetching ${dateStr}:`, error);
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  log(`Fetched ${allGames.length} total completed NBA games`);

  // Sort chronologically
  return allGames.sort((a, b) =>
    new Date(a.gameTime).getTime() - new Date(b.gameTime).getTime()
  );
}

// Fetch odds from ESPN's FREE odds API (no API key needed!)
async function fetchESPNOdds(eventId: string): Promise<{ homeSpread: number; total: number; homeML?: number; awayML?: number } | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/${eventId}/competitions/${eventId}/odds`;
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

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;

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

  const homeScore = baseHomeScore + eloAdj + HOME_COURT_ADVANTAGE / 2;
  const awayScore = baseAwayScore - eloAdj + HOME_COURT_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
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
      homeCourtAdv: HOME_COURT_ADVANTAGE,
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
    log('Starting NBA sync...');

    const sport: SportKey = 'nba';
    const rawState = await getSportState(sport);

    // Fetch current schedule early to detect season changes
    const currentSchedule = await fetchNBASchedule();
    const currentSeason = currentSchedule[0]?.season || rawState?.season || new Date().getFullYear();

    const seasonChanged = rawState?.season && rawState.season !== currentSeason;
    const shouldReset = forceReset || seasonChanged;

    if (seasonChanged) {
      log(`Season changed (${rawState?.season} -> ${currentSeason}) - resetting state`);
    }

    log(shouldReset ? 'RESET requested - reprocessing all games' : 'Loading Firestore state...');
    const existingState = shouldReset ? null : rawState;

    const historicalOdds: Record<string, HistoricalOdds> = shouldReset
      ? {}
      : await getDocsMap<HistoricalOdds>(sport, 'oddsLocks');
    log(`Loaded ${Object.keys(historicalOdds).length} historical odds records`);

    const isFirstRun = !existingState || !existingState.processedGameIds?.length;
    const processedCount = existingState?.processedGameIds?.length || 0;
    log(isFirstRun ? 'First run - will initialize teams' : `Found ${processedCount} processed games`);

    // 2. Build team map
    const teamsMap = new Map<string, TeamData>();

    const existingTeams = shouldReset ? [] : await getDocsList<TeamData>(sport, 'teams');
    if (existingTeams.length && !shouldReset) {
      for (const team of existingTeams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos from Firestore`);
    } else {
      log('Fetching NBA teams from ESPN...');
      const espnTeams = await fetchNBATeams();
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

    // 3. Get processed game IDs
    const processedGameIds = new Set<string>(existingState?.processedGameIds || []);

    // 4. Fetch games - either full season (first run) or just today
    let allGames: any[];
    let completedGames: any[];

    if (isFirstRun) {
      log('First run - fetching ALL completed NBA games from season start...');
      completedGames = await fetchAllCompletedNBAGames(log);
      // Also fetch today's scheduled games
      const scheduledGames = currentSchedule.filter(g => g.status !== 'final');
      allGames = [...completedGames, ...scheduledGames];
      log(`Found ${completedGames.length} completed games + ${scheduledGames.length} upcoming`);
    } else {
      log('Fetching NBA schedule...');
      allGames = currentSchedule;
      completedGames = allGames.filter(g => g.status === 'final');
      log(`Found ${allGames.length} games (${completedGames.length} completed)`);
    }

    // Filter to only unprocessed games
    const newGames = completedGames.filter(g => g.id && !processedGameIds.has(g.id));
    log(`Found ${newGames.length} new completed games to process`);

    // Sort chronologically
    newGames.sort((a, b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    // 5. Process new games - update Elos
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

      // O/U pick based on NBA average total (~224)
      const ouPickActual: 'over' | 'under' = predictedTotal > 224 ? 'over' : 'under';
      let ouResult: 'win' | 'loss' | 'push';
      if (ouPickActual === 'over') {
        ouResult = actualTotal > 224 ? 'win' : actualTotal < 224 ? 'loss' : 'push';
      } else {
        ouResult = actualTotal < 224 ? 'win' : actualTotal > 224 ? 'loss' : 'push';
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

      processedGameIds.add(game.id);
    }

    log(`Processed ${newGames.length} new games. Spread: ${spreadWins}-${spreadLosses}`);

    // 6. Merge backtest results
    const existingResults = shouldReset
      ? []
      : (await getDocsList<any>(sport, 'results')).map(r => ({
        ...r,
        gameId: r.gameId || r.id,
      }));
    const seenGameIds = new Set<string>();
    const allBacktestResults = [
      ...newBacktestResults,
      ...existingResults,
    ].filter((r: any) => {
      if (seenGameIds.has(r.gameId)) return false;
      seenGameIds.add(r.gameId);
      return true;
    });

    // 7. Generate predictions for all current games (fetch odds inline via ESPN FREE API)
    const upcomingGames = allGames.filter(g => g.status !== 'final');
    const gamesWithPredictions = [];
    let oddsFetched = 0;

    for (const game of allGames) {
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

      // Check existing/locked odds
      const existingOdds = historicalOdds[game.id];
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
        // Fetch latest odds from ESPN's FREE API (only for non-final games)
        const espnOdds = await fetchESPNOdds(game.id);
        if (espnOdds) {
          vegasSpread = espnOdds.homeSpread;
          vegasTotal = espnOdds.total;
          oddsFetched++;
          const nowIso = new Date().toISOString();
          // Store in historical odds
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
        }
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

      // Confidence calculations (adapted for NBA)
      const totalEdge = vegasTotal !== undefined ? Math.abs(predictedTotal - vegasTotal) : 0;
      let ouConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (totalEdge >= 5) ouConfidence = 'high';
      else if (totalEdge >= 2) ouConfidence = 'medium';
      else ouConfidence = 'low';

      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;
      let mlConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (mlEdge >= 15) mlConfidence = 'high';
      else if (mlEdge >= 7) mlConfidence = 'medium';
      else mlConfidence = 'low';

      // ATS confidence - lower thresholds for NBA (market is efficient)
      const spreadEdge = vegasSpread !== undefined ? Math.abs(predictedSpread - vegasSpread) : 0;
      let atsConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (spreadEdge >= 2.5) atsConfidence = 'high';
      else if (spreadEdge >= 1) atsConfidence = 'medium';
      else atsConfidence = 'low';

      const isAtsBestBet = spreadEdge >= 2;
      const isOuBestBet = totalEdge >= 5;
      const isMlBestBet = mlEdge >= 15;

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
          spreadEdge: vegasSpread !== undefined ? Math.round((predictedSpread - vegasSpread) * 2) / 2 : undefined,
          totalEdge: vegasTotal !== undefined ? Math.round((predictedTotal - vegasTotal) * 2) / 2 : undefined,
          atsConfidence,
          ouConfidence,
          mlConfidence,
          isAtsBestBet,
          isOuBestBet,
          isMlBestBet,
          mlEdge: Math.round(mlEdge * 10) / 10,
          calc,
        },
      });
    }

    log(`Generated predictions for ${gamesWithPredictions.length} games (fetched ${oddsFetched} odds from ESPN FREE API)`);

    // 9. Build blob data
    const spreadTotal = spreadWins + spreadLosses;
    const mlTotal = mlWins + mlLosses;
    const ouTotal = ouWins + ouLosses;

    const blobData: BlobState = {
      generated: new Date().toISOString(),
      teams: Array.from(teamsMap.values()).sort((a, b) => b.eloRating - a.eloRating),
      processedGameIds: Array.from(processedGameIds),
      historicalOdds,
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
        })),
      backtest: {
        summary: {
          totalGames: processedGameIds.size,
          spread: { wins: spreadWins, losses: spreadLosses, pushes: spreadPushes, winPct: spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0 },
          moneyline: { wins: mlWins, losses: mlLosses, winPct: mlTotal > 0 ? Math.round((mlWins / mlTotal) * 1000) / 10 : 0 },
          overUnder: { wins: ouWins, losses: ouLosses, pushes: ouPushes, winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0 },
        },
        results: allBacktestResults,
      },
    };

    // 10. Persist to Firestore (source of truth)
    const syncTimestamp = new Date().toISOString();

    const teamDocs = Array.from(teamsMap.values()).map(team => ({
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

    await saveDocsBatch(sport, 'teams', teamDocs);
    await saveDocsBatch(sport, 'games', gameDocs);
    await saveDocsBatch(sport, 'predictions', predictionDocs);
    await saveDocsBatch(sport, 'results', resultDocs);
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);

    // 11. Upload
    const jsonString = JSON.stringify(blobData);
    const blobSizeKb = Math.round(jsonString.length / 1024);
    log(`Uploading to blob... (${blobSizeKb}KB)`);

    const blob = await put('nba-prediction-data.json', jsonString, {
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
      processedGameIds: Array.from(processedGameIds),
      backtestSummary: blobData.backtest.summary,
    });

    // Write heartbeat for cron monitoring
    await put('cron-heartbeat-nba.json', JSON.stringify({
      lastRun: new Date().toISOString(),
      route: 'nba-sync',
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
        upcomingGames: upcomingGames.length,
        spreadRecord: `${spreadWins}-${spreadLosses} (${spreadTotal > 0 ? Math.round((spreadWins / spreadTotal) * 1000) / 10 : 0}%)`,
      },
      logs,
    });
  } catch (error) {
    console.error('NBA sync error:', error);
    return NextResponse.json({
      error: 'NBA sync failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
