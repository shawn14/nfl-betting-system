'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { useAuth } from '@/components/AuthProvider';

const PRICE_MONTHLY = 'price_1ShIDiLrg7E2vwVZuULXQybz';
const PRICE_ANNUAL = 'price_1ShIE2Lrg7E2vwVZfmUgjkb7';

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
}

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
  oddsLockedAt?: string;
  lineMovement?: {
    openingSpread?: number;
    openingTotal?: number;
    closingSpread?: number;
    closingTotal?: number;
    lastSeenSpread?: number;
    lastSeenTotal?: number;
    lastUpdatedAt?: string;
  };
  spreadEdge?: number;
  totalEdge?: number;
  atsConfidence?: 'high' | 'medium' | 'low';
  ouConfidence?: 'high' | 'medium' | 'low';
  mlConfidence?: 'high' | 'medium' | 'low';
  isAtsBestBet?: boolean;
  isOuBestBet?: boolean;
  isMlBestBet?: boolean;
  mlEdge?: number;
}

interface GameWithPrediction {
  game: Game;
  prediction: Prediction;
}

interface BacktestResult {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb?: number;
  actualHomeScore: number;
  actualAwayScore: number;
  vegasSpread?: number;
  vegasTotal?: number;
  spreadResult?: 'win' | 'loss' | 'push';
  mlResult?: 'win' | 'loss';
  ouResult?: 'win' | 'loss' | 'push';
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
  gameTime: string;
}

export default function CBBDashboard() {
  const [games, setGames] = useState<GameWithPrediction[]>([]);
  const [recentGames, setRecentGames] = useState<Game[]>([]);
  const [backtestResults, setBacktestResults] = useState<BacktestResult[]>([]);
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showHighConvictionOnly, setShowHighConvictionOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'time' | 'conviction'>('time');
  const scoreboardRef = useRef<HTMLDivElement>(null);
  const { user, isPremium } = useAuth();

  const scrollScoreboard = (direction: 'left' | 'right') => {
    if (scoreboardRef.current) {
      const scrollAmount = 300;
      scoreboardRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const fetchLiveScores = useCallback(async (): Promise<LiveGame[]> => {
    try {
      const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard');
      const data = await response.json();

      const games: LiveGame[] = data.events?.map((event: any) => {
        const competition = event.competitions?.[0];
        const homeTeam = competition?.competitors?.find((c: any) => c.homeAway === 'home');
        const awayTeam = competition?.competitors?.find((c: any) => c.homeAway === 'away');

        let status: 'live' | 'final' | 'scheduled' = 'scheduled';
        if (event.status?.type?.name === 'STATUS_IN_PROGRESS') status = 'live';
        else if (event.status?.type?.name === 'STATUS_FINAL') status = 'final';

        return {
          id: event.id,
          away: awayTeam?.team?.abbreviation || 'AWAY',
          home: homeTeam?.team?.abbreviation || 'HOME',
          awayScore: parseInt(awayTeam?.score || '0'),
          homeScore: parseInt(homeTeam?.score || '0'),
          quarter: event.status?.period || 0,
          clock: event.status?.displayClock || '',
          status,
          gameTime: event.date,
        };
      }) || [];

      setLiveGames(games);
      return games;
    } catch (error) {
      console.error('Error fetching live scores:', error);
      return [];
    }
  }, []);

  const fetchData = useCallback(async () => {
    try {
      // Edge cache handles freshness via s-maxage + stale-while-revalidate
      const response = await fetch('/cbb-prediction-data.json');
      const data = await response.json();

      if (data.error && !data.games?.length) {
        console.log('CBB blob not synced yet');
        return { hasData: false, hasTodayGames: false, totalGames: 0 };
      }

      const uniqueGames = (data.games || []).filter(
        (item: GameWithPrediction, index: number, self: GameWithPrediction[]) =>
          index === self.findIndex((g) => g.game.id === item.game.id)
      );
      const todayKey = new Date().toDateString();
      const hasTodayGames = uniqueGames.some(({ game }: GameWithPrediction) =>
        Boolean(game.gameTime) && new Date(game.gameTime).toDateString() === todayKey
      );
      setGames(uniqueGames);
      const uniqueRecentGames = (data.recentGames || []).filter(
        (game: Game, index: number, self: Game[]) =>
          index === self.findIndex((g) => g.id === game.id)
      );
      setRecentGames(uniqueRecentGames);
      setBacktestResults(data.backtest?.results || []);
      return { hasData: uniqueGames.length > 0, hasTodayGames, totalGames: uniqueGames.length };
    } catch (error) {
      console.error('Error fetching CBB data:', error);
      return { hasData: false, hasTodayGames: false, totalGames: 0 };
    } finally {
      setLoading(false);
    }
  }, []);

  const syncAll = useCallback(async () => {
    setSyncing(true);
    try {
      await fetch('/api/cron/nba-sync');
      await fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const startCheckout = async (priceId: string) => {
    if (!user) return;
    setCheckoutError(null);
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ priceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setCheckoutError(data?.error || 'Unable to start checkout.');
        return;
      }
      if (data?.url) {
        window.location.href = data.url;
      } else {
        setCheckoutError('Unable to start checkout.');
      }
    } catch (error) {
      console.error('Checkout error:', error);
      setCheckoutError('Unable to start checkout.');
    }
  };

  useEffect(() => {
    const init = async () => {
      // Load blob data first (fast, cached at edge)
      const result = await fetchData();
      if (!result.hasData) {
        await syncAll();
      }
      // Fetch live scores in parallel (non-blocking)
      fetchLiveScores();
    };
    init();

    const interval = setInterval(fetchLiveScores, 30000);
    return () => clearInterval(interval);
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
    // Round to nearest 0.5
    const rounded = Math.round(spread * 2) / 2;
    if (rounded > 0) return `+${rounded}`;
    return rounded.toString();
  };

  const getLogoUrl = (abbr: string) => {
    return `https://a.espncdn.com/i/teamlogos/ncaa/500/${abbr.toLowerCase()}.png`;
  };

  if (loading || syncing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-purple-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-gray-500 text-sm">{syncing ? 'Syncing CBB data...' : 'Loading...'}</p>
      </div>
    );
  }

  const formatGameTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getQuarterText = (quarter: number) => {
    if (quarter === 1) return '1st';
    if (quarter === 2) return '2nd';
    if (quarter === 3) return '3rd';
    if (quarter === 4) return '4th';
    if (quarter >= 5) return 'OT';
    return '';
  };

  const liveNow = liveGames.filter(g => g.status === 'live');
  const allTodayGames = [...liveGames].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (a.status !== 'live' && b.status === 'live') return 1;
    if (a.status === 'scheduled' && b.status === 'final') return -1;
    if (a.status === 'final' && b.status === 'scheduled') return 1;
    return new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime();
  });

  // Filter games: upcoming/live + recent final games (last 3 days)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const upcomingGames = games.filter(({ game }) =>
    game.status !== 'final' // includes 'scheduled', 'in_progress', etc.
  );

  // Build recent completed games from backtest results
  const backtestMap = new Map(backtestResults.map(r => [r.gameId, r]));
  const recentCompletedGames: GameWithPrediction[] = recentGames
    .filter(game => new Date(game.gameTime) >= threeDaysAgo)
    .map(game => {
      const result = backtestMap.get(game.id);

      // Calculate confidence values (same logic as nba-sync)
      const predictedSpread = result?.predictedSpread || 0;
      const predictedTotal = result?.predictedTotal || 0;
      const homeWinProb = result?.homeWinProb || 0.5;
      const vegasSpread = result?.vegasSpread;
      const vegasTotal = result?.vegasTotal;

      const spreadEdge = vegasSpread !== undefined ? Math.abs(predictedSpread - vegasSpread) : 0;
      const totalEdge = vegasTotal !== undefined ? Math.abs(predictedTotal - vegasTotal) : 0;
      const mlEdge = Math.abs(homeWinProb - 0.5) * 100;

      const atsConfidence: 'high' | 'medium' | 'low' =
        spreadEdge >= 2.5 ? 'high' : spreadEdge >= 1 ? 'medium' : 'low';
      const ouConfidence: 'high' | 'medium' | 'low' =
        totalEdge >= 5 ? 'high' : totalEdge >= 2 ? 'medium' : 'low';
      const mlConfidence: 'high' | 'medium' | 'low' =
        mlEdge >= 15 ? 'high' : mlEdge >= 7 ? 'medium' : 'low';

      return {
        game: {
          ...game,
          status: 'final',
          homeScore: game.homeScore,
          awayScore: game.awayScore,
        },
        prediction: {
          gameId: game.id,
          predictedHomeScore: result?.predictedHomeScore || 0,
          predictedAwayScore: result?.predictedAwayScore || 0,
          predictedSpread,
          predictedTotal,
          homeWinProbability: homeWinProb,
          confidence: 0.5,
          vegasSpread,
          vegasTotal,
          atsConfidence,
          ouConfidence,
          mlConfidence,
        },
      };
    });

  const displayGames = [...upcomingGames, ...recentCompletedGames];

  return (
    <RequireAuth>
      <div className="space-y-6">
      {/* Live Scoreboard */}
      {allTodayGames.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {liveNow.length > 0 && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                  </span>
                  <span className="text-xs font-bold text-purple-600">{liveNow.length} LIVE</span>
                  <span className="text-gray-300">|</span>
                </>
              )}
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Today's Games</h2>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => scrollScoreboard('left')}
                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                aria-label="Scroll left"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={() => scrollScoreboard('right')}
                className="p-1.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                aria-label="Scroll right"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          <div ref={scoreboardRef} className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-snap-x">
            {allTodayGames.map((game) => {
              const awayWinning = game.awayScore > game.homeScore;
              const homeWinning = game.homeScore > game.awayScore;
              const isLive = game.status === 'live';
              const isFinal = game.status === 'final';

              return (
                <div
                  key={game.id}
                  className={`flex-shrink-0 bg-white rounded-lg px-3 py-2 min-w-[140px] border shadow-sm ${
                    isLive ? 'border-purple-300 bg-purple-50/30' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    {isLive ? (
                      <span className="text-[9px] font-bold text-purple-600">
                        {getQuarterText(game.quarter)} {game.clock}
                      </span>
                    ) : isFinal ? (
                      <span className="text-[9px] font-bold text-gray-500">FINAL</span>
                    ) : (
                      <span className="text-[9px] font-medium text-gray-400">
                        {game.gameTime ? formatGameTime(game.gameTime) : 'TBD'}
                      </span>
                    )}
                    {isLive && (
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-purple-500"></span>
                      </span>
                    )}
                  </div>

                  <div className={`flex items-center justify-between text-xs ${
                    isFinal ? (awayWinning ? 'text-gray-900' : 'text-gray-400') :
                    isLive ? (awayWinning ? 'text-gray-900 font-semibold' : 'text-gray-600') : 'text-gray-700'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <img src={getLogoUrl(game.away)} alt={game.away} className="w-4 h-4 object-contain" />
                      <span>{game.away}</span>
                    </div>
                    <span className="font-mono font-medium">{isLive || isFinal ? game.awayScore : ''}</span>
                  </div>
                  <div className={`flex items-center justify-between text-xs mt-0.5 ${
                    isFinal ? (homeWinning ? 'text-gray-900' : 'text-gray-400') :
                    isLive ? (homeWinning ? 'text-gray-900 font-semibold' : 'text-gray-600') : 'text-gray-700'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <img src={getLogoUrl(game.home)} alt={game.home} className="w-4 h-4 object-contain" />
                      <span>{game.home}</span>
                    </div>
                    <span className="font-mono font-medium">{isLive || isFinal ? game.homeScore : ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Picks Header */}
      <div className="flex flex-col gap-3 border-b border-gray-200 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-bold text-gray-900">CBB Picks</h1>
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-600 rounded"></span> Strong</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded"></span> Lean</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-300 rounded"></span> Avoid</span>
        </div>
      </div>

      {!isPremium && (
        <div className="bg-gray-900 text-white rounded-xl px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-semibold">Unlock the full slate + confidence signals</div>
            <div className="text-xs text-gray-300">Premium members see every game, best bets, and consensus adjustments.</div>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => startCheckout(PRICE_MONTHLY)}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-white text-gray-900 hover:bg-gray-100"
              >
                $20 / month
              </button>
              <button
                onClick={() => startCheckout(PRICE_ANNUAL)}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-white/40 hover:border-white"
              >
                $200 / year
              </button>
            </div>
            {checkoutError && (
              <div className="text-xs text-red-200">{checkoutError}</div>
            )}
          </div>
        </div>
      )}

      {/* Filter Controls */}
      {displayGames.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            onClick={() => setShowHighConvictionOnly(!showHighConvictionOnly)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              showHighConvictionOnly
                ? 'bg-green-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <div className={`w-3 h-3 rounded-full ${showHighConvictionOnly ? 'bg-white' : 'bg-green-500'}`} />
            High Conviction Only
          </button>
          <div className="flex items-center gap-1 text-sm">
            <span className="text-gray-500">Sort:</span>
            <button
              onClick={() => setSortBy('time')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                sortBy === 'time' ? 'bg-purple-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Time
            </button>
            <button
              onClick={() => setSortBy('conviction')}
              className={`px-2.5 py-1 rounded-md font-medium transition ${
                sortBy === 'conviction' ? 'bg-purple-500 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Conviction
            </button>
          </div>
        </div>
      )}

      {displayGames.length === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center text-gray-500 border border-gray-200">
          <p>No CBB games available yet.</p>
          <button
            onClick={syncAll}
            className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            Sync CBB Data
          </button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {[...displayGames]
            .filter(({ game }) => game.status !== 'final')
            .filter(({ prediction }) => {
              if (!showHighConvictionOnly) return true;
              return prediction.atsConfidence === 'high' || prediction.mlConfidence === 'high' || prediction.ouConfidence === 'high';
            })
            .sort((a, b) => {
              if (sortBy === 'conviction') {
                const confOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
                const aMax = Math.max(
                  confOrder[a.prediction.atsConfidence || 'low'],
                  confOrder[a.prediction.mlConfidence || 'low'],
                  confOrder[a.prediction.ouConfidence || 'low']
                );
                const bMax = Math.max(
                  confOrder[b.prediction.atsConfidence || 'low'],
                  confOrder[b.prediction.mlConfidence || 'low'],
                  confOrder[b.prediction.ouConfidence || 'low']
                );
                if (bMax !== aMax) return bMax - aMax;
              }
              return new Date(a.game.gameTime).getTime() - new Date(b.game.gameTime).getTime();
            })
            .slice(0, isPremium ? undefined : 3)
            .map(({ game, prediction }) => {
              const away = game.awayTeam?.abbreviation || 'AWAY';
              const home = game.homeTeam?.abbreviation || 'HOME';
              const awayLabel = game.awayTeam?.name || away;
              const homeLabel = game.homeTeam?.name || home;
              const ourSpread = prediction.predictedSpread;
              const ourTotal = prediction.predictedTotal;
              const homeWinProb = prediction.homeWinProbability;

              const displaySpread = prediction.vegasSpread ?? ourSpread;
              const displayTotal = prediction.vegasTotal ?? ourTotal;
              const hasVegas = prediction.vegasSpread !== undefined;
              const lineInfo = prediction.lineMovement;
              const lineOpeningSpread = lineInfo?.openingSpread;
              const lineCurrentSpread = lineInfo?.closingSpread ?? lineInfo?.lastSeenSpread ?? prediction.vegasSpread;
              const lineOpeningTotal = lineInfo?.openingTotal;
              const lineCurrentTotal = lineInfo?.closingTotal ?? lineInfo?.lastSeenTotal ?? prediction.vegasTotal;
              const spreadMove = lineOpeningSpread !== undefined && lineCurrentSpread !== undefined
                ? Math.round((lineCurrentSpread - lineOpeningSpread) * 2) / 2
                : undefined;
              const totalMove = lineOpeningTotal !== undefined && lineCurrentTotal !== undefined
                ? Math.round((lineCurrentTotal - lineOpeningTotal) * 2) / 2
                : undefined;
              const spreadMoveTeam = spreadMove === undefined || spreadMove === 0
                ? null
                : spreadMove > 0
                  ? awayLabel
                  : homeLabel;

              // Pick home if we favor home more than Vegas, or if no Vegas odds, pick based on predicted winner
              const pickHomeSpread = hasVegas ? ourSpread < displaySpread : ourSpread < 0;
              const pickHomeML = homeWinProb > 0.5;
              const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 224;

              const atsConf = isPremium ? (prediction.atsConfidence || 'medium') : 'low';
              const ouConf = isPremium ? (prediction.ouConfidence || 'medium') : 'low';
              const mlConf = isPremium ? (prediction.mlConfidence || 'medium') : 'low';

              // Determine primary pick (highest conviction, prefer Spread > ML > Total on ties)
              const confOrder = { high: 3, medium: 2, low: 1 };
              const pickOptions = [
                { type: 'spread' as const, conf: atsConf, confVal: confOrder[atsConf] },
                { type: 'ml' as const, conf: mlConf, confVal: confOrder[mlConf] },
                { type: 'total' as const, conf: ouConf, confVal: confOrder[ouConf] },
              ];
              const primaryPick = pickOptions.reduce((best, curr) =>
                curr.confVal > best.confVal ? curr : best
              );
              const secondaryPicks = pickOptions.filter(p => p.type !== primaryPick.type);

              // Conviction rail color based on primary pick
              const railColor = primaryPick.conf === 'high' ? 'bg-green-500' :
                               primaryPick.conf === 'medium' ? 'bg-blue-500' : 'bg-gray-300';

              return (
                <div key={game.id} className="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden hover:shadow-md hover:border-gray-300 transition">
                  {/* Conviction rail */}
                  <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${railColor}`} />

                  {/* Game header */}
                  <a href={`/nba/game/${game.id}`} className="group block p-3 sm:p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 sm:gap-4">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <img src={getLogoUrl(away)} alt={away} className="w-7 h-7 sm:w-10 sm:h-10 object-contain" />
                          <span className="font-bold text-gray-900 text-sm sm:text-base">{away}</span>
                        </div>
                        <span className="text-gray-400 text-xs sm:text-sm">@</span>
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <img src={getLogoUrl(home)} alt={home} className="w-7 h-7 sm:w-10 sm:h-10 object-contain" />
                          <span className="font-bold text-gray-900 text-sm sm:text-base">{home}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="text-right">
                          <div className="font-mono text-base sm:text-lg font-bold text-gray-900">
                            {Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}
                          </div>
                          <div className="text-[10px] sm:text-xs text-gray-500">{formatTime(game.gameTime)}</div>
                        </div>
                        <div className="flex items-center text-gray-400 group-hover:text-purple-600 transition-colors">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </a>

                  {/* Vegas line status */}
                  {hasVegas && (
                    <>
                      <div className="px-3 sm:px-4 py-1 sm:py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-[10px] sm:text-xs">
                        <div className="flex flex-col">
                          <span className="text-gray-500">Vegas</span>
                          {lineOpeningSpread !== undefined && lineCurrentSpread !== undefined && (
                            <span className="text-[10px] sm:text-xs text-gray-400">
                              Spread: {formatSpread(lineOpeningSpread)} → {formatSpread(lineCurrentSpread)}
                            </span>
                          )}
                          {lineOpeningTotal !== undefined && lineCurrentTotal !== undefined && (
                            <span className="text-[10px] sm:text-xs text-gray-400">
                              Total: {Math.round(lineOpeningTotal * 2) / 2} → {Math.round(lineCurrentTotal * 2) / 2}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {prediction.oddsLockedAt ? (
                            <span className="text-green-600 font-medium flex items-center gap-1">
                              <svg className="w-2.5 h-2.5 sm:w-3 sm:h-3" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                              </svg>
                              Locked
                            </span>
                          ) : (
                            <span className="text-gray-400">Live</span>
                          )}
                        </div>
                      </div>
                      {spreadMove !== undefined && spreadMove !== 0 && (
                        <div className="px-3 sm:px-4 pb-1 sm:pb-1.5 bg-gray-50 border-b border-gray-100 text-[10px] sm:text-xs text-gray-500">
                          Line moved {spreadMove > 0 ? '+' : '-'}{Math.abs(spreadMove)} toward {spreadMoveTeam}.
                        </div>
                      )}
                    </>
                  )}

                  {/* Primary Pick Section */}
                  <div className="p-3 sm:p-4">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Model Pick</div>

                    {/* Primary Pick Button */}
                    <div className="relative">
                      <div
                        className={`flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-bold ${
                          primaryPick.conf === 'high'
                            ? 'bg-green-600 text-white'
                            : primaryPick.conf === 'medium'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {primaryPick.type === 'spread' ? (
                          <div className="flex items-center gap-2">
                            <img src={getLogoUrl(pickHomeSpread ? home : away)} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain" />
                            <span>{pickHomeSpread ? home : away}</span>
                            <span className="font-mono">{formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                          </div>
                        ) : primaryPick.type === 'ml' ? (
                          <div className="flex items-center gap-2">
                            <img src={getLogoUrl(pickHomeML ? home : away)} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain" />
                            <span>{pickHomeML ? home : away} ML</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{pickOver ? 'OVER' : 'UNDER'} {Math.round(displayTotal * 2) / 2}</span>
                          </div>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          primaryPick.conf === 'high'
                            ? 'bg-green-700 text-green-100'
                            : primaryPick.conf === 'medium'
                              ? 'bg-blue-600 text-blue-100'
                              : 'bg-gray-200 text-gray-500'
                        }`}>
                          {primaryPick.type === 'spread' ? 'Spread' : primaryPick.type === 'ml' ? 'Moneyline' : 'Total'}
                        </span>
                      </div>
                    </div>

                    {/* Secondary Picks - Muted Pills */}
                    {secondaryPicks.length > 0 && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        <span className="text-[10px] text-gray-400 uppercase">Also:</span>
                        <div className="flex gap-2 flex-wrap">
                          {secondaryPicks.map((pick) => {
                            const isSpread = pick.type === 'spread';
                            const isML = pick.type === 'ml';

                            return (
                              <div key={pick.type} className="relative">
                                <div
                                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                    pick.conf === 'high'
                                      ? 'bg-green-100 text-green-700 border border-green-200'
                                      : pick.conf === 'medium'
                                        ? 'bg-blue-50 text-blue-600 border border-blue-100'
                                        : 'bg-gray-50 text-gray-400 border border-gray-100'
                                  }`}
                                >
                                  {isSpread ? (
                                    <span>{pickHomeSpread ? home : away} {formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                                  ) : isML ? (
                                    <span>{pickHomeML ? home : away} ML</span>
                                  ) : (
                                    <span>{pickOver ? 'O' : 'U'} {Math.round(displayTotal * 2) / 2}</span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}

      {/* Results Tally - only show if there are final games */}
      {displayGames.some(({ game }) => game.status === 'final') && (() => {
        // Calculate records from final games
        let atsW = 0, atsL = 0, atsP = 0;
        let mlW = 0, mlL = 0;
        let ouW = 0, ouL = 0, ouP = 0;
        let hiAtsW = 0, hiAtsL = 0, hiAtsP = 0;
        let hiMlW = 0, hiMlL = 0;
        let hiOuW = 0, hiOuL = 0, hiOuP = 0;

        displayGames.filter(({ game }) => game.status === 'final').forEach(({ game, prediction }) => {
          const awayScore = game.awayScore ?? 0;
          const homeScore = game.homeScore ?? 0;
          const actualTotal = awayScore + homeScore;
          const ourSpread = prediction.predictedSpread;
          const ourTotal = prediction.predictedTotal;
          const homeWinProb = prediction.homeWinProbability;
          const hasVegas = prediction.vegasSpread !== undefined;

          const spreadForGrading = prediction.vegasSpread ?? ourSpread;
          const vegasTotal = prediction.vegasTotal ?? 224;

          // Pick home if we favor home more than Vegas, or if no Vegas odds, pick based on predicted winner
          const pickHomeSpread = hasVegas ? ourSpread < spreadForGrading : ourSpread < 0;
          const pickHomeML = homeWinProb > 0.5;
          const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 224;

          const atsConf = prediction.atsConfidence || 'medium';
          const ouConf = prediction.ouConfidence || 'medium';
          const mlConf = prediction.mlConfidence || 'medium';

          // ATS grading
          const homeMargin = homeScore - awayScore;
          const ats = homeMargin + spreadForGrading;
          const homeCovered = ats > 0;
          const pickSide: 'home' | 'away' = pickHomeSpread ? 'home' : 'away';
          const atsWin = pickSide === 'home' ? homeCovered : !homeCovered;

          if (ats === 0) { atsP++; if (atsConf === 'high') hiAtsP++; }
          else if (atsWin) {
            atsW++; if (atsConf === 'high') hiAtsW++;
          } else {
            atsL++; if (atsConf === 'high') hiAtsL++;
          }

          // ML
          const mlHit = pickHomeML ? homeScore > awayScore : awayScore > homeScore;
          if (mlHit) { mlW++; if (mlConf === 'high') hiMlW++; }
          else { mlL++; if (mlConf === 'high') hiMlL++; }

          // O/U
          if (actualTotal === vegasTotal) { ouP++; if (ouConf === 'high') hiOuP++; }
          else if (pickOver ? actualTotal > vegasTotal : actualTotal < vegasTotal) {
            ouW++; if (ouConf === 'high') hiOuW++;
          } else {
            ouL++; if (ouConf === 'high') hiOuL++;
          }
        });

        const hasHighConv = (hiAtsW + hiAtsL + hiAtsP + hiMlW + hiMlL + hiOuW + hiOuL + hiOuP) > 0;

        return (
          <div className="mt-8 mb-4 space-y-3">
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-lg font-bold text-gray-500">Recent Results</h2>
              <div className="flex-1 h-px bg-gray-200"></div>
            </div>

            {/* Overall Record */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">All Picks</span>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-[10px] text-gray-400 uppercase">ATS</div>
                    <div className={`font-mono font-bold ${atsW > atsL ? 'text-green-600' : atsW < atsL ? 'text-red-600' : 'text-gray-600'}`}>
                      {atsW}-{atsL}{atsP > 0 ? `-${atsP}` : ''}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] text-gray-400 uppercase">ML</div>
                    <div className={`font-mono font-bold ${mlW > mlL ? 'text-green-600' : mlW < mlL ? 'text-red-600' : 'text-gray-600'}`}>
                      {mlW}-{mlL}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[10px] text-gray-400 uppercase">O/U</div>
                    <div className={`font-mono font-bold ${ouW > ouL ? 'text-green-600' : ouW < ouL ? 'text-red-600' : 'text-gray-600'}`}>
                      {ouW}-{ouL}{ouP > 0 ? `-${ouP}` : ''}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* High Conviction Only */}
            {hasHighConv && (
              <div className="bg-green-50 rounded-xl p-4 border border-green-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-green-700 flex items-center gap-2">
                    <span className="w-3 h-3 bg-green-600 rounded"></span>
                    High Conviction
                  </span>
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <div className="text-[10px] text-green-500 uppercase">ATS</div>
                      <div className={`font-mono font-bold ${hiAtsW > hiAtsL ? 'text-green-600' : hiAtsW < hiAtsL ? 'text-red-600' : 'text-gray-600'}`}>
                        {hiAtsW}-{hiAtsL}{hiAtsP > 0 ? `-${hiAtsP}` : ''}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-green-500 uppercase">ML</div>
                      <div className={`font-mono font-bold ${hiMlW > hiMlL ? 'text-green-600' : hiMlW < hiMlL ? 'text-red-600' : 'text-gray-600'}`}>
                        {hiMlW}-{hiMlL}
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="text-[10px] text-green-500 uppercase">O/U</div>
                      <div className={`font-mono font-bold ${hiOuW > hiOuL ? 'text-green-600' : hiOuW < hiOuL ? 'text-red-600' : 'text-gray-600'}`}>
                        {hiOuW}-{hiOuL}{hiOuP > 0 ? `-${hiOuP}` : ''}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Final Games */}
      {displayGames.some(({ game }) => game.status === 'final') && (
        <div className="grid gap-4 md:grid-cols-2">
          {[...displayGames]
            .filter(({ game }) => game.status === 'final')
            .sort((a, b) => new Date(b.game.gameTime).getTime() - new Date(a.game.gameTime).getTime())
            .map(({ game, prediction }) => {
              const away = game.awayTeam?.abbreviation || 'AWAY';
              const home = game.homeTeam?.abbreviation || 'HOME';
              const awayScore = game.awayScore ?? 0;
              const homeScore = game.homeScore ?? 0;
              const ourSpread = prediction.predictedSpread;
              const ourTotal = prediction.predictedTotal;
              const homeWinProb = prediction.homeWinProbability;

              const displaySpread = prediction.vegasSpread ?? ourSpread;
              const displayTotal = prediction.vegasTotal ?? ourTotal;
              const hasVegas = prediction.vegasSpread !== undefined;

              // Pick home if we favor home more than Vegas, or if no Vegas odds, pick based on predicted winner
              const pickHomeSpread = hasVegas ? ourSpread < displaySpread : ourSpread < 0;
              const pickHomeML = homeWinProb > 0.5;
              const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 224;

              const atsConf = prediction.atsConfidence || 'medium';
              const ouConf = prediction.ouConfidence || 'medium';
              const mlConf = prediction.mlConfidence || 'medium';

              // Calculate results
              const actualTotal = awayScore + homeScore;
              const vegasTotal = prediction.vegasTotal ?? 224;

              // Spread result
              const homeMargin = homeScore - awayScore;
              const ats = homeMargin + displaySpread;
              const homeCovered = ats > 0;
              const pickSide: 'home' | 'away' = pickHomeSpread ? 'home' : 'away';
              const spreadResult: 'win' | 'loss' | 'push' =
                ats === 0 ? 'push' :
                pickSide === 'home' ? (homeCovered ? 'win' : 'loss') : (!homeCovered ? 'win' : 'loss');

              const mlResult: 'win' | 'loss' =
                (pickHomeML ? homeScore > awayScore : awayScore > homeScore) ? 'win' : 'loss';

              const ouResult: 'win' | 'loss' | 'push' =
                actualTotal === vegasTotal ? 'push' :
                (pickOver ? actualTotal > vegasTotal : actualTotal < vegasTotal) ? 'win' : 'loss';

              // Determine primary pick for final games
              const confOrder = { high: 3, medium: 2, low: 1 };
              const pickOptions = [
                { type: 'spread' as const, conf: atsConf, confVal: confOrder[atsConf] },
                { type: 'ml' as const, conf: mlConf, confVal: confOrder[mlConf] },
                { type: 'total' as const, conf: ouConf, confVal: confOrder[ouConf] },
              ];
              const primaryPick = pickOptions.reduce((best, curr) =>
                curr.confVal > best.confVal ? curr : best
              );
              const secondaryPicks = pickOptions.filter(p => p.type !== primaryPick.type);
              const railColor = primaryPick.conf === 'high' ? 'bg-green-500' :
                               primaryPick.conf === 'medium' ? 'bg-blue-500' : 'bg-gray-300';

              return (
                <div key={game.id} className="relative bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden opacity-90">
                  {/* Conviction rail */}
                  <div className={`absolute left-0 top-0 h-full w-1 rounded-l-2xl ${railColor}`} />

                  {/* Game header */}
                  <a href={`/nba/game/${game.id}`} className="group block p-3 sm:p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2 sm:gap-4">
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <img src={getLogoUrl(away)} alt={away} className="w-7 h-7 sm:w-10 sm:h-10 object-contain" />
                          <span className="font-bold text-gray-900 text-sm sm:text-base">{away}</span>
                        </div>
                        <span className="text-gray-400 text-xs sm:text-sm">@</span>
                        <div className="flex items-center gap-1.5 sm:gap-2">
                          <img src={getLogoUrl(home)} alt={home} className="w-7 h-7 sm:w-10 sm:h-10 object-contain" />
                          <span className="font-bold text-gray-900 text-sm sm:text-base">{home}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="text-right">
                          <div className="flex items-center gap-1 sm:gap-2">
                            <span className="text-[10px] sm:text-xs text-gray-400 font-mono">
                              {Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}
                            </span>
                            <span className="text-gray-300 text-xs">→</span>
                            <span className="font-mono text-base sm:text-lg font-bold text-gray-900">{awayScore}-{homeScore}</span>
                          </div>
                          <div className="text-[10px] sm:text-xs font-semibold text-gray-500">FINAL</div>
                        </div>
                        <div className="flex items-center text-gray-400 group-hover:text-purple-600 transition-colors">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </a>

                  {/* Primary Pick Section */}
                  <div className="p-3 sm:p-4">
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Model Pick</div>

                    {/* Primary Pick Button */}
                    <div className="relative">
                      <div
                        className={`flex items-center justify-between px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl text-sm sm:text-base font-bold ${
                          primaryPick.conf === 'high'
                            ? 'bg-green-600 text-white'
                            : primaryPick.conf === 'medium'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {primaryPick.type === 'spread' ? (
                          <div className="flex items-center gap-2">
                            <img src={getLogoUrl(pickHomeSpread ? home : away)} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain" />
                            <span>{pickHomeSpread ? home : away}</span>
                            <span className="font-mono">{formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                          </div>
                        ) : primaryPick.type === 'ml' ? (
                          <div className="flex items-center gap-2">
                            <img src={getLogoUrl(pickHomeML ? home : away)} alt="" className="w-5 h-5 sm:w-6 sm:h-6 object-contain" />
                            <span>{pickHomeML ? home : away} ML</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span>{pickOver ? 'OVER' : 'UNDER'} {Math.round(displayTotal * 2) / 2}</span>
                          </div>
                        )}
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          primaryPick.conf === 'high'
                            ? 'bg-green-700 text-green-100'
                            : primaryPick.conf === 'medium'
                              ? 'bg-blue-600 text-blue-100'
                              : 'bg-gray-200 text-gray-500'
                        }`}>
                          {primaryPick.type === 'spread' ? 'Spread' : primaryPick.type === 'ml' ? 'Moneyline' : 'Total'}
                        </span>
                      </div>
                      {/* Result badge for primary pick */}
                      {primaryPick.type === 'spread' && (
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          spreadResult === 'win' ? 'bg-green-500' : spreadResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {spreadResult === 'win' ? '✓' : spreadResult === 'loss' ? '✗' : '–'}
                        </div>
                      )}
                      {primaryPick.type === 'ml' && (
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          mlResult === 'win' ? 'bg-green-500' : 'bg-red-500'
                        }`}>
                          {mlResult === 'win' ? '✓' : '✗'}
                        </div>
                      )}
                      {primaryPick.type === 'total' && (
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          ouResult === 'win' ? 'bg-green-500' : ouResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {ouResult === 'win' ? '✓' : ouResult === 'loss' ? '✗' : '–'}
                        </div>
                      )}
                    </div>

                    {/* Secondary Picks - Muted Pills */}
                    {secondaryPicks.length > 0 && (
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                        <span className="text-[10px] text-gray-400 uppercase">Also:</span>
                        <div className="flex gap-2 flex-wrap">
                          {secondaryPicks.map((pick) => {
                            const isSpread = pick.type === 'spread';
                            const isML = pick.type === 'ml';
                            const result = isSpread ? spreadResult : isML ? mlResult : ouResult;

                            return (
                              <div key={pick.type} className="relative">
                                <div
                                  className={`px-2.5 py-1 rounded-lg text-xs font-medium ${
                                    pick.conf === 'high'
                                      ? 'bg-green-100 text-green-700 border border-green-200'
                                      : pick.conf === 'medium'
                                        ? 'bg-blue-50 text-blue-600 border border-blue-100'
                                        : 'bg-gray-50 text-gray-400 border border-gray-100'
                                  }`}
                                >
                                  {isSpread ? (
                                    <span>{pickHomeSpread ? home : away} {formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                                  ) : isML ? (
                                    <span>{pickHomeML ? home : away} ML</span>
                                  ) : (
                                    <span>{pickOver ? 'O' : 'U'} {Math.round(displayTotal * 2) / 2}</span>
                                  )}
                                </div>
                                <div className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] text-white font-bold ${
                                  result === 'win' ? 'bg-green-500' : result === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                                }`}>
                                  {result === 'win' ? '✓' : result === 'loss' ? '✗' : '–'}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
      </div>
    </RequireAuth>
  );
}
