import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';
import { updateEloAfterGame } from '@/services/elo';
import { Team } from '@/types';

// NBA Constants - Optimized via backtesting (178 games, 56.6% ATS, 59.9% O/U)
const LEAGUE_AVG_PPG = 112;          // NBA average ~112 PPG
const ELO_TO_POINTS = 0.04;          // Optimized - 100 Elo = 4 points
const HOME_COURT_ADVANTAGE = 3.0;    // Optimized - NBA home court
const ELO_HOME_ADVANTAGE = 48;       // Same Elo bonus structure
const SPREAD_REGRESSION = 0.55;      // Optimized - 55% regression to mean
const ELO_CAP = 20;                  // Optimized

// NBA Team name mapping for Odds API matching
const NBA_TEAM_NAME_VARIANTS: Record<string, string[]> = {
  'Atlanta Hawks': ['Hawks', 'Atlanta'],
  'Boston Celtics': ['Celtics', 'Boston'],
  'Brooklyn Nets': ['Nets', 'Brooklyn'],
  'Charlotte Hornets': ['Hornets', 'Charlotte'],
  'Chicago Bulls': ['Bulls', 'Chicago'],
  'Cleveland Cavaliers': ['Cavaliers', 'Cleveland', 'Cavs'],
  'Dallas Mavericks': ['Mavericks', 'Dallas', 'Mavs'],
  'Denver Nuggets': ['Nuggets', 'Denver'],
  'Detroit Pistons': ['Pistons', 'Detroit'],
  'Golden State Warriors': ['Warriors', 'Golden State'],
  'Houston Rockets': ['Rockets', 'Houston'],
  'Indiana Pacers': ['Pacers', 'Indiana'],
  'Los Angeles Clippers': ['Clippers', 'LA Clippers'],
  'Los Angeles Lakers': ['Lakers', 'LA Lakers'],
  'Memphis Grizzlies': ['Grizzlies', 'Memphis'],
  'Miami Heat': ['Heat', 'Miami'],
  'Milwaukee Bucks': ['Bucks', 'Milwaukee'],
  'Minnesota Timberwolves': ['Timberwolves', 'Minnesota', 'Wolves'],
  'New Orleans Pelicans': ['Pelicans', 'New Orleans'],
  'New York Knicks': ['Knicks', 'New York'],
  'Oklahoma City Thunder': ['Thunder', 'Oklahoma City', 'OKC'],
  'Orlando Magic': ['Magic', 'Orlando'],
  'Philadelphia 76ers': ['76ers', 'Philadelphia', 'Sixers'],
  'Phoenix Suns': ['Suns', 'Phoenix'],
  'Portland Trail Blazers': ['Trail Blazers', 'Portland', 'Blazers'],
  'Sacramento Kings': ['Kings', 'Sacramento'],
  'San Antonio Spurs': ['Spurs', 'San Antonio'],
  'Toronto Raptors': ['Raptors', 'Toronto'],
  'Utah Jazz': ['Jazz', 'Utah'],
  'Washington Wizards': ['Wizards', 'Washington'],
};

function matchesTeamName(oddsTeamName: string, ourTeamName: string): boolean {
  if (oddsTeamName === ourTeamName) return true;
  if (oddsTeamName.includes(ourTeamName) || ourTeamName.includes(oddsTeamName)) return true;

  for (const [fullName, variants] of Object.entries(NBA_TEAM_NAME_VARIANTS)) {
    if (oddsTeamName.includes(fullName) || fullName === oddsTeamName) {
      if (variants.some(v => ourTeamName.includes(v) || v.includes(ourTeamName))) {
        return true;
      }
    }
  }
  return false;
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

async function fetchNBAOdds(): Promise<Map<string, any[]>> {
  const oddsMap = new Map<string, any[]>();

  try {
    const apiKey = process.env.NEXT_PUBLIC_ODDS_API_KEY;
    if (!apiKey) {
      console.log('No Odds API key configured');
      return oddsMap;
    }

    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals,h2h&oddsFormat=american`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('Odds API error:', response.status);
      return oddsMap;
    }

    const data = await response.json();

    for (const game of data) {
      const key = `${game.home_team}_${game.away_team}_${game.commence_time}`;
      const bookmakers = game.bookmakers || [];

      const oddsArray: any[] = [];
      for (const bookmaker of bookmakers) {
        const spreads = bookmaker.markets?.find((m: any) => m.key === 'spreads');
        const totals = bookmaker.markets?.find((m: any) => m.key === 'totals');
        const h2h = bookmaker.markets?.find((m: any) => m.key === 'h2h');

        if (spreads || totals) {
          const homeSpreadOutcome = spreads?.outcomes?.find((o: any) => o.name === game.home_team);
          const overOutcome = totals?.outcomes?.find((o: any) => o.name === 'Over');

          oddsArray.push({
            bookmaker: bookmaker.key,
            homeSpread: homeSpreadOutcome?.point,
            total: overOutcome?.point,
            homeML: h2h?.outcomes?.find((o: any) => o.name === game.home_team)?.price,
            awayML: h2h?.outcomes?.find((o: any) => o.name === game.away_team)?.price,
          });
        }
      }

      if (oddsArray.length > 0) {
        oddsMap.set(key, oddsArray);
      }
    }

    return oddsMap;
  } catch (error) {
    console.error('Failed to fetch NBA odds:', error);
    return oddsMap;
  }
}

function getConsensusOdds(oddsArray: any[]): { homeSpread: number; total: number } | null {
  const spreads = oddsArray.map(o => o.homeSpread).filter((s): s is number => s !== undefined);
  const totals = oddsArray.map(o => o.total).filter((t): t is number => t !== undefined);

  if (spreads.length === 0 || totals.length === 0) return null;

  return {
    homeSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
    total: totals.reduce((a, b) => a + b, 0) / totals.length,
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

async function fetchExistingBlob(): Promise<BlobState | null> {
  try {
    const blobInfo = await head('nba-prediction-data.json');
    if (!blobInfo?.url) return null;
    const response = await fetch(blobInfo.url);
    return await response.json();
  } catch {
    return null;
  }
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

    // 1. Load existing blob state
    const rawExistingState = await fetchExistingBlob();
    const historicalOdds: Record<string, HistoricalOdds> = rawExistingState?.historicalOdds || {};
    log(`Loaded ${Object.keys(historicalOdds).length} historical odds records`);

    log(forceReset ? 'RESET requested - reprocessing all games' : 'Checking existing blob state...');
    const existingState = forceReset ? null : rawExistingState;

    const isFirstRun = !existingState || !existingState.processedGameIds?.length;
    log(isFirstRun ? 'First run - will initialize teams' : `Found ${existingState.processedGameIds.length} processed games`);

    // 2. Build team map
    const teamsMap = new Map<string, TeamData>();

    if (existingState?.teams?.length && !forceReset) {
      for (const team of existingState.teams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos`);
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
      const todayGames = await fetchNBASchedule();
      const scheduledGames = todayGames.filter(g => g.status !== 'final');
      allGames = [...completedGames, ...scheduledGames];
      log(`Found ${completedGames.length} completed games + ${scheduledGames.length} upcoming`);
    } else {
      log('Fetching NBA schedule...');
      allGames = await fetchNBASchedule();
      completedGames = allGames.filter(g => g.status === 'final');
      log(`Found ${allGames.length} games (${completedGames.length} completed)`);
    }

    // Filter to only unprocessed games
    const newGames = completedGames.filter(g => g.id && !processedGameIds.has(g.id));
    log(`Found ${newGames.length} new completed games to process`);

    // Sort chronologically
    newGames.sort((a, b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    // 5. Process new games - update Elos
    let spreadWins = existingState?.backtest?.summary?.spread?.wins || 0;
    let spreadLosses = existingState?.backtest?.summary?.spread?.losses || 0;
    let spreadPushes = existingState?.backtest?.summary?.spread?.pushes || 0;
    let mlWins = existingState?.backtest?.summary?.moneyline?.wins || 0;
    let mlLosses = existingState?.backtest?.summary?.moneyline?.losses || 0;
    let ouWins = existingState?.backtest?.summary?.overUnder?.wins || 0;
    let ouLosses = existingState?.backtest?.summary?.overUnder?.losses || 0;
    let ouPushes = existingState?.backtest?.summary?.overUnder?.pushes || 0;

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
    const existingResults = existingState?.backtest?.results || [];
    const seenGameIds = new Set<string>();
    const allBacktestResults = [
      ...newBacktestResults,
      ...existingResults,
    ].filter((r: any) => {
      if (seenGameIds.has(r.gameId)) return false;
      seenGameIds.add(r.gameId);
      return true;
    });

    // 7. Fetch Vegas odds only for games that need them
    const upcomingGames = allGames.filter(g => g.status !== 'final');
    const gamesNeedingOdds = upcomingGames.filter(g => {
      if (!g.id) return false;
      const existing = historicalOdds[g.id];
      // Don't need odds if already locked
      if (existing?.lockedAt) return false;
      return true;
    });

    let oddsMap = new Map<string, any[]>();
    if (gamesNeedingOdds.length > 0) {
      log(`Fetching NBA Vegas odds for ${gamesNeedingOdds.length} games that need them...`);
      try {
        oddsMap = await fetchNBAOdds();
        log(`Fetched odds for ${oddsMap.size} games`);
      } catch (err) {
        log(`Failed to fetch odds: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    } else {
      log('All NBA games already have locked odds - skipping odds API call');
    }

    // 8. Generate predictions for all current games
    const gamesWithPredictions = [];

    for (const game of allGames) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      // Find matching odds
      let vegasSpread: number | undefined;
      let vegasTotal: number | undefined;
      const gameDate = new Date(game.gameTime || '').toISOString().split('T')[0];
      const gameTime = new Date(game.gameTime || '');
      const now = new Date();
      const hoursUntilGame = (gameTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Check existing/locked odds
      const existingOdds = historicalOdds[game.id];
      const shouldLockNow = existingOdds && hoursUntilGame <= 1 && !existingOdds.lockedAt;
      const oddsAreLocked = existingOdds?.lockedAt !== undefined;

      if (shouldLockNow) {
        existingOdds.lockedAt = new Date().toISOString();
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
      } else if (oddsAreLocked) {
        vegasSpread = existingOdds.vegasSpread;
        vegasTotal = existingOdds.vegasTotal;
      } else {
        // Fetch latest odds
        for (const [key, oddsArray] of oddsMap) {
          const keyParts = key.split('_');
          const oddsHomeTeam = keyParts[0] || '';
          const oddsAwayTeam = keyParts[1] || '';
          const oddsTime = keyParts.slice(2).join('_');
          const oddsDate = oddsTime ? new Date(oddsTime).toISOString().split('T')[0] : '';

          const teamsMatch = matchesTeamName(oddsHomeTeam, homeTeam.name) && matchesTeamName(oddsAwayTeam, awayTeam.name);
          const dateMatches = !oddsDate || !gameDate || oddsDate === gameDate;

          if (teamsMatch && dateMatches) {
            const consensus = getConsensusOdds(oddsArray);
            if (consensus) {
              vegasSpread = consensus.homeSpread;
              vegasTotal = consensus.total;
              if (vegasSpread !== undefined && vegasTotal !== undefined) {
                historicalOdds[game.id] = {
                  vegasSpread,
                  vegasTotal,
                  capturedAt: new Date().toISOString(),
                };
              }
            }
            break;
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

    log(`Generated predictions for ${gamesWithPredictions.length} games`);

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

    // 10. Upload
    const jsonString = JSON.stringify(blobData);
    log(`Uploading to blob... (${Math.round(jsonString.length / 1024)}KB)`);

    const blob = await put('nba-prediction-data.json', jsonString, {
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
