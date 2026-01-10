'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

interface LiveGameWithSnapshot extends LiveGame {
  snapshotTime: number; // timestamp when this data was received
  snapshotElapsed: number | null; // minutes elapsed at snapshot time
}

interface LiveOdds {
  consensusTotal?: number;
  consensusOverOdds?: number;
  consensusUnderOdds?: number;
  bookmakers?: { name: string; total: number; overOdds: number; underOdds: number }[];
  lastUpdated?: string;
}

interface GamePrediction {
  gameId: string;
  predictedTotal: number;
  liveOdds?: LiveOdds;
}

interface CalibrationData {
  seasonYear: number;
  leagueAvgQuarter: number[];
  teamAvgQuarter: Record<string, number[]>;
  gapMultipliers: Record<string, Record<string, { avg: number; samples: number }>>;
}

interface BlobPrediction {
  id: string;
  vegasTotal?: number;
  vegasSpread?: number;
}

const REG_MINUTES = 48;
const QUARTER_MINUTES = 12;
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
  if (period <= 4) {
    const elapsedInPeriod = Math.max(0, QUARTER_MINUTES - timeRemaining);
    return (period - 1) * QUARTER_MINUTES + elapsedInPeriod;
  }
  const otIndex = period - 4;
  const elapsedInOt = Math.max(0, OT_MINUTES - timeRemaining);
  return REG_MINUTES + (otIndex - 1) * OT_MINUTES + elapsedInOt;
}

// Track high/low projections and max edges for each game
interface ProjectionRange {
  high: number;
  low: number;
  highTime: number; // timestamp when high was recorded
  lowTime: number;  // timestamp when low was recorded
  maxOuEdge: number | null;
  maxOuEdgeTime: number | null;
  maxSpreadEdge: number | null;
  maxSpreadEdgeTime: number | null;
}

export default function NBALiveTrackerPage() {
  const [liveGames, setLiveGames] = useState<LiveGameWithSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [calibration, setCalibration] = useState<CalibrationData | null>(null);
  const [predictions, setPredictions] = useState<Map<string, GamePrediction>>(new Map());
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // Force re-renders for live updates
  const [vegasOdds, setVegasOdds] = useState<Record<string, { total?: number; spread?: number }>>({});
  const [liveOddsInput, setLiveOddsInput] = useState<Record<string, string>>({});
  const [liveSpreadInput, setLiveSpreadInput] = useState<Record<string, string>>({});

  // Track high/low projections per game (persists across renders)
  const projectionRangesRef = useRef<Record<string, ProjectionRange>>({});

  // Ref to track if we're currently fetching (to avoid showing stale "seconds ago")
  const isFetchingRef = useRef(false);

  // Helper to update projection range for a game
  const updateProjectionRange = useCallback((gameId: string, projectedTotal: number, ouEdge?: number | null, spreadEdge?: number | null) => {
    const now = Date.now();
    const existing = projectionRangesRef.current[gameId];

    if (!existing) {
      // First projection for this game
      projectionRangesRef.current[gameId] = {
        high: projectedTotal,
        low: projectedTotal,
        highTime: now,
        lowTime: now,
        maxOuEdge: ouEdge ?? null,
        maxOuEdgeTime: ouEdge !== null && ouEdge !== undefined ? now : null,
        maxSpreadEdge: spreadEdge ?? null,
        maxSpreadEdgeTime: spreadEdge !== null && spreadEdge !== undefined ? now : null,
      };
    } else {
      let updated = { ...existing };

      // Update high/low if needed
      if (projectedTotal > existing.high) {
        updated.high = projectedTotal;
        updated.highTime = now;
      }
      if (projectedTotal < existing.low) {
        updated.low = projectedTotal;
        updated.lowTime = now;
      }

      // Update max O/U edge (track absolute max)
      if (ouEdge !== null && ouEdge !== undefined) {
        if (existing.maxOuEdge === null || Math.abs(ouEdge) > Math.abs(existing.maxOuEdge)) {
          updated.maxOuEdge = ouEdge;
          updated.maxOuEdgeTime = now;
        }
      }

      // Update max spread edge (track absolute max)
      if (spreadEdge !== null && spreadEdge !== undefined) {
        if (existing.maxSpreadEdge === null || Math.abs(spreadEdge) > Math.abs(existing.maxSpreadEdge)) {
          updated.maxSpreadEdge = spreadEdge;
          updated.maxSpreadEdgeTime = now;
        }
      }

      projectionRangesRef.current[gameId] = updated;
    }
  }, []);

  // Get projection range for a game
  const getProjectionRange = useCallback((gameId: string): ProjectionRange | null => {
    return projectionRangesRef.current[gameId] || null;
  }, []);

  // Fast tick interval for live updates (every 100ms for smooth counting)
  useEffect(() => {
    const tickInterval = setInterval(() => {
      setTick(t => t + 1);
    }, 100);
    return () => clearInterval(tickInterval);
  }, []);

  // Calculate interpolated elapsed time for a game
  const getInterpolatedElapsed = useCallback((game: LiveGameWithSnapshot): number | null => {
    if (game.snapshotElapsed === null) return null;
    const now = Date.now();
    const secondsSinceSnapshot = (now - game.snapshotTime) / 1000;
    const minutesSinceSnapshot = secondsSinceSnapshot / 60;
    // Add elapsed real time to the snapshot elapsed time
    // Cap at 48 minutes for regulation (don't extrapolate past end of game)
    const interpolated = game.snapshotElapsed + minutesSinceSnapshot;
    // For OT, extend the cap
    const maxMinutes = game.period > 4 ? REG_MINUTES + (game.period - 4) * OT_MINUTES : REG_MINUTES;
    return Math.min(interpolated, maxMinutes);
  }, []);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    const fetchLiveScores = async () => {
      isFetchingRef.current = true;
      try {
        const fetchTime = Date.now();
        const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard');
        const data = await response.json();

        const games: LiveGameWithSnapshot[] = data.events?.map((event: any) => {
          const competition = event.competitions?.[0];
          const homeTeam = competition?.competitors?.find((c: any) => c.homeAway === 'home');
          const awayTeam = competition?.competitors?.find((c: any) => c.homeAway === 'away');

          let status: LiveGame['status'] = 'scheduled';
          if (event.status?.type?.state === 'in') status = 'live';
          else if (event.status?.type?.state === 'post') status = 'final';

          const period = event.status?.period || 0;
          const clock = event.status?.displayClock || '';
          const snapshotElapsed = getMinutesElapsed(period, clock);

          return {
            id: event.id,
            away: awayTeam?.team?.abbreviation || 'AWAY',
            home: homeTeam?.team?.abbreviation || 'HOME',
            awayScore: Number.parseInt(awayTeam?.score || '0', 10),
            homeScore: Number.parseInt(homeTeam?.score || '0', 10),
            period,
            clock,
            status,
            gameTime: event.date,
            snapshotTime: fetchTime,
            snapshotElapsed,
          };
        }) || [];

        const liveOnly = games.filter(game => game.status === 'live');
        setLiveGames(liveOnly);
        setLastFetchTime(fetchTime);

      } catch (error) {
        console.error('Error fetching live scores:', error);
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    };

    fetchLiveScores();
    intervalId = setInterval(fetchLiveScores, 30000);

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const loadCalibration = async () => {
      try {
        const response = await fetch('/nba-pace-calibration.json', { cache: 'no-cache' });
        const data = await response.json();
        if (data?.teamAvgQuarter) {
          setCalibration(data);
        }
      } catch (error) {
        setCalibration(null);
      }
    };

    loadCalibration();
  }, []);

  useEffect(() => {
    const loadPredictions = async () => {
      try {
        const response = await fetch('/nba-prediction-data.json', { cache: 'no-cache' });
        const data = await response.json();
        if (data?.games) {
          const predMap = new Map<string, GamePrediction>();
          for (const gameEntry of data.games) {
            if (gameEntry.game?.id && gameEntry.prediction) {
              predMap.set(gameEntry.game.id, {
                gameId: gameEntry.game.id,
                predictedTotal: gameEntry.prediction.predictedTotal || 0,
                liveOdds: gameEntry.prediction.liveOdds,
              });
            }
          }
          setPredictions(predMap);
        }

        // Also load Vegas odds
        if (data?.predictions) {
          const oddsMap: Record<string, { total?: number; spread?: number }> = {};
          for (const pred of data.predictions) {
            if (pred.id) {
              oddsMap[pred.id] = {
                total: pred.vegasTotal,
                spread: pred.vegasSpread,
              };
            }
          }
          setVegasOdds(oddsMap);
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

  // Calculate seconds since last fetch for display
  const secondsSinceUpdate = lastFetchTime ? Math.floor((Date.now() - lastFetchTime) / 1000) : null;

  return (
    <RequireAuth>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
        <div className="flex items-center justify-between border-b border-gray-200 pb-3">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">NBA Live Pace Tracker</h1>
            <p className="text-xs sm:text-sm text-gray-500 mt-1">
              Live pace projection vs market odds - compare model estimates with real-time betting lines.
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-400">
              {loading ? 'Loading…' : `${sortedGames.length} live games`}
            </div>
            {secondsSinceUpdate !== null && (
              <div className="text-xs text-gray-500 flex items-center justify-end gap-1 mt-0.5">
                <span className={`inline-block w-2 h-2 rounded-full ${secondsSinceUpdate < 5 ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                Updated {secondsSinceUpdate}s ago
              </div>
            )}
          </div>
        </div>

        {sortedGames.length === 0 && !loading && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-sm text-gray-500">
            No live NBA games right now.
          </div>
        )}

        <div className="grid gap-3 sm:gap-4">
          {sortedGames.map(game => {
            const totalPoints = game.homeScore + game.awayScore;
            // Use interpolated elapsed time for live updates
            const minutesElapsed = getInterpolatedElapsed(game);
            const runRate = minutesElapsed && minutesElapsed > 0 ? totalPoints / minutesElapsed : null;
            const rawProjectedTotal = runRate ? runRate * REG_MINUTES : null;
            let calibratedProjectedTotal = rawProjectedTotal;
            let projectedHome: number | null = null;
            let projectedAway: number | null = null;

            // Get live odds for this game
            const gamePrediction = predictions.get(game.id);
            const liveOdds = gamePrediction?.liveOdds;
            const liveTotal = liveOdds?.consensusTotal;
            const modelVsMarket = calibratedProjectedTotal && liveTotal
              ? calibratedProjectedTotal - liveTotal
              : null;

            // Calculate interpolated time remaining for calibration
            const interpolatedTimeRemaining = minutesElapsed !== null
              ? (game.period <= 4 ? REG_MINUTES - minutesElapsed : 0)
              : null;

            if (calibration && minutesElapsed !== null && game.period <= 4 && interpolatedTimeRemaining !== null && interpolatedTimeRemaining > 0) {
              const homeAvg = calibration.teamAvgQuarter[game.home];
              const awayAvg = calibration.teamAvgQuarter[game.away];
              if (homeAvg && awayAvg) {
                // Calculate which quarter we're in based on interpolated time
                const currentQuarter = Math.min(4, Math.floor(minutesElapsed / QUARTER_MINUTES) + 1);
                const minutesIntoQuarter = minutesElapsed % QUARTER_MINUTES;
                const quarterIndex = currentQuarter - 1;
                const quarterTimeRemaining = QUARTER_MINUTES - minutesIntoQuarter;

                const homeRemaining = homeAvg
                  .slice(quarterIndex + 1)
                  .reduce((sum, val) => sum + val, 0) + homeAvg[quarterIndex] * (quarterTimeRemaining / QUARTER_MINUTES);
                const awayRemaining = awayAvg
                  .slice(quarterIndex + 1)
                  .reduce((sum, val) => sum + val, 0) + awayAvg[quarterIndex] * (quarterTimeRemaining / QUARTER_MINUTES);
                const expectedRemaining = homeRemaining + awayRemaining;

                const gap = Math.abs(game.homeScore - game.awayScore);
                const gapKey = gap <= 4 ? 'close' : gap <= 9 ? 'small' : gap <= 14 ? 'medium' : 'large';
                const checkpoint = currentQuarter <= 1 ? 'Q1' : currentQuarter <= 2 ? 'HALF' : 'Q3';
                const multiplier = calibration.gapMultipliers?.[checkpoint]?.[gapKey]?.avg ?? 1;

                if (expectedRemaining > 0) {
                  calibratedProjectedTotal = totalPoints + expectedRemaining * multiplier;
                  projectedHome = game.homeScore + homeRemaining * multiplier;
                  projectedAway = game.awayScore + awayRemaining * multiplier;
                }
              }
            }

            // Calculate per-game seconds since snapshot
            const gameSinceUpdate = Math.floor((Date.now() - game.snapshotTime) / 1000);

            // Get Vegas O/U from our blob storage (pre-game line)
            const gameVegas = vegasOdds[game.id];
            const pregameTotal = gameVegas?.total;
            const pregameSpread = gameVegas?.spread;

            // Get user-entered live O/U
            const liveOddsValue = liveOddsInput[game.id];
            const liveTotal = liveOddsValue ? parseFloat(liveOddsValue) : null;
            const hasLiveOdds = liveTotal !== null && !isNaN(liveTotal);

            // Get user-entered live spread (positive = home favored)
            const liveSpreadValue = liveSpreadInput[game.id];
            const liveSpread = liveSpreadValue ? parseFloat(liveSpreadValue) : null;
            const hasLiveSpread = liveSpread !== null && !isNaN(liveSpread);

            // Calculate projected spread (home margin)
            // Using calibrated projection if available, otherwise raw
            const projectedHomeScore = projectedHome ?? (calibratedProjectedTotal !== null && totalPoints > 0
              ? calibratedProjectedTotal * (game.homeScore / totalPoints)
              : null);
            const projectedAwayScore = projectedAway ?? (calibratedProjectedTotal !== null && totalPoints > 0
              ? calibratedProjectedTotal * (game.awayScore / totalPoints)
              : null);
            const projectedSpread = projectedHomeScore !== null && projectedAwayScore !== null
              ? projectedAwayScore - projectedHomeScore // negative = home favored
              : null;

            // Calculate edges
            const pregameEdge = pregameTotal !== undefined && rawProjectedTotal !== null
              ? rawProjectedTotal - pregameTotal
              : null;
            const liveEdge = hasLiveOdds && rawProjectedTotal !== null
              ? rawProjectedTotal - liveTotal
              : null;
            const liveSpreadEdge = hasLiveSpread && projectedSpread !== null
              ? liveSpread - projectedSpread
              : null;

            // Update high/low tracking for this game's projection (including edges)
            if (rawProjectedTotal !== null) {
              updateProjectionRange(game.id, rawProjectedTotal, liveEdge, liveSpreadEdge);
            }
            const projectionRange = getProjectionRange(game.id);

            return (
              <div
                key={game.id}
                className={`border rounded-xl p-3 sm:p-4 bg-white ${
                  'border-gray-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-gray-900 text-sm sm:text-base">
                      {game.away} @ {game.home}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-3">
                      {pregameTotal !== undefined && (
                        <span>
                          O/U: <span className="font-medium text-gray-600">{pregameTotal}</span>
                        </span>
                      )}
                      {pregameSpread !== undefined && (
                        <span>
                          Sprd: <span className="font-medium text-gray-600">{pregameSpread > 0 ? '+' : ''}{pregameSpread}</span>
                        </span>
                      )}
                      {projectedSpread !== null && (
                        <span>
                          Proj: <span className="font-medium text-gray-600">{projectedSpread > 0 ? '+' : ''}{projectedSpread.toFixed(1)}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-xs text-gray-500">
                      Q{game.period} {game.clock}
                    </div>
                    <div className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      {gameSinceUpdate}s ago
                    </div>
                  </div>
                </div>

                {/* Live O/U and Spread Inputs */}
                <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Live O/U Input */}
                  <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Live O/U:</label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="219.5"
                      value={liveOddsInput[game.id] || ''}
                      onChange={(e) => setLiveOddsInput(prev => ({ ...prev, [game.id]: e.target.value }))}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tabular-nums"
                    />
                    {hasLiveOdds && liveEdge !== null && (
                      <div className={`flex items-center gap-1 px-2 py-1 rounded font-bold text-xs ${
                        Math.abs(liveEdge) >= 5
                          ? liveEdge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          : Math.abs(liveEdge) >= 3
                          ? liveEdge > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        <span className="tabular-nums">
                          {liveEdge > 0 ? 'O' : 'U'} {Math.abs(liveEdge).toFixed(1)}
                        </span>
                        {Math.abs(liveEdge) >= 5 && <span className="animate-pulse">🔥</span>}
                      </div>
                    )}
                    {projectionRange?.maxOuEdge !== null && projectionRange?.maxOuEdge !== undefined && (
                      <div className="text-[10px] text-gray-400 whitespace-nowrap">
                        Max: <span className={`font-medium ${projectionRange.maxOuEdge > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {projectionRange.maxOuEdge > 0 ? '+' : ''}{projectionRange.maxOuEdge.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Live Spread Input */}
                  <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <label className="text-xs text-gray-500 whitespace-nowrap">Live Sprd:</label>
                    <input
                      type="number"
                      step="0.5"
                      placeholder="-3.5"
                      value={liveSpreadInput[game.id] || ''}
                      onChange={(e) => setLiveSpreadInput(prev => ({ ...prev, [game.id]: e.target.value }))}
                      className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tabular-nums"
                    />
                    {hasLiveSpread && liveSpreadEdge !== null && (
                      <div className={`flex items-center gap-1 px-2 py-1 rounded font-bold text-xs ${
                        Math.abs(liveSpreadEdge) >= 3
                          ? liveSpreadEdge > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          : Math.abs(liveSpreadEdge) >= 1.5
                          ? liveSpreadEdge > 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                          : 'bg-gray-100 text-gray-600'
                      }`}>
                        <span className="tabular-nums">
                          {liveSpreadEdge > 0 ? 'HOME' : 'AWAY'} {Math.abs(liveSpreadEdge).toFixed(1)}
                        </span>
                        {Math.abs(liveSpreadEdge) >= 3 && <span className="animate-pulse">🔥</span>}
                      </div>
                    )}
                    {projectionRange?.maxSpreadEdge !== null && projectionRange?.maxSpreadEdge !== undefined && (
                      <div className="text-[10px] text-gray-400 whitespace-nowrap">
                        Max: <span className={`font-medium ${projectionRange.maxSpreadEdge > 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {projectionRange.maxSpreadEdge > 0 ? '+' : ''}{projectionRange.maxSpreadEdge.toFixed(1)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-8 gap-2 sm:gap-3 mt-3">
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Score</div>
                    <div className="text-sm sm:text-base font-bold text-gray-900">
                      {game.awayScore}-{game.homeScore}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center relative">
                    <div className="text-[10px] uppercase text-gray-400">Elapsed</div>
                    <div className="text-sm sm:text-base font-bold text-green-600 tabular-nums">
                      {minutesElapsed !== null ? minutesElapsed.toFixed(2) : '--'}m
                    </div>
                    <div className="absolute top-0.5 right-1 w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Run Rate</div>
                    <div className="text-sm sm:text-base font-bold text-green-600 tabular-nums">
                      {runRate !== null ? runRate.toFixed(3) : '--'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Proj Total</div>
                    <div className="text-sm sm:text-base font-bold text-green-600 tabular-nums">
                      {rawProjectedTotal !== null ? rawProjectedTotal.toFixed(1) : '--'}
                    </div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-2 text-center">
                    <div className="text-[10px] uppercase text-gray-400">Calibrated</div>
                    <div className="text-sm sm:text-base font-bold text-green-600 tabular-nums">
                      {calibratedProjectedTotal !== null ? calibratedProjectedTotal.toFixed(1) : '--'}
                    </div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-2 text-center border border-blue-200">
                    <div className="text-[10px] uppercase text-blue-600 font-semibold">Live O/U</div>
                    <div className="text-sm sm:text-base font-bold text-blue-900">
                      {liveTotal ? liveTotal.toFixed(1) : '--'}
                    </div>
                    <div className="text-[9px] text-blue-500">
                      {liveOdds?.overOdds && liveOdds.overOdds !== -110 ? `O: ${liveOdds.overOdds > 0 ? '+' : ''}${liveOdds.overOdds}` : ''}
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
                    <div className="text-sm sm:text-base font-bold text-green-600 tabular-nums">
                      {projectedHome !== null && projectedAway !== null
                        ? `${projectedAway.toFixed(0)}-${projectedHome.toFixed(0)}`
                        : calibratedProjectedTotal !== null && totalPoints > 0
                        ? `${(calibratedProjectedTotal * (game.awayScore / totalPoints)).toFixed(0)}-${(calibratedProjectedTotal * (game.homeScore / totalPoints)).toFixed(0)}`
                        : '--'}
                    </div>
                    <div className="text-[9px] text-gray-400">Pace projection</div>
                  </div>
                </div>

                {/* High/Low Projection Range */}
                {projectionRange && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase text-gray-400">Session Low:</span>
                          <span className="text-sm font-bold text-red-600 tabular-nums">
                            {projectionRange.low.toFixed(1)}
                          </span>
                          <span className="text-[9px] text-gray-400">
                            ({Math.floor((Date.now() - projectionRange.lowTime) / 1000)}s ago)
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] uppercase text-gray-400">Session High:</span>
                          <span className="text-sm font-bold text-blue-600 tabular-nums">
                            {projectionRange.high.toFixed(1)}
                          </span>
                          <span className="text-[9px] text-gray-400">
                            ({Math.floor((Date.now() - projectionRange.highTime) / 1000)}s ago)
                          </span>
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        Range: <span className="font-medium text-gray-600">{(projectionRange.high - projectionRange.low).toFixed(1)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </RequireAuth>
  );
}
