'use client';

import { useState, useEffect, useCallback } from 'react';

interface Team {
  id: string;
  name: string;
  abbreviation: string;
  eloRating: number;
}

interface Game {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeam?: Team;
  awayTeam?: Team;
  homeScore?: number;
  awayScore?: number;
  gameTime: string;
  status: string;
  week?: number;
}

interface Prediction {
  gameId: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProbability: number;
  confidence: number;
  vegasSpread?: number;
  vegasTotal?: number;
  edgeSpread?: number;
  edgeTotal?: number;
}

interface GameWithPrediction {
  game: Game;
  prediction: Prediction;
}

export default function Dashboard() {
  const [games, setGames] = useState<GameWithPrediction[]>([]);
  const [recentGames, setRecentGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      // Fetch all data from pre-computed blob (instant!)
      const response = await fetch('/prediction-data.json', { cache: 'no-cache' });
      const data = await response.json();

      if (data.error && !data.games?.length) {
        // Blob not synced yet, trigger sync
        console.log('Blob not synced, triggering sync...');
        return false;
      }

      setGames(data.games || []);
      setRecentGames(data.recentGames || []);
      return true;
    } catch (error) {
      console.error('Error fetching data:', error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAll = useCallback(async () => {
    setSyncing(true);
    try {
      // Trigger blob sync which does everything in one call
      await fetch('/api/cron/blob-sync');
      await fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  useEffect(() => {
    const init = async () => {
      const hasData = await fetchData();
      if (!hasData) {
        await syncAll();
      }
    };
    init();
  }, []);

  const formatTime = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  const formatSpread = (spread: number) => {
    if (spread > 0) return `+${spread}`;
    return spread.toString();
  };

  const getLogoUrl = (abbr: string) => {
    return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;
  };

  if (loading || syncing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 text-sm">{syncing ? 'Syncing data...' : 'Loading...'}</p>
      </div>
    );
  }

  const formatDay = (date: string) => {
    const d = new Date(date);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="space-y-6">
      {/* Recent Scores - ESPN Style Scoreboard */}
      {recentGames.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Recent Scores</h2>
            <a href="/results" className="text-sm text-emerald-600 hover:text-emerald-700 font-medium">
              View All →
            </a>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
            {recentGames.map((game) => {
              const away = game.awayTeam?.abbreviation || 'AWAY';
              const home = game.homeTeam?.abbreviation || 'HOME';
              const awayWon = (game.awayScore || 0) > (game.homeScore || 0);
              const homeWon = (game.homeScore || 0) > (game.awayScore || 0);

              return (
                <div
                  key={game.id}
                  className="flex-shrink-0 bg-white rounded-lg p-3 min-w-[180px] border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Status badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                      {formatDay(game.gameTime)}
                    </span>
                    <span className="text-[10px] font-bold text-white bg-gray-800 px-1.5 py-0.5 rounded">
                      FINAL
                    </span>
                  </div>

                  {/* Away Team */}
                  <div className={`flex items-center justify-between py-1.5 ${awayWon ? 'text-gray-900' : 'text-gray-400'}`}>
                    <div className="flex items-center gap-2">
                      <img src={getLogoUrl(away)} alt={away} className="w-6 h-6 object-contain" />
                      <span className={`text-sm ${awayWon ? 'font-bold' : 'font-medium'}`}>{away}</span>
                    </div>
                    <span className={`text-lg font-mono ${awayWon ? 'font-bold' : ''}`}>
                      {game.awayScore}
                    </span>
                  </div>

                  {/* Home Team */}
                  <div className={`flex items-center justify-between py-1.5 border-t border-gray-100 ${homeWon ? 'text-gray-900' : 'text-gray-400'}`}>
                    <div className="flex items-center gap-2">
                      <img src={getLogoUrl(home)} alt={home} className="w-6 h-6 object-contain" />
                      <span className={`text-sm ${homeWon ? 'font-bold' : 'font-medium'}`}>{home}</span>
                    </div>
                    <span className={`text-lg font-mono ${homeWon ? 'font-bold' : ''}`}>
                      {game.homeScore}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Upcoming Picks Header */}
      <div className="flex justify-between items-center border-b border-gray-200 pb-3">
        <h1 className="text-xl font-bold text-gray-900">This Week's Picks</h1>
        <button
          onClick={syncAll}
          disabled={syncing}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
        >
          Refresh Data
        </button>
      </div>

      {games.length === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center text-gray-500 border border-gray-200">
          No upcoming games. Check back later.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {games.map(({ game, prediction }) => {
            const away = game.awayTeam?.abbreviation || 'AWAY';
            const home = game.homeTeam?.abbreviation || 'HOME';
            const vegasSpread = prediction.vegasSpread;
            const vegasTotal = prediction.vegasTotal;
            const ourSpread = prediction.predictedSpread;
            const ourTotal = prediction.predictedTotal;
            const homeWinProb = prediction.homeWinProbability;

            // Determine picks based on edge
            const spreadEdge = vegasSpread !== undefined ? vegasSpread - ourSpread : 0;
            const totalEdge = vegasTotal !== undefined ? ourTotal - vegasTotal : 0;

            // Spread pick: positive edge means home covers, negative means away covers
            const pickHomeSpread = spreadEdge > 0;
            const spreadStrong = Math.abs(spreadEdge) >= 2.5;

            // ML pick: based on win probability
            const pickHomeML = homeWinProb > 0.5;
            const mlStrong = homeWinProb > 0.6 || homeWinProb < 0.4;

            // O/U pick: positive edge means over
            const pickOver = totalEdge > 0;
            const ouStrong = Math.abs(totalEdge) >= 2.5;

            return (
              <div key={game.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                {/* Game header */}
                <a href={`/game/${game.id}`} className="group block p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <img src={getLogoUrl(away)} alt={away} className="w-10 h-10 object-contain" />
                        <span className="font-bold text-gray-900">{away}</span>
                      </div>
                      <span className="text-gray-400 text-sm">@</span>
                      <div className="flex items-center gap-2">
                        <img src={getLogoUrl(home)} alt={home} className="w-10 h-10 object-contain" />
                        <span className="font-bold text-gray-900">{home}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-mono text-lg font-bold text-gray-900">{Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}</div>
                        <div className="text-xs text-gray-500">{formatTime(game.gameTime)}</div>
                      </div>
                      <div className="flex items-center text-gray-400 group-hover:text-emerald-500 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </a>

                {/* Picks grid */}
                <div className="grid grid-cols-3 divide-x divide-gray-100">
                  {/* Spread */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">Spread</div>
                    {vegasSpread !== undefined ? (
                      <div className="flex flex-col gap-1.5">
                        <div
                          className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-sm font-medium ${
                            !pickHomeSpread
                              ? spreadStrong
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <img src={getLogoUrl(away)} alt="" className="w-4 h-4 object-contain" />
                            <span>{away}</span>
                          </div>
                          <span className="font-mono">{formatSpread(-vegasSpread)}</span>
                        </div>
                        <div
                          className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-sm font-medium ${
                            pickHomeSpread
                              ? spreadStrong
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <img src={getLogoUrl(home)} alt="" className="w-4 h-4 object-contain" />
                            <span>{home}</span>
                          </div>
                          <span className="font-mono">{formatSpread(vegasSpread)}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-300 text-center py-4">—</div>
                    )}
                  </div>

                  {/* Moneyline */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">Moneyline</div>
                    <div className="flex flex-col gap-1.5">
                      <div
                        className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium ${
                          !pickHomeML
                            ? mlStrong
                              ? 'bg-emerald-500 text-white'
                              : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        <img src={getLogoUrl(away)} alt="" className="w-4 h-4 object-contain" />
                        <span>{away}</span>
                      </div>
                      <div
                        className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium ${
                          pickHomeML
                            ? mlStrong
                              ? 'bg-emerald-500 text-white'
                              : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        <img src={getLogoUrl(home)} alt="" className="w-4 h-4 object-contain" />
                        <span>{home}</span>
                      </div>
                    </div>
                  </div>

                  {/* Over/Under */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">Total</div>
                    {vegasTotal !== undefined ? (
                      <div className="flex flex-col gap-1.5">
                        <div
                          className={`px-2 py-1.5 rounded-lg text-sm font-medium text-center ${
                            pickOver
                              ? ouStrong
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          O {vegasTotal}
                        </div>
                        <div
                          className={`px-2 py-1.5 rounded-lg text-sm font-medium text-center ${
                            !pickOver
                              ? ouStrong
                                ? 'bg-emerald-500 text-white'
                                : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200'
                              : 'bg-gray-50 text-gray-500'
                          }`}
                        >
                          U {vegasTotal}
                        </div>
                      </div>
                    ) : (
                      <div className="text-gray-300 text-center py-4">—</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
