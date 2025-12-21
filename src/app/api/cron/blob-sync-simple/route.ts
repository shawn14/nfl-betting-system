import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';
import { fetchNFLTeams, fetchNFLSchedule, fetchAllCompletedGames } from '@/services/espn';
import { updateEloAfterGame } from '@/services/elo';
import { fetchNFLOdds, getConsensusOdds } from '@/services/odds';
import { fetchWeatherForVenue, getWeatherImpact } from '@/services/weather';
import { Team, Odds, WeatherData } from '@/types';

// Constants - Optimized via simulation (927 parameter combinations tested)
// Previous: ELO_TO_POINTS=0.0593, HOME_FIELD_ADVANTAGE=2.28, SPREAD_REGRESSION=0.55, ELO_CAP=4
// Result: ATS 53.3%, O/U 52.7%
// Optimized: ATS 55.1%, O/U 55.1%
const LEAGUE_AVG_PPG = 22;
const ELO_TO_POINTS = 0.11;        // Was 0.0593 - weight Elo differences more heavily
const HOME_FIELD_ADVANTAGE = 3.25; // Was 2.28 - increase home field impact on totals
const ELO_HOME_ADVANTAGE = 48;
const SPREAD_REGRESSION = 0.45;    // Was 0.55 - less regression toward 0
const ELO_CAP = 0;                 // Was 4 - remove cap on Elo adjustment

// Team name mapping for Odds API matching
const TEAM_NAME_VARIANTS: Record<string, string[]> = {
  'Arizona Cardinals': ['Cardinals', 'Arizona'],
  'Atlanta Falcons': ['Falcons', 'Atlanta'],
  'Baltimore Ravens': ['Ravens', 'Baltimore'],
  'Buffalo Bills': ['Bills', 'Buffalo'],
  'Carolina Panthers': ['Panthers', 'Carolina'],
  'Chicago Bears': ['Bears', 'Chicago'],
  'Cincinnati Bengals': ['Bengals', 'Cincinnati'],
  'Cleveland Browns': ['Browns', 'Cleveland'],
  'Dallas Cowboys': ['Cowboys', 'Dallas'],
  'Denver Broncos': ['Broncos', 'Denver'],
  'Detroit Lions': ['Lions', 'Detroit'],
  'Green Bay Packers': ['Packers', 'Green Bay'],
  'Houston Texans': ['Texans', 'Houston'],
  'Indianapolis Colts': ['Colts', 'Indianapolis'],
  'Jacksonville Jaguars': ['Jaguars', 'Jacksonville'],
  'Kansas City Chiefs': ['Chiefs', 'Kansas City'],
  'Las Vegas Raiders': ['Raiders', 'Las Vegas'],
  'Los Angeles Chargers': ['Chargers', 'LA Chargers'],
  'Los Angeles Rams': ['Rams', 'LA Rams'],
  'Miami Dolphins': ['Dolphins', 'Miami'],
  'Minnesota Vikings': ['Vikings', 'Minnesota'],
  'New England Patriots': ['Patriots', 'New England'],
  'New Orleans Saints': ['Saints', 'New Orleans'],
  'New York Giants': ['Giants', 'NY Giants'],
  'New York Jets': ['Jets', 'NY Jets'],
  'Philadelphia Eagles': ['Eagles', 'Philadelphia'],
  'Pittsburgh Steelers': ['Steelers', 'Pittsburgh'],
  'San Francisco 49ers': ['49ers', 'San Francisco'],
  'Seattle Seahawks': ['Seahawks', 'Seattle'],
  'Tampa Bay Buccaneers': ['Buccaneers', 'Tampa Bay'],
  'Tennessee Titans': ['Titans', 'Tennessee'],
  'Washington Commanders': ['Commanders', 'Washington'],
};

function matchesTeamName(oddsTeamName: string, ourTeamName: string): boolean {
  // Direct match
  if (oddsTeamName === ourTeamName) return true;
  if (oddsTeamName.includes(ourTeamName) || ourTeamName.includes(oddsTeamName)) return true;

  // Check variants
  for (const [fullName, variants] of Object.entries(TEAM_NAME_VARIANTS)) {
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
}

interface CachedWeather {
  data: WeatherData;
  fetchedAt: string;
  gameId: string;
}

interface BlobState {
  generated: string;
  teams: TeamData[];
  processedGameIds: string[];
  historicalOdds: Record<string, HistoricalOdds>; // gameId -> odds (persists across resets)
  weatherCache: Record<string, CachedWeather>; // gameId -> weather (refresh every 6 hours)
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

function predictScore(
  homeElo: number,
  awayElo: number,
  homePPG: number,
  homePPGAllowed: number,
  awayPPG: number,
  awayPPGAllowed: number
) {
  const regress = (stat: number) => stat * 0.7 + LEAGUE_AVG_PPG * 0.3;
  let homeScore = (regress(homePPG) + regress(awayPPGAllowed)) / 2;
  let awayScore = (regress(awayPPG) + regress(homePPGAllowed)) / 2;

  const eloDiff = homeElo - awayElo;
  let eloAdj = (eloDiff * ELO_TO_POINTS) / 2;
  if (ELO_CAP > 0) {
    eloAdj = Math.max(-ELO_CAP / 2, Math.min(ELO_CAP / 2, eloAdj));
  }

  homeScore += eloAdj + HOME_FIELD_ADVANTAGE / 2;
  awayScore -= eloAdj - HOME_FIELD_ADVANTAGE / 2;

  return {
    homeScore: Math.round(homeScore * 10) / 10,
    awayScore: Math.round(awayScore * 10) / 10,
  };
}

function calculateSpread(homeScore: number, awayScore: number): number {
  const rawSpread = awayScore - homeScore;
  return Math.round(rawSpread * (1 - SPREAD_REGRESSION) * 2) / 2;
}

async function fetchExistingBlob(): Promise<BlobState | null> {
  try {
    const blobInfo = await head('prediction-matrix-data.json');
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
    // 1. Always read existing blob to preserve historical odds
    const rawExistingState = await fetchExistingBlob();

    // Preserve historical odds across resets
    const historicalOdds: Record<string, HistoricalOdds> = rawExistingState?.historicalOdds || {};
    log(`Loaded ${Object.keys(historicalOdds).length} historical odds records`);

    // Preserve weather cache (refresh every 6 hours)
    const weatherCache: Record<string, CachedWeather> = rawExistingState?.weatherCache || {};
    const WEATHER_CACHE_HOURS = 6;

    // On reset, ignore processed games but keep odds
    log(forceReset ? 'RESET requested - reprocessing all games with new parameters (preserving Vegas odds)' : 'Checking existing blob state...');
    const existingState = forceReset ? null : rawExistingState;

    const isFirstRun = !existingState || !existingState.processedGameIds?.length;
    log(isFirstRun ? 'First run - will process all games' : `Found ${existingState.processedGameIds.length} processed games`);

    // 2. Build team map from existing state or fresh from ESPN
    const teamsMap = new Map<string, TeamData>();

    if (existingState?.teams?.length && !forceReset) {
      // Use existing Elo ratings (unless reset)
      for (const team of existingState.teams) {
        teamsMap.set(team.id, team);
      }
      log(`Loaded ${teamsMap.size} teams with existing Elos`);
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
      completedGames = (await fetchNFLSchedule()).filter(g => g.status === 'final');
    }

    // Filter to only unprocessed games
    const newGames = completedGames.filter(g => g.id && !processedGameIds.has(g.id));
    log(`Found ${newGames.length} new completed games to process`);

    // Sort chronologically
    newGames.sort((a, b) => new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime());

    // 5. Process new games - update Elos and track results
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

    // 6. Merge backtest results (new + existing)
    const existingResults = existingState?.backtest?.results || [];

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

    const allBacktestResults = [
      ...newBacktestResults,
      ...enrichedExistingResults,
    ];

    // 7. Fetch upcoming games and Vegas odds
    log('Fetching upcoming games...');
    const upcomingGames = await fetchNFLSchedule();
    const upcoming = upcomingGames.filter(g => g.status !== 'final');
    log(`Found ${upcoming.length} upcoming games`);

    // Fetch Vegas odds
    log('Fetching Vegas odds...');
    let oddsMap = new Map<string, Partial<Odds>[]>();
    try {
      oddsMap = await fetchNFLOdds();
      log(`Fetched odds for ${oddsMap.size} games`);
    } catch (err) {
      log(`Failed to fetch odds: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    const gamesWithPredictions = [];
    for (const game of upcoming) {
      if (!game.id || !game.homeTeamId || !game.awayTeamId) continue;
      const homeTeam = teamsMap.get(game.homeTeamId);
      const awayTeam = teamsMap.get(game.awayTeamId);
      if (!homeTeam || !awayTeam) continue;

      // Find matching odds by team names and game time
      let vegasSpread: number | undefined;
      let vegasTotal: number | undefined;
      const gameDate = new Date(game.gameTime || '').toISOString().split('T')[0];

      for (const [key, oddsArray] of oddsMap) {
        // Key format: "homeTeam_awayTeam_timestamp"
        const keyParts = key.split('_');
        const oddsHomeTeam = keyParts[0] || '';
        const oddsAwayTeam = keyParts[1] || '';
        const oddsTime = keyParts.slice(2).join('_'); // Rejoin in case timestamp has underscores
        const oddsDate = oddsTime ? new Date(oddsTime).toISOString().split('T')[0] : '';

        // Match team names AND date
        const teamsMatch = matchesTeamName(oddsHomeTeam, homeTeam.name) && matchesTeamName(oddsAwayTeam, awayTeam.name);
        const dateMatches = !oddsDate || !gameDate || oddsDate === gameDate;

        if (teamsMatch && dateMatches) {
          const consensus = getConsensusOdds(oddsArray);
          if (consensus) {
            vegasSpread = consensus.homeSpread;
            vegasTotal = consensus.total;
            // Store in historical odds for future use (persists across resets)
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

      // Fetch weather (use cache if less than 6 hours old)
      let weather: WeatherData | null = null;
      const cachedWeather = weatherCache[game.id];
      const now = new Date();
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

      const { homeScore: predHome, awayScore: predAway } = predictScore(
        homeTeam.eloRating, awayTeam.eloRating,
        homeTeam.ppg || LEAGUE_AVG_PPG, homeTeam.ppgAllowed || LEAGUE_AVG_PPG,
        awayTeam.ppg || LEAGUE_AVG_PPG, awayTeam.ppgAllowed || LEAGUE_AVG_PPG
      );

      const adjustedHomeElo = homeTeam.eloRating + ELO_HOME_ADVANTAGE;
      const homeWinProb = 1 / (1 + Math.pow(10, (awayTeam.eloRating - adjustedHomeElo) / 400));

      const predictedSpread = calculateSpread(predHome, predAway);
      // Apply weather impact to total (bad weather = lower scoring)
      const predictedTotal = (predHome + predAway) - (weatherImpact * 3);

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

      // O/U confidence
      const totalEdge = vegasTotal !== undefined ? Math.abs(predictedTotal - vegasTotal) : 0;
      let ouConfidence: 'high' | 'medium' | 'low' = 'medium';
      if (totalEdge >= 4) ouConfidence = 'high';
      else if (totalEdge >= 2) ouConfidence = 'medium';
      else ouConfidence = 'low';

      // Best bet = has 60%+ factors and NOT medium spread
      const isAtsBestBet = sixtyPlusFactors >= 1 && !isMediumSpread;
      const isOuBestBet = totalEdge >= 4;

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
          spreadEdge: vegasSpread !== undefined ? Math.round((predictedSpread - vegasSpread) * 2) / 2 : undefined,
          totalEdge: vegasTotal !== undefined ? Math.round((predictedTotal - vegasTotal) * 2) / 2 : undefined,
          atsConfidence,
          ouConfidence,
          isAtsBestBet,
          isOuBestBet,
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
          } : null,
          weatherImpact,
        },
      });
    }

    // Log weather stats
    const gamesWithWeather = gamesWithPredictions.filter((g: any) => g.prediction.weather).length;
    log(`Weather data: ${gamesWithWeather}/${gamesWithPredictions.length} games`);

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
      weatherCache, // Persists weather data (refresh every 6 hours)
      games: gamesWithPredictions.sort((a, b) =>
        new Date(a.game.gameTime || 0).getTime() - new Date(b.game.gameTime || 0).getTime()
      ),
      recentGames: allBacktestResults.slice(0, 10).map((r: any) => ({
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
        results: allBacktestResults,
      },
    };

    // 9. Upload
    const jsonString = JSON.stringify(blobData);
    log(`Uploading to blob... (${Math.round(jsonString.length / 1024)}KB)`);

    const blob = await put('prediction-matrix-data.json', jsonString, {
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
