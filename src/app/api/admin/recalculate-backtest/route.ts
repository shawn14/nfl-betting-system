import { NextResponse } from 'next/server';
import { put } from '@vercel/blob';

// Optimal weather multiplier from simulation analysis
const WEATHER_MULTIPLIER = 3;

interface HistoricalWeather {
  temperature: number;
  windSpeed: number;
  precipitation: number;
  conditions: string;
  humidity: number;
  isIndoor: boolean;
  impact: number;
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
  originalPredictedTotal?: number;
  weatherAdjusted?: boolean;
  weatherImpact?: number;
}

export async function GET() {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    // 1. Read existing blob - use direct URL with strong cache-busting
    log('Reading blob data...');
    const BLOB_URL = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com/prediction-matrix-data.json';
    const cacheBuster = `?nocache=${Date.now()}-${Math.random().toString(36).substring(7)}`;

    log(`Fetching: ${BLOB_URL}${cacheBuster}`);
    const response = await fetch(BLOB_URL + cacheBuster, {
      cache: 'no-store',
      next: { revalidate: 0 },
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Failed to fetch blob: ${response.status}` }, { status: 500 });
    }

    const blobData = await response.json();

    const results: BacktestResult[] = blobData.backtest?.results || [];
    const historicalWeather: Record<string, HistoricalWeather> = blobData.historicalWeather || {};

    log(`historicalWeather keys: ${Object.keys(historicalWeather).length}`);

    log(`Found ${results.length} backtest results, ${Object.keys(historicalWeather).length} with weather data`);

    // Abort if no weather data - don't overwrite blob without it
    if (Object.keys(historicalWeather).length === 0) {
      return NextResponse.json({
        error: 'No historical weather data found. Run /api/admin/backfill-weather first.',
        logs,
      }, { status: 400 });
    }

    // 2. Recalculate predictions with weather adjustment
    let adjustedCount = 0;
    let unchangedCount = 0;
    let noWeatherCount = 0;

    // Track O/U stats
    let originalWins = 0, originalLosses = 0, originalPushes = 0;
    let newWins = 0, newLosses = 0, newPushes = 0;
    let flippedPicks = 0;

    for (const game of results) {
      const weather = historicalWeather[game.gameId];

      // Track original stats
      if (game.ouVegasResult === 'win') originalWins++;
      else if (game.ouVegasResult === 'loss') originalLosses++;
      else if (game.ouVegasResult === 'push') originalPushes++;

      if (!weather || weather.isIndoor || weather.impact === 0) {
        noWeatherCount++;
        // Keep original result for games without weather impact
        if (game.ouVegasResult === 'win') newWins++;
        else if (game.ouVegasResult === 'loss') newLosses++;
        else if (game.ouVegasResult === 'push') newPushes++;
        continue;
      }

      // Store original prediction if not already stored
      if (!game.originalPredictedTotal) {
        game.originalPredictedTotal = game.predictedTotal;
      }

      // Calculate weather-adjusted prediction
      const originalTotal = game.originalPredictedTotal;
      const adjustedTotal = originalTotal - (weather.impact * WEATHER_MULTIPLIER);

      // Check if adjustment changes the prediction meaningfully
      if (Math.abs(adjustedTotal - game.predictedTotal) > 0.01) {
        adjustedCount++;
        game.predictedTotal = adjustedTotal;
        game.weatherAdjusted = true;
        game.weatherImpact = weather.impact;
      } else {
        unchangedCount++;
      }

      // Recalculate O/U result with vegas line
      if (game.vegasTotal && game.actualTotal !== undefined) {
        const originalPick = originalTotal > game.vegasTotal ? 'over' : 'under';
        const newPick = adjustedTotal > game.vegasTotal ? 'over' : 'under';

        if (originalPick !== newPick) {
          flippedPicks++;
          log(`  Flipped: ${game.awayTeam}@${game.homeTeam} Wk${game.week} - ${originalPick} → ${newPick} (impact: ${weather.impact})`);
        }

        // Calculate new result
        let newResult: string;
        if (newPick === 'over') {
          newResult = game.actualTotal > game.vegasTotal ? 'win' :
                      game.actualTotal < game.vegasTotal ? 'loss' : 'push';
        } else {
          newResult = game.actualTotal < game.vegasTotal ? 'win' :
                      game.actualTotal > game.vegasTotal ? 'loss' : 'push';
        }

        game.ouVegasResult = newResult;

        if (newResult === 'win') newWins++;
        else if (newResult === 'loss') newLosses++;
        else newPushes++;
      }
    }

    log(`Adjusted ${adjustedCount} predictions, ${unchangedCount} unchanged, ${noWeatherCount} without weather impact`);
    log(`Flipped ${flippedPicks} O/U picks due to weather adjustment`);

    // 3. Update backtest summary stats
    const originalPct = originalWins + originalLosses > 0
      ? Math.round((originalWins / (originalWins + originalLosses)) * 1000) / 10
      : 0;
    const newPct = newWins + newLosses > 0
      ? Math.round((newWins / (newWins + newLosses)) * 1000) / 10
      : 0;

    log(`O/U Results: ${originalWins}-${originalLosses} (${originalPct}%) → ${newWins}-${newLosses} (${newPct}%)`);

    // Update backtest summary
    if (blobData.backtest) {
      blobData.backtest.weatherMultiplier = WEATHER_MULTIPLIER;
      blobData.backtest.weatherRecalculatedAt = new Date().toISOString();

      // Update O/U stats if they exist
      if (blobData.backtest.ouVegas) {
        blobData.backtest.ouVegas.wins = newWins;
        blobData.backtest.ouVegas.losses = newLosses;
        blobData.backtest.ouVegas.pushes = newPushes;
        blobData.backtest.ouVegas.total = newWins + newLosses + newPushes;
        blobData.backtest.ouVegas.pct = newPct;
      }
    }

    // 4. Save updated blob
    blobData.generated = new Date().toISOString();
    const jsonString = JSON.stringify(blobData);
    log(`Uploading updated blob (${Math.round(jsonString.length / 1024)}KB)...`);

    await put('prediction-matrix-data.json', jsonString, {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    log('Done!');

    return NextResponse.json({
      success: true,
      weatherMultiplier: WEATHER_MULTIPLIER,
      stats: {
        totalGames: results.length,
        gamesWithWeather: Object.keys(historicalWeather).length,
        adjustedPredictions: adjustedCount,
        flippedPicks,
      },
      ouComparison: {
        original: { wins: originalWins, losses: originalLosses, pushes: originalPushes, pct: originalPct },
        recalculated: { wins: newWins, losses: newLosses, pushes: newPushes, pct: newPct },
        change: Math.round((newPct - originalPct) * 10) / 10,
      },
      logs,
    });
  } catch (error) {
    console.error('Recalculate backtest error:', error);
    return NextResponse.json({
      error: 'Failed to recalculate backtest',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
