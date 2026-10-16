'use client';

import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/components/AuthProvider';
import { verifiedLiveOdds } from '@/lib/event-odds';

interface LiveGame {
  id: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  quarter: number;
  clock: string;
  status: 'live' | 'final' | 'scheduled';
  gameTime?: string;
}

interface LiveOdds {
  consensusTotal?: number;
  bookmakers?: { name: string; total: number; overOdds: number; underOdds: number }[];
  lastUpdated?: string;
}

interface GamePrediction {
  gameId: string;
  predictedTotal: number;
  liveOdds?: LiveOdds;
}

const REG_MINUTES = 60;
const QUARTER_MINUTES = 15;
const OT_MINUTES = 10;

function parseClock(clock: string): { minutes: number; seconds: number } | null {
  if (!clock) return null;

  // Handle "MM:SS" format (e.g., "8:39")
  const colonMatch = clock.match(/(\d+):(\d+)/);
  if (colonMatch) {
    const minutes = Number.parseInt(colonMatch[1], 10);
    const seconds = Number.parseInt(colonMatch[2], 10);
    if (Number.isNaN(minutes) || Number.isNaN(seconds)) return null;
    return { minutes, seconds };
  }

  // Handle seconds-only format (e.g., "37.1" when under 1 minute)
  const secondsMatch = clock.match(/^(\d+(?:\.\d+)?)$/);
  if (secondsMatch) {
    const totalSeconds = Number.parseFloat(secondsMatch[1]);
    if (Number.isNaN(totalSeconds)) return null;
    return { minutes: 0, seconds: totalSeconds };
  }

  return null;
}

function getMinutesElapsed(quarter: number, clock: string): number | null {
  const parsed = parseClock(clock);
  if (!parsed || quarter < 1) return null;
  const timeRemaining = parsed.minutes + parsed.seconds / 60;
  if (quarter <= 4) {
    const elapsedInQuarter = Math.max(0, QUARTER_MINUTES - timeRemaining);
    return (quarter - 1) * QUARTER_MINUTES + elapsedInQuarter;
  }
  // Overtime
  const otIndex = quarter - 4;
  const elapsedInOt = Math.max(0, OT_MINUTES - timeRemaining);
  return REG_MINUTES + (otIndex - 1) * OT_MINUTES + elapsedInOt;
}

export default function NFLLiveTrackerPage() {
  const { user } = useAuth();
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [predictions, setPredictions] = useState<Map<string, GamePrediction>>(new Map());

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const fetchLiveScores = async () => {
      try {
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
        const data = await response.json();

        const games: LiveGame[] = data.events?.map((event: any) => {
          const competition = event.competitions?.[0];
          const homeTeam = competition?.competitors?.find((c: any) => c.homeAway === 'home');
          const awayTeam = competition?.competitors?.find((c: any) => c.homeAway === 'away');

          let status: LiveGame['status'] = 'scheduled';
          if (event.status?.type?.state === 'in') status = 'live';
          else if (event.status?.type?.state === 'post') status = 'final';

          return {
            id: event.id,
            away: awayTeam?.team?.abbreviation || 'AWAY',
            home: homeTeam?.team?.abbreviation || 'HOME',
            awayScore: Number.parseInt(awayTeam?.score || '0', 10),
            homeScore: Number.parseInt(homeTeam?.score || '0', 10),
            quarter: event.status?.period || 0,
            clock: event.status?.displayClock || '',
            status,
            gameTime: event.date,
          };
        }) || [];

        const liveOnly = games.filter(game => game.status === 'live');
        setLiveGames(liveOnly);

      } catch (error) {
        console.error('Error fetching live scores:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLiveScores();
    intervalId = setInterval(fetchLiveScores, 30000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const loadPredictions = async () => {
      try {
        const response = await fetch('/prediction-matrix-data.json', { cache: 'no-cache' });
        const data = await response.json();
        if (data?.games) {
          const predMap = new Map<string, GamePrediction>();
          for (const gameEntry of data.games) {
            if (gameEntry.game?.id && gameEntry.prediction) {
              predMap.set(gameEntry.game.id, {
                gameId: gameEntry.game.id,
                predictedTotal: gameEntry.prediction.predictedTotal || 0,
                liveOdds: verifiedLiveOdds(gameEntry.prediction.liveOdds, {
                  sport: 'nfl', home: gameEntry.game.homeTeam?.name,
                  away: gameEntry.game.awayTeam?.name, commence: gameEntry.game.gameTime,
                }),
              });
            }
          }
          setPredictions(predMap);
        }
      } catch (error) {
        console.error('Failed to load predictions:', error);
      }
    };

    loadPredictions();
    // Refresh predictions every 30 seconds to get updated live odds
    const interval = setInterval(loadPredictions, 30000);
    return () => clearInterval(interval);
  }, []);

  const sortedGames = useMemo(() => {
    return [...liveGames].sort((a, b) => a.home.localeCompare(b.home));
  }, [liveGames]);

  return (
    <RequireAuth>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">NFL Live Pace Tracker</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Live pace projection alongside periodically observed market lines. Check the quote time before comparing.
            </p>
          </div>
          <div className="text-xs text-gray-400">
            {loading ? 'Loading…' : `${sortedGames.length} live games`}
          </div>
        </div>

        {sortedGames.length === 0 && !loading && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
            No live NFL games right now.
          </div>
        )}

        <div className="grid gap-3 sm:gap-4">
          {sortedGames.map(game => {
            const totalPoints = game.homeScore + game.awayScore;
            const minutesElapsed = getMinutesElapsed(game.quarter, game.clock);
            const runRate = minutesElapsed ? totalPoints / minutesElapsed : null;
            const projectedTotal = runRate ? runRate * REG_MINUTES : null;

            // Get live odds for this game
            const gamePrediction = predictions.get(game.id);
            const liveOdds = gamePrediction?.liveOdds;
            const liveTotal = liveOdds?.consensusTotal;
            const modelVsMarket = projectedTotal && liveTotal
              ? projectedTotal - liveTotal
              : null;

            return (
              <div
                key={game.id}
                className="border rounded-xl p-3 sm:p-4 bg-white border-gray-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-gray-900 text-sm sm:text-base">
                    {game.away} @ {game.home}
                  </div>
                  <div className="text-xs text-gray-500">
                    Q{game.quarter} {game.clock}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 sm:gap-3 mt-3">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Score</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {game.awayScore}-{game.homeScore}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Elapsed</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {minutesElapsed !== null ? minutesElapsed.toFixed(1) : '--'}m
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Run Rate</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {runRate !== null ? runRate.toFixed(2) : '--'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Proj Total</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {projectedTotal !== null ? projectedTotal.toFixed(1) : '--'}
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-200">
                    <div className="text-[10px] uppercase text-blue-600 font-semibold">Observed O/U</div>
                    <div className="text-sm sm:text-base font-bold text-blue-900">
                      {liveTotal ? liveTotal.toFixed(1) : '--'}
                    </div>
                    <div className="text-[9px] text-blue-500">
                      {liveOdds?.lastUpdated ? `Quotes as of ${new Date(liveOdds.lastUpdated).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })}` : 'No verified quote'}
                    </div>
                  </div>
                  <div className={`rounded-lg p-2 text-center border ${
                    modelVsMarket !== null && Math.abs(modelVsMarket) >= 3
                      ? modelVsMarket > 0
                        ? 'bg-green-50 border-green-200'
                        : 'bg-red-50 border-red-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}>
                    <div className={`text-[10px] uppercase font-semibold ${
                      modelVsMarket !== null && Math.abs(modelVsMarket) >= 3
                        ? modelVsMarket > 0
                          ? 'text-green-600'
                          : 'text-red-600'
                        : 'text-gray-400'
                    }`}>Difference</div>
                    <div className={`text-sm sm:text-base font-bold ${
                      modelVsMarket !== null && Math.abs(modelVsMarket) >= 3
                        ? modelVsMarket > 0
                          ? 'text-green-900'
                          : 'text-red-900'
                        : 'text-gray-900'
                    }`}>
                      {modelVsMarket !== null ? `${modelVsMarket > 0 ? '+' : ''}${modelVsMarket.toFixed(1)}` : '--'}
                    </div>
                    <div className={`text-[9px] ${
                      modelVsMarket !== null && Math.abs(modelVsMarket) >= 3
                        ? modelVsMarket > 0
                          ? 'text-green-500'
                          : 'text-red-500'
                        : 'text-gray-400'
                    }`}>
                      {modelVsMarket !== null && Math.abs(modelVsMarket) >= 3
                        ? modelVsMarket > 0
                          ? 'Model OVER'
                          : 'Model UNDER'
                        : 'No edge'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Proj Final</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {projectedTotal !== null && totalPoints > 0
                        ? `${(projectedTotal * (game.awayScore / totalPoints)).toFixed(0)}-${(projectedTotal * (game.homeScore / totalPoints)).toFixed(0)}`
                        : '--'}
                    </div>
                    <div className="text-[9px] text-gray-400">Pace projection</div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </RequireAuth>
  );
}
