import { NextResponse } from 'next/server';
import { put, head } from '@vercel/blob';

const ODDS_API_KEY = process.env.NEXT_PUBLIC_ODDS_API_KEY;

interface HistoricalOddsEvent {
  id: string;
  sport_key: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Array<{
    key: string;
    title: string;
    markets: Array<{
      key: string;
      outcomes: Array<{
        name: string;
        price: number;
        point?: number;
      }>;
    }>;
  }>;
}

interface BacktestResult {
  gameId: string;
  gameTime: string;
  week?: number;
  homeTeam: string;
  awayTeam: string;
  predictedSpread: number;
  predictedTotal: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  vegasSpread?: number;
  vegasTotal?: number;
  // Results
  spreadPick: 'home' | 'away';
  spreadResult?: 'win' | 'loss' | 'push';
  atsResult?: 'win' | 'loss' | 'push'; // Against actual Vegas spread
  ouPick?: 'over' | 'under';
  ouResult?: 'win' | 'loss' | 'push'; // Against actual Vegas total
}

async function fetchHistoricalOdds(date: string): Promise<HistoricalOddsEvent[]> {
  if (!ODDS_API_KEY) throw new Error('Odds API key not configured');

  const url = `https://api.the-odds-api.com/v4/historical/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=spreads,totals&date=${date}`;

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Odds API error: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.data || data || [];
}

function getConsensusLine(event: HistoricalOddsEvent): { spread: number; total: number } | null {
  const spreads: number[] = [];
  const totals: number[] = [];

  for (const book of event.bookmakers) {
    const spreadMarket = book.markets.find(m => m.key === 'spreads');
    const totalMarket = book.markets.find(m => m.key === 'totals');

    if (spreadMarket) {
      const homeSpread = spreadMarket.outcomes.find(o => o.name === event.home_team);
      if (homeSpread?.point !== undefined) spreads.push(homeSpread.point);
    }

    if (totalMarket) {
      const over = totalMarket.outcomes.find(o => o.name === 'Over');
      if (over?.point !== undefined) totals.push(over.point);
    }
  }

  if (spreads.length === 0 || totals.length === 0) return null;

  return {
    spread: Math.round((spreads.reduce((a, b) => a + b, 0) / spreads.length) * 2) / 2,
    total: Math.round((totals.reduce((a, b) => a + b, 0) / totals.length) * 2) / 2,
  };
}

export async function GET() {
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    // 1. Fetch existing blob
    log('Fetching existing blob data...');
    const blobInfo = await head('prediction-matrix-data.json');
    if (!blobInfo?.url) {
      return NextResponse.json({ error: 'No blob data found' }, { status: 404 });
    }
    const blobResponse = await fetch(blobInfo.url);
    const blobData = await blobResponse.json();

    const existingResults: BacktestResult[] = blobData.backtest?.results || [];
    log(`Found ${existingResults.length} existing backtest results`);

    if (existingResults.length === 0) {
      return NextResponse.json({ error: 'No backtest results to update' }, { status: 400 });
    }

    // 2. Group games by date to minimize API calls
    const gamesByDate = new Map<string, BacktestResult[]>();
    for (const result of existingResults) {
      const date = new Date(result.gameTime);
      // Round to start of day in ISO format
      const dateKey = date.toISOString().split('T')[0] + 'T12:00:00Z';
      if (!gamesByDate.has(dateKey)) {
        gamesByDate.set(dateKey, []);
      }
      gamesByDate.get(dateKey)!.push(result);
    }

    log(`Games spread across ${gamesByDate.size} dates`);

    // 3. Fetch historical odds for each date and match to games
    let atsWins = 0, atsLosses = 0, atsPushes = 0;
    let ouWins = 0, ouLosses = 0, ouPushes = 0;
    let gamesWithOdds = 0;

    const updatedResults: BacktestResult[] = [];

    for (const [dateKey, games] of gamesByDate) {
      log(`Fetching odds for ${dateKey} (${games.length} games)...`);

      try {
        const historicalEvents = await fetchHistoricalOdds(dateKey);
        log(`Got ${historicalEvents.length} events from API`);

        for (const game of games) {
          // Find matching event
          const matchingEvent = historicalEvents.find(e =>
            (e.home_team.includes(game.homeTeam) || game.homeTeam.includes(e.home_team.split(' ').pop() || '')) &&
            (e.away_team.includes(game.awayTeam) || game.awayTeam.includes(e.away_team.split(' ').pop() || ''))
          );

          if (matchingEvent) {
            const consensus = getConsensusLine(matchingEvent);
            if (consensus) {
              gamesWithOdds++;
              game.vegasSpread = consensus.spread;
              game.vegasTotal = consensus.total;

              // Calculate ATS result
              // If we picked home (predictedSpread < 0) and actual spread < vegas spread, we won
              const vegasSpread = consensus.spread;
              const actualSpread = game.actualSpread; // away - home

              if (game.spreadPick === 'home') {
                // We bet home to cover: home needs to beat the spread
                // actualSpread < vegasSpread means home covered
                if (actualSpread < vegasSpread) {
                  game.atsResult = 'win';
                  atsWins++;
                } else if (actualSpread > vegasSpread) {
                  game.atsResult = 'loss';
                  atsLosses++;
                } else {
                  game.atsResult = 'push';
                  atsPushes++;
                }
              } else {
                // We bet away to cover
                if (actualSpread > vegasSpread) {
                  game.atsResult = 'win';
                  atsWins++;
                } else if (actualSpread < vegasSpread) {
                  game.atsResult = 'loss';
                  atsLosses++;
                } else {
                  game.atsResult = 'push';
                  atsPushes++;
                }
              }

              // Calculate O/U result against Vegas total
              const vegasTotal = consensus.total;
              const actualTotal = game.actualTotal;
              const predictedTotal = game.predictedTotal;
              const pickOver = predictedTotal > vegasTotal;

              game.ouPick = pickOver ? 'over' : 'under';
              if (pickOver) {
                if (actualTotal > vegasTotal) {
                  game.ouResult = 'win';
                  ouWins++;
                } else if (actualTotal < vegasTotal) {
                  game.ouResult = 'loss';
                  ouLosses++;
                } else {
                  game.ouResult = 'push';
                  ouPushes++;
                }
              } else {
                if (actualTotal < vegasTotal) {
                  game.ouResult = 'win';
                  ouWins++;
                } else if (actualTotal > vegasTotal) {
                  game.ouResult = 'loss';
                  ouLosses++;
                } else {
                  game.ouResult = 'push';
                  ouPushes++;
                }
              }
            }
          }

          updatedResults.push(game);
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (err) {
        log(`Error fetching odds for ${dateKey}: ${err instanceof Error ? err.message : 'Unknown'}`);
        // Still add games without odds data
        updatedResults.push(...games);
      }
    }

    // 4. Calculate new summary
    const atsTotal = atsWins + atsLosses;
    const ouTotal = ouWins + ouLosses;

    const newSummary = {
      ...blobData.backtest.summary,
      ats: {
        wins: atsWins,
        losses: atsLosses,
        pushes: atsPushes,
        winPct: atsTotal > 0 ? Math.round((atsWins / atsTotal) * 1000) / 10 : 0,
      },
      ouVsVegas: {
        wins: ouWins,
        losses: ouLosses,
        pushes: ouPushes,
        winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0,
      },
      gamesWithOdds,
    };

    log(`ATS: ${atsWins}-${atsLosses}-${atsPushes} (${newSummary.ats.winPct}%)`);
    log(`O/U vs Vegas: ${ouWins}-${ouLosses}-${ouPushes} (${newSummary.ouVsVegas.winPct}%)`);
    log(`Games with odds: ${gamesWithOdds}/${updatedResults.length}`);

    // 5. Update blob
    const updatedBlobData = {
      ...blobData,
      backtest: {
        summary: newSummary,
        results: updatedResults,
      },
    };

    const blob = await put('prediction-matrix-data.json', JSON.stringify(updatedBlobData), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return NextResponse.json({
      success: true,
      blobUrl: blob.url,
      stats: {
        gamesProcessed: updatedResults.length,
        gamesWithOdds,
        ats: newSummary.ats,
        ouVsVegas: newSummary.ouVsVegas,
      },
      logs,
    });
  } catch (error) {
    console.error('Retest error:', error);
    return NextResponse.json({
      error: 'Retest failed',
      message: error instanceof Error ? error.message : 'Unknown error',
      logs,
    }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
