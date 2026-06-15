import { NextResponse } from 'next/server';
import { head } from '@vercel/blob';

export async function GET() {
  try {
    // Check if blob exists
    let blobMetadata;
    try {
      blobMetadata = await head('wnba-prediction-data.json');
    } catch {
      // Blob doesn't exist yet - return empty data
      return NextResponse.json({
        generated: null,
        games: [],
        teams: [],
        backtest: {
          summary: {
            totalGames: 0,
            spread: { wins: 0, losses: 0, pushes: 0, winPct: 0 },
            moneyline: { wins: 0, losses: 0, winPct: 0 },
            overUnder: { wins: 0, losses: 0, pushes: 0, winPct: 0 },
          },
          results: [],
        },
        error: 'Data not synced yet. Run /api/cron/wnba-sync to generate data.',
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      });
    }

    // Fetch blob data with cache busting
    const response = await fetch(`${blobMetadata.url}?t=${Date.now()}`, {
      cache: 'no-store',
    });
    const jsonData = await response.json();

      return NextResponse.json(jsonData, {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'Content-Type': 'application/json',
        },
      });
  } catch (error) {
    console.error('Error fetching WNBA blob data:', error);
    return NextResponse.json({
      error: 'Failed to load WNBA prediction data',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
