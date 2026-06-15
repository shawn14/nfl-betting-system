import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';
import { saveDocsBatch, getDocsMap } from '@/services/firestore-admin-store';
import { SportKey } from '@/services/firestore-types';

const WNBA_BLOB_NAME = 'wnba-prediction-data.json';
const sport: SportKey = 'wnba';

interface BacktestResult {
  gameId: string;
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
  [key: string]: unknown;
}

interface ESPNOddsResponse {
  items?: Array<{
    spread?: number;
    overUnder?: number;
    details?: string;
  }>;
}

async function fetchESPNOdds(gameId: string): Promise<{ spread: number; total: number } | null> {
  try {
    const url = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/wnba/events/${gameId}/competitions/${gameId}/odds`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return null;

    const data: ESPNOddsResponse = await res.json();
    const odds = data.items?.[0];

    if (odds?.spread !== undefined && odds?.overUnder !== undefined) {
      return {
        spread: odds.spread,
        total: odds.overUnder,
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '200');
  const dryRun = searchParams.get('dryRun') === 'true';

  try {
    // Fetch current blob data using head to get the proper URL
    const blobInfo = await head(WNBA_BLOB_NAME);
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'WNBA blob not found' }, { status: 404 });
    }

    const blobRes = await fetch(blobInfo.url, { cache: 'no-store' });
    if (!blobRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch blob' }, { status: 500 });
    }

    const blobData = await blobRes.json();
    const results: BacktestResult[] = blobData.backtest?.results || [];

    // Find any completed game still missing Vegas odds. Unlike the NBA backfill (which
    // targeted a specific historical season), WNBA starts fresh in this system, so we
    // backfill every game without odds regardless of year.
    const gamesWithoutOdds = results.filter(r => {
      return r.vegasSpread === undefined || r.vegasSpread === null;
    });

    console.log(`Found ${gamesWithoutOdds.length} games without odds, will process up to ${limit}`);

    const toProcess = gamesWithoutOdds.slice(0, limit);
    let updated = 0;
    let failed = 0;
    const updates: Array<{ gameId: string; spread: number; total: number }> = [];

    // Fetch odds for each game
    for (const game of toProcess) {
      const odds = await fetchESPNOdds(game.gameId);

      if (odds) {
        updates.push({ gameId: game.gameId, ...odds });
        updated++;

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        failed++;
      }

      // Log progress every 10 games
      if ((updated + failed) % 10 === 0) {
        console.log(`Progress: ${updated} updated, ${failed} failed out of ${updated + failed}`);
      }
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalWithoutOdds: gamesWithoutOdds.length,
        processed: toProcess.length,
        wouldUpdate: updated,
        failed,
        sample: updates.slice(0, 5),
      });
    }

    // Apply updates to results
    const updatesMap = new Map(updates.map(u => [u.gameId, u]));

    for (const result of results) {
      const update = updatesMap.get(result.gameId);
      if (update) {
        result.vegasSpread = update.spread;
        result.vegasTotal = update.total;

        // Recalculate ATS result
        const predictedSpread = result.predictedSpread;
        const actualSpread = result.actualSpread;
        const pickHome = predictedSpread < update.spread;

        if (pickHome) {
          result.atsResult = actualSpread < update.spread ? 'win' :
                            actualSpread > update.spread ? 'loss' : 'push';
        } else {
          result.atsResult = actualSpread > update.spread ? 'win' :
                            actualSpread < update.spread ? 'loss' : 'push';
        }

        // Recalculate O/U result
        const predictedTotal = result.predictedTotal;
        const actualTotal = result.actualTotal;
        const pickOver = predictedTotal > update.total;

        if (pickOver) {
          result.ouVegasResult = actualTotal > update.total ? 'win' :
                                actualTotal < update.total ? 'loss' : 'push';
        } else {
          result.ouVegasResult = actualTotal < update.total ? 'win' :
                                actualTotal > update.total ? 'loss' : 'push';
        }
      }
    }

    // Also update historicalOdds
    const historicalOdds = blobData.historicalOdds || {};
    for (const update of updates) {
      if (!historicalOdds[update.gameId]) {
        historicalOdds[update.gameId] = {
          vegasSpread: update.spread,
          vegasTotal: update.total,
          openingSpread: update.spread,
          openingTotal: update.total,
          capturedAt: new Date().toISOString(),
          backfilled: true,
        };
      }
    }

    // Update blob
    blobData.backtest.results = results;
    blobData.historicalOdds = historicalOdds;

    await put(WNBA_BLOB_NAME, JSON.stringify(blobData), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    // Save to Firestore oddsLocks so nba-sync picks it up
    const oddsDocs = updates.map(u => ({
      id: u.gameId,
      data: {
        vegasSpread: u.spread,
        vegasTotal: u.total,
        openingSpread: u.spread,
        openingTotal: u.total,
        capturedAt: new Date().toISOString(),
        backfilled: true,
      },
    }));
    await saveDocsBatch(sport, 'oddsLocks', oddsDocs);

    // Count how many now have odds
    const withOddsAfter = results.filter(r => r.vegasSpread !== undefined).length;

    return NextResponse.json({
      success: true,
      totalResults: results.length,
      hadOddsBefore: results.length - gamesWithoutOdds.length,
      processed: toProcess.length,
      updated,
      failed,
      hasOddsNow: withOddsAfter,
      remaining: gamesWithoutOdds.length - updated,
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
