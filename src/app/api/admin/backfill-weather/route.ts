import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';

// Using Open-Meteo Archive API (free, no API key required)
const OPEN_METEO_ARCHIVE_BASE = 'https://archive-api.open-meteo.com/v1/archive';

// NFL stadium coordinates
const NFL_STADIUMS: Record<string, { lat: number; lon: number; indoor: boolean }> = {
  'Arrowhead Stadium': { lat: 39.0489, lon: -94.4839, indoor: false },
  'Highmark Stadium': { lat: 42.7738, lon: -78.7870, indoor: false },
  'Empower Field at Mile High': { lat: 39.7439, lon: -105.0201, indoor: false },
  'FirstEnergy Stadium': { lat: 41.5061, lon: -81.6995, indoor: false },
  'Huntington Bank Field': { lat: 41.5061, lon: -81.6995, indoor: false },
  'Gillette Stadium': { lat: 42.0909, lon: -71.2643, indoor: false },
  'Hard Rock Stadium': { lat: 25.9580, lon: -80.2389, indoor: false },
  'Lumen Field': { lat: 47.5952, lon: -122.3316, indoor: false },
  'M&T Bank Stadium': { lat: 39.2780, lon: -76.6227, indoor: false },
  'MetLife Stadium': { lat: 40.8128, lon: -74.0742, indoor: false },
  'Nissan Stadium': { lat: 36.1665, lon: -86.7713, indoor: false },
  'Paycor Stadium': { lat: 39.0955, lon: -84.5160, indoor: false },
  'Raymond James Stadium': { lat: 27.9759, lon: -82.5033, indoor: false },
  'Soldier Field': { lat: 41.8623, lon: -87.6167, indoor: false },
  'TIAA Bank Field': { lat: 30.3239, lon: -81.6373, indoor: false },
  'EverBank Stadium': { lat: 30.3239, lon: -81.6373, indoor: false },
  'Levi\'s Stadium': { lat: 37.4033, lon: -121.9694, indoor: false },
  'Lambeau Field': { lat: 44.5013, lon: -88.0622, indoor: false },
  'Lincoln Financial Field': { lat: 39.9008, lon: -75.1675, indoor: false },
  'Acrisure Stadium': { lat: 40.4468, lon: -80.0158, indoor: false },
  'FedExField': { lat: 38.9076, lon: -76.8645, indoor: false },
  'Northwest Stadium': { lat: 38.9076, lon: -76.8645, indoor: false },
  'Bank of America Stadium': { lat: 35.2258, lon: -80.8528, indoor: false },
  // Indoor stadiums
  'SoFi Stadium': { lat: 33.9535, lon: -118.3392, indoor: true },
  'AT&T Stadium': { lat: 32.7473, lon: -97.0945, indoor: true },
  'Caesars Superdome': { lat: 29.9511, lon: -90.0812, indoor: true },
  'Ford Field': { lat: 42.3400, lon: -83.0456, indoor: true },
  'Lucas Oil Stadium': { lat: 39.7601, lon: -86.1639, indoor: true },
  'Mercedes-Benz Stadium': { lat: 33.7554, lon: -84.4010, indoor: true },
  'State Farm Stadium': { lat: 33.5276, lon: -112.2626, indoor: true },
  'U.S. Bank Stadium': { lat: 44.9736, lon: -93.2575, indoor: true },
  'Allegiant Stadium': { lat: 36.0909, lon: -115.1833, indoor: true },
  'NRG Stadium': { lat: 29.6847, lon: -95.4107, indoor: true },
};

// Team to home stadium mapping
const TEAM_STADIUMS: Record<string, string> = {
  'ARI': 'State Farm Stadium',
  'ATL': 'Mercedes-Benz Stadium',
  'BAL': 'M&T Bank Stadium',
  'BUF': 'Highmark Stadium',
  'CAR': 'Bank of America Stadium',
  'CHI': 'Soldier Field',
  'CIN': 'Paycor Stadium',
  'CLE': 'Huntington Bank Field',
  'DAL': 'AT&T Stadium',
  'DEN': 'Empower Field at Mile High',
  'DET': 'Ford Field',
  'GB': 'Lambeau Field',
  'HOU': 'NRG Stadium',
  'IND': 'Lucas Oil Stadium',
  'JAX': 'EverBank Stadium',
  'KC': 'Arrowhead Stadium',
  'LAC': 'SoFi Stadium',
  'LAR': 'SoFi Stadium',
  'LV': 'Allegiant Stadium',
  'MIA': 'Hard Rock Stadium',
  'MIN': 'U.S. Bank Stadium',
  'NE': 'Gillette Stadium',
  'NO': 'Caesars Superdome',
  'NYG': 'MetLife Stadium',
  'NYJ': 'MetLife Stadium',
  'PHI': 'Lincoln Financial Field',
  'PIT': 'Acrisure Stadium',
  'SEA': 'Lumen Field',
  'SF': 'Levi\'s Stadium',
  'TB': 'Raymond James Stadium',
  'TEN': 'Nissan Stadium',
  'WAS': 'Northwest Stadium',
  'WSH': 'Northwest Stadium',
};

interface HistoricalWeather {
  temperature: number;
  windSpeed: number;
  precipitation: number;
  conditions: string;
  humidity: number;
}

// Weather code to condition description mapping
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

async function fetchHistoricalWeather(
  lat: number,
  lon: number,
  gameTime: Date
): Promise<HistoricalWeather | null> {
  // Format date as YYYY-MM-DD for Open-Meteo
  const dateStr = gameTime.toISOString().split('T')[0];

  // Get timezone based on longitude (rough approximation for US)
  const timezone = lon < -100 ? 'America/Denver' :
                   lon < -85 ? 'America/Chicago' :
                   'America/New_York';

  const url = `${OPEN_METEO_ARCHIVE_BASE}?latitude=${lat}&longitude=${lon}&start_date=${dateStr}&end_date=${dateStr}&hourly=temperature_2m,precipitation,wind_speed_10m,relative_humidity_2m,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=${timezone}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Open-Meteo API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (!data.hourly || !data.hourly.time || data.hourly.time.length === 0) {
      return null;
    }

    // Find the hour closest to game time
    const gameHour = gameTime.getHours();
    const hourIndex = Math.min(gameHour, data.hourly.time.length - 1);

    const temperature = data.hourly.temperature_2m?.[hourIndex];
    const windSpeed = data.hourly.wind_speed_10m?.[hourIndex];
    const precipitation = data.hourly.precipitation?.[hourIndex];
    const humidity = data.hourly.relative_humidity_2m?.[hourIndex];
    const weatherCode = data.hourly.weather_code?.[hourIndex];

    return {
      temperature: Math.round(temperature ?? 72),
      windSpeed: Math.round(windSpeed ?? 0),
      precipitation: precipitation ?? 0,
      conditions: WEATHER_CODES[weatherCode] || 'Unknown',
      humidity: humidity ?? 50,
    };
  } catch (error) {
    console.error('Weather fetch error:', error);
    return null;
  }
}

function calculateWeatherImpact(weather: HistoricalWeather | null, isIndoor: boolean): number {
  if (!weather || isIndoor) return 0;

  let impact = 0;

  // Wind impact
  if (weather.windSpeed > 15) impact += 0.5;
  if (weather.windSpeed > 25) impact += 1.0;

  // Temperature impact
  if (weather.temperature < 32) impact += 0.5;
  if (weather.temperature < 20) impact += 0.5;
  if (weather.temperature < 10) impact += 0.5;

  // Precipitation impact
  if (weather.precipitation > 0) impact += 0.5;
  if (weather.precipitation > 0.1) impact += 0.5;

  return impact;
}

interface BacktestResult {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  week: number;
  gameTime: string;
  predictedTotal: number;
  actualTotal: number;
  vegasTotal?: number;
  ouVegasResult?: string;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? parseInt(limitParam) : 50; // Increased limit since Open-Meteo is free

  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    // 1. Read existing blob
    log('Reading blob data...');
    const blobInfo = await head('prediction-matrix-data.json');
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'No blob data found' }, { status: 404 });
    }

    const response = await fetch(blobInfo.url);
    const blobData = await response.json();

    const results: BacktestResult[] = blobData.backtest?.results || [];
    const historicalWeather: Record<string, HistoricalWeather & { isIndoor: boolean; impact: number }> =
      blobData.historicalWeather || {};

    log(`Found ${results.length} backtest results, ${Object.keys(historicalWeather).length} already have weather`);

    // 2. Find games that need weather data
    const gamesNeedingWeather = results.filter(r =>
      !historicalWeather[r.gameId] &&
      r.gameTime &&
      r.homeTeam
    ).slice(0, limit);

    log(`Fetching weather for ${gamesNeedingWeather.length} games...`);

    let fetchedCount = 0;
    let indoorCount = 0;
    let outdoorCount = 0;

    for (const game of gamesNeedingWeather) {
      const stadiumName = TEAM_STADIUMS[game.homeTeam];
      const stadium = stadiumName ? NFL_STADIUMS[stadiumName] : null;

      if (!stadium) {
        log(`  Unknown stadium for ${game.homeTeam}`);
        continue;
      }

      if (stadium.indoor) {
        // Indoor - no weather impact
        historicalWeather[game.gameId] = {
          temperature: 72,
          windSpeed: 0,
          precipitation: 0,
          conditions: 'Indoor',
          humidity: 50,
          isIndoor: true,
          impact: 0,
        };
        indoorCount++;
        fetchedCount++;
        continue;
      }

      // Fetch historical weather for outdoor games using Open-Meteo
      const gameTime = new Date(game.gameTime);
      const weather = await fetchHistoricalWeather(stadium.lat, stadium.lon, gameTime);

      if (weather) {
        const impact = calculateWeatherImpact(weather, false);
        historicalWeather[game.gameId] = {
          ...weather,
          isIndoor: false,
          impact,
        };
        outdoorCount++;
        fetchedCount++;

        if (impact > 0) {
          log(`  ${game.awayTeam}@${game.homeTeam} Wk${game.week}: ${weather.temperature}°F, ${weather.windSpeed}mph wind, impact=${impact}`);
        }
      }

      // Small delay to be respectful to Open-Meteo's free API
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    log(`Fetched ${fetchedCount} weather records (${indoorCount} indoor, ${outdoorCount} outdoor)`);

    // 3. Calculate what-if O/U results with weather adjustment
    let originalWins = 0, originalLosses = 0;
    let adjustedWins = 0, adjustedLosses = 0;
    let gamesWithWeatherAndOdds = 0;

    for (const game of results) {
      if (!game.vegasTotal || !game.ouVegasResult) continue;

      const weather = historicalWeather[game.gameId];

      // Original result
      if (game.ouVegasResult === 'win') originalWins++;
      else if (game.ouVegasResult === 'loss') originalLosses++;

      if (!weather) continue;
      gamesWithWeatherAndOdds++;

      // Adjusted prediction (multiplier 3 based on optimization - best win rate)
      const adjustedTotal = game.predictedTotal - (weather.impact * 3);
      const originalPick = game.predictedTotal > game.vegasTotal ? 'over' : 'under';
      const adjustedPick = adjustedTotal > game.vegasTotal ? 'over' : 'under';

      // Calculate adjusted result
      let adjustedResult: string;
      if (adjustedPick === 'over') {
        adjustedResult = game.actualTotal > game.vegasTotal ? 'win' :
                        game.actualTotal < game.vegasTotal ? 'loss' : 'push';
      } else {
        adjustedResult = game.actualTotal < game.vegasTotal ? 'win' :
                        game.actualTotal > game.vegasTotal ? 'loss' : 'push';
      }

      if (adjustedResult === 'win') adjustedWins++;
      else if (adjustedResult === 'loss') adjustedLosses++;
    }

    // 4. Save updated blob with historical weather
    blobData.historicalWeather = historicalWeather;
    blobData.generated = new Date().toISOString();

    const jsonString = JSON.stringify(blobData);
    log(`Uploading updated blob (${Math.round(jsonString.length / 1024)}KB)...`);

    await put('prediction-matrix-data.json', jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    const originalPct = originalWins + originalLosses > 0
      ? Math.round((originalWins / (originalWins + originalLosses)) * 1000) / 10
      : 0;
    const adjustedPct = adjustedWins + adjustedLosses > 0
      ? Math.round((adjustedWins / (adjustedWins + adjustedLosses)) * 1000) / 10
      : 0;

    log('Done!');

    return NextResponse.json({
      success: true,
      stats: {
        totalGames: results.length,
        gamesWithWeather: Object.keys(historicalWeather).length,
        newWeatherFetched: fetchedCount,
        indoorGames: indoorCount,
        outdoorGames: outdoorCount,
      },
      ouComparison: {
        gamesWithWeatherAndOdds,
        original: { wins: originalWins, losses: originalLosses, pct: originalPct },
        withWeatherAdj: { wins: adjustedWins, losses: adjustedLosses, pct: adjustedPct },
        improvement: Math.round((adjustedPct - originalPct) * 10) / 10,
      },
      logs,
    });
  } catch (error) {
    console.error('Backfill weather error:', error);
    return NextResponse.json({
      error: 'Failed to backfill weather',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
