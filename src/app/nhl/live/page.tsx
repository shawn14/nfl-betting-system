'use client';

import { useEffect, useMemo, useState } from 'react';
import RequireAuth from '@/components/RequireAuth';

interface LiveGame {
  id: string;
  away: string;
  home: string;
  awayScore: number;
  homeScore: number;
  period: number;
  clock: string;
  status: 'live' | 'final' | 'scheduled';
  gameTime?: string;
}

const REG_MINUTES = 60; // 3 x 20-minute periods
const PERIOD_MINUTES = 20;
const OT_MINUTES = 5;

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

function getMinutesElapsed(period: number, clock: string): number | null {
  const parsed = parseClock(clock);
  if (!parsed || period < 1) return null;
  const timeRemaining = parsed.minutes + parsed.seconds / 60;
  if (period <= 3) {
    const elapsedInPeriod = Math.max(0, PERIOD_MINUTES - timeRemaining);
    return (period - 1) * PERIOD_MINUTES + elapsedInPeriod;
  }
  // OT
  const otIndex = period - 3;
  const elapsedInOt = Math.max(0, OT_MINUTES - timeRemaining);
  return REG_MINUTES + (otIndex - 1) * OT_MINUTES + elapsedInOt;
}

function getPeriodText(period: number): string {
  if (period === 1) return '1st';
  if (period === 2) return '2nd';
  if (period === 3) return '3rd';
  if (period >= 4) return 'OT';
  return '';
}

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nhl/500-dark/${abbr.toLowerCase()}.png`;
};

export default function NHLLiveTrackerPage() {
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const fetchLiveScores = async () => {
      try {
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard');
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
            period: event.status?.period || 0,
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

  const sortedGames = useMemo(() => {
    return [...liveGames].sort((a, b) => a.home.localeCompare(b.home));
  }, [liveGames]);

  return (
    <RequireAuth>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">NHL Live Pace Tracker</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Live run rate vs Vegas total (60-minute projection).
            </p>
          </div>
          <div className="text-xs text-gray-400">
            {loading ? 'Loading...' : `${sortedGames.length} live games`}
          </div>
        </div>

        {sortedGames.length === 0 && !loading && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
            No live NHL games right now.
          </div>
        )}

        <div className="grid gap-3 sm:gap-4">
          {sortedGames.map(game => {
            const totalGoals = game.homeScore + game.awayScore;
            const minutesElapsed = getMinutesElapsed(game.period, game.clock);
            const runRate = minutesElapsed && minutesElapsed >= 1 ? totalGoals / minutesElapsed : null;
            const projectedTotal = runRate ? runRate * REG_MINUTES : null;

            return (
              <div
                key={game.id}
                className="border rounded-xl p-3 sm:p-4 bg-white border-gray-200"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <img src={getLogoUrl(game.away)} alt={game.away} className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
                    <span className="font-semibold text-gray-900 text-sm sm:text-base">{game.away}</span>
                    <span className="text-gray-400 text-sm">@</span>
                    <img src={getLogoUrl(game.home)} alt={game.home} className="w-6 h-6 sm:w-8 sm:h-8 object-contain" />
                    <span className="font-semibold text-gray-900 text-sm sm:text-base">{game.home}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <span className="text-xs font-bold text-blue-600">
                      {getPeriodText(game.period)} {game.clock}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-3 mt-3">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Score</div>
                    <div className="text-lg sm:text-xl font-bold text-gray-900">
                      {game.awayScore}-{game.homeScore}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Total Goals</div>
                    <div className="text-lg sm:text-xl font-bold text-gray-900">
                      {totalGoals}
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
                      <span className="text-[10px] text-gray-400 ml-1">g/min</span>
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-200">
                    <div className="text-[10px] uppercase text-blue-500">Proj Total</div>
                    <div className="text-lg sm:text-xl font-bold text-blue-600">
                      {projectedTotal !== null ? projectedTotal.toFixed(1) : '--'}
                    </div>
                    <div className="text-[9px] text-blue-400">60-min pace</div>
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
