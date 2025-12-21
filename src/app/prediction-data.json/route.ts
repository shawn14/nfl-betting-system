import { NextResponse } from 'next/server';
import { head } from '@vercel/blob';

export async function GET() {
  try {
    // Check if blob exists
    let blobMetadata;
    try {
      blobMetadata = await head('prediction-matrix-data.json');
    } catch {
      // Blob doesn't exist yet - return empty data
      return NextResponse.json({
        generated: null,
        games: [],
        recentGames: [],
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
        error: 'Data not synced yet. Run /api/cron/blob-sync to generate data.',
      }, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30',
        },
      });
    }

    // Fetch blob data
    const response = await fetch(blobMetadata.url);
    const jsonData = await response.json();

    return NextResponse.json(jsonData, {
      headers: {
        // Cache for 6 hours, serve stale for 10 minutes while revalidating
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=600',
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error fetching blob data:', error);
    return NextResponse.json({
      error: 'Failed to load prediction data',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
