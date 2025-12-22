'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

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

interface WeatherInfo {
  temperature: number;
  windSpeed: number;
  conditions: string;
  precipitation: number;
}

interface InjuryInfo {
  homeInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  awayInjuries: { hasQBOut: boolean; keyOut: number; summary: string };
  impactLevel: 'none' | 'minor' | 'significant' | 'major';
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
  // 60%+ situation flags
  isDivisional?: boolean;
  isLateSeasonGame?: boolean;
  isLargeSpread?: boolean;
  isSmallSpread?: boolean;
  isMediumSpread?: boolean;
  isEloMismatch?: boolean;
  sixtyPlusFactors?: number;
  eloDiff?: number;
  week?: number;
  // Weather data
  weather?: WeatherInfo;
  weatherImpact?: number;
  // Injury data
  injuries?: InjuryInfo;
}

interface GameWithPrediction {
  game: Game;
  prediction: Prediction;
}

interface CronHealthState {
  lastSyncAt?: string;
  lastBlobWriteAt?: string;
  lastBlobUrl?: string;
  lastBlobSizeKb?: number;
  season?: number;
  currentWeek?: number;
}

interface CronHealthResponse {
  nfl?: CronHealthState | null;
  nba?: CronHealthState | null;
  error?: string;
  message?: string;
}

export default function Dashboard() {
  const [games, setGames] = useState<GameWithPrediction[]>([]);
  const [recentGames, setRecentGames] = useState<Game[]>([]);
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [cronHealth, setCronHealth] = useState<CronHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const scoreboardRef = useRef<HTMLDivElement>(null);

  const scrollScoreboard = (direction: 'left' | 'right') => {
    if (scoreboardRef.current) {
      const scrollAmount = 300;
      scoreboardRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  const fetchLiveScores = useCallback(async () => {
    try {
      const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard');
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
    } catch (error) {
      console.error('Error fetching live scores:', error);
    }
  }, []);

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

      // Deduplicate games by id to avoid React key warnings
      const uniqueGames = (data.games || []).filter(
        (item: GameWithPrediction, index: number, self: GameWithPrediction[]) =>
          index === self.findIndex((g) => g.game.id === item.game.id)
      );
      setGames(uniqueGames);
      // Deduplicate recentGames by id to avoid React key warnings
      const uniqueRecentGames = (data.recentGames || []).filter(
        (game: Game, index: number, self: Game[]) =>
          index === self.findIndex((g) => g.id === game.id)
      );
      setRecentGames(uniqueRecentGames);
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
      await fetch('/api/cron/blob-sync-simple');
      await fetchData();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }, [fetchData]);

  const fetchCronHealth = useCallback(async () => {
    try {
      const response = await fetch('/api/cron/health', { cache: 'no-cache' });
      const data = await response.json();
      setCronHealth(data);
    } catch (error) {
      console.error('Error fetching cron health:', error);
      setCronHealth({ error: 'Failed to load cron health' });
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const hasData = await fetchData();
      if (!hasData) {
        await syncAll();
      }
      fetchCronHealth();
      // Fetch live scores
      fetchLiveScores();
    };
    init();

    // Refresh live scores every 30 seconds
    const interval = setInterval(fetchLiveScores, 30000);
    return () => clearInterval(interval);
  }, [fetchCronHealth, fetchData, fetchLiveScores, syncAll]);

  const formatHealthTime = (value?: string) => {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

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

  const getWeatherIcon = (conditions: string) => {
    const c = conditions.toLowerCase();
    if (c === 'indoor') return '🏟️';
    if (c.includes('rain') || c.includes('shower')) return '🌧️';
    if (c.includes('snow')) return '🌨️';
    if (c.includes('cloud') || c.includes('overcast')) return '☁️';
    if (c.includes('clear') || c.includes('sun')) return '☀️';
    if (c.includes('wind')) return '💨';
    if (c.includes('fog') || c.includes('mist')) return '🌫️';
    return '🌤️';
  };

  const getWeatherImpactColor = (impact: number) => {
    if (impact === 0) return 'text-gray-400';
    if (impact <= 1) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (loading || syncing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-red-600 border-t-transparent rounded-full animate-spin mb-4"></div>
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

  const liveNow = liveGames.filter(g => g.status === 'live');
  const finalToday = liveGames.filter(g => g.status === 'final');
  const scheduledToday = liveGames.filter(g => g.status === 'scheduled');

  const formatGameTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getQuarterText = (quarter: number) => {
    if (quarter === 1) return '1st';
    if (quarter === 2) return '2nd';
    if (quarter === 3) return '3rd';
    if (quarter === 4) return '4th';
    if (quarter === 5) return 'OT';
    return '';
  };

  // Sort all games: live first, then scheduled by time, then final
  const allTodayGames = [...liveGames].sort((a, b) => {
    if (a.status === 'live' && b.status !== 'live') return -1;
    if (a.status !== 'live' && b.status === 'live') return 1;
    if (a.status === 'scheduled' && b.status === 'final') return -1;
    if (a.status === 'final' && b.status === 'scheduled') return 1;
    return new Date(a.gameTime || 0).getTime() - new Date(b.gameTime || 0).getTime();
  });

  return (
    <div className="space-y-6">
      {/* All Games - Horizontal Scoreboard */}
      {allTodayGames.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              {liveNow.length > 0 && (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                  </span>
                  <span className="text-xs font-bold text-red-600">{liveNow.length} LIVE</span>
                  <span className="text-gray-300">|</span>
                </>
              )}
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Week 16</h2>
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
                    isLive ? 'border-red-300 bg-red-50/30' : 'border-gray-200'
                  }`}
                >
                  {/* Status row */}
                  <div className="flex items-center justify-between mb-1">
                    {isLive ? (
                      <span className="text-[9px] font-bold text-red-600">
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
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
                      </span>
                    )}
                  </div>

                  {/* Teams */}
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

      {/* Recent Scores - Only show when no live games */}
      {recentGames.length > 0 && liveGames.length === 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wide">Recent Scores</h2>
            <a href="/results" className="text-sm text-red-700 hover:text-red-700 font-medium">
              View All →
            </a>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide scroll-snap-x">
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
        <div className="flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-600 rounded"></span> Strong</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded"></span> Lean</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 bg-gray-300 rounded"></span> Avoid</span>
        </div>
      </div>

      {games.length === 0 ? (
        <div className="bg-white rounded-lg p-8 text-center text-gray-500 border border-gray-200">
          No upcoming games. Check back later.
        </div>
      ) : (
        <>
        {/* Upcoming Games */}
        <div className="grid gap-4 md:grid-cols-2">
          {[...games]
            .filter(({ game }) => game.status !== 'final')
            .sort((a, b) => new Date(a.game.gameTime).getTime() - new Date(b.game.gameTime).getTime())
            .map(({ game, prediction }) => {
            const away = game.awayTeam?.abbreviation || 'AWAY';
            const home = game.homeTeam?.abbreviation || 'HOME';
            const ourSpread = prediction.predictedSpread;
            const ourTotal = prediction.predictedTotal;
            const homeWinProb = prediction.homeWinProbability;

            // Use Vegas lines if available, otherwise use our predictions
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
                ? away
                : home;

            // Spread pick: pick home if we favor home more than Vegas
            const pickHomeSpread = ourSpread < displaySpread;

            // ML pick: based on win probability
            const pickHomeML = homeWinProb > 0.5;

            // O/U pick: compare our total to Vegas (or league avg if no Vegas)
            const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 44;

            // Confidence indicators
            const atsConf = prediction.atsConfidence || 'medium';
            const ouConf = prediction.ouConfidence || 'medium';
            const mlConf = prediction.mlConfidence || 'medium';

            // Result calculation for final games
            const isFinal = game.status === 'final';
            const awayScore = game.awayScore ?? 0;
            const homeScore = game.homeScore ?? 0;
            const actualTotal = awayScore + homeScore;
            const vegasTotal = prediction.vegasTotal ?? 44;

            // Spread result: standardized grading
            // homeMargin + homeSpread: >0 home covers, <0 away covers, =0 push
            // Use displaySpread (falls back to ourSpread if no Vegas line)
            const homeMargin = homeScore - awayScore;
            const ats = homeMargin + displaySpread;
            const homeCovered = ats > 0;
            const pickSide: 'home' | 'away' = pickHomeSpread ? 'home' : 'away';
            const spreadResult: 'win' | 'loss' | 'push' | null = !isFinal ? null :
              ats === 0 ? 'push' :
              pickSide === 'home' ? (homeCovered ? 'win' : 'loss') : (!homeCovered ? 'win' : 'loss');

            const mlResult: 'win' | 'loss' | null = !isFinal ? null :
              (pickHomeML ? homeScore > awayScore : awayScore > homeScore) ? 'win' : 'loss';

            const ouResult: 'win' | 'loss' | 'push' | null = !isFinal ? null :
              actualTotal === vegasTotal ? 'push' :
              (pickOver ? actualTotal > vegasTotal : actualTotal < vegasTotal) ? 'win' : 'loss';

            // 60%+ situation badges
            const situations: string[] = [];
            if (prediction.isDivisional) situations.push('DIV');
            if (prediction.isLateSeasonGame) situations.push('LATE SZN');
            if (prediction.isLargeSpread) situations.push('BIG LINE');
            if (prediction.isSmallSpread) situations.push('CLOSE');
            if (prediction.isEloMismatch) situations.push('MISMATCH');

            // Determine if this game has any strong picks
            const hasStrongPick = mlConf === 'high' || ouConf === 'high' || atsConf === 'high';

            return (
              <div key={game.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow ${
                hasStrongPick ? 'border-green-300' : 'border-gray-200'
              }`}>
                {/* Situation tags - only show if we have high confidence situations */}
                {situations.length > 0 && atsConf !== 'low' && (
                  <div className="px-2 sm:px-3 py-1 sm:py-1.5 flex flex-wrap gap-1 border-b border-gray-100">
                    {situations.map(s => (
                      <span key={s} className="text-[8px] sm:text-[9px] font-medium text-gray-500 bg-gray-100 px-1 sm:px-1.5 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {/* Game header */}
                <a href={`/game/${game.id}`} className="group block p-3 sm:p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors">
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
                        {isFinal ? (
                          <>
                            <div className="flex items-center gap-1 sm:gap-2">
                              <span className="text-[10px] sm:text-xs text-gray-400 font-mono">{Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}</span>
                              <span className="text-gray-300 text-xs">→</span>
                              <span className="font-mono text-base sm:text-lg font-bold text-gray-900">{awayScore}-{homeScore}</span>
                            </div>
                            <div className="text-[10px] sm:text-xs font-semibold text-gray-500">FINAL</div>
                          </>
                        ) : (
                          <>
                            <div className="font-mono text-base sm:text-lg font-bold text-gray-900">{Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}</div>
                            <div className="text-[10px] sm:text-xs text-gray-500">{formatTime(game.gameTime)}</div>
                          </>
                        )}
                      </div>
                      <div className="flex items-center text-gray-400 group-hover:text-red-600 transition-colors">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </a>

                {/* Weather info */}
                {prediction.weather && (
                  <div className="px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-[10px] sm:text-xs">
                    <div className="flex items-center gap-1.5 sm:gap-3 flex-wrap">
                      <span className="text-sm sm:text-base">{getWeatherIcon(prediction.weather.conditions)}</span>
                      <span className="text-gray-600">{prediction.weather.temperature}°F</span>
                      {prediction.weather.windSpeed > 0 && (
                        <>
                          <span className="text-gray-300 hidden sm:inline">|</span>
                          <span className="text-gray-600">{prediction.weather.windSpeed}mph</span>
                        </>
                      )}
                    </div>
                    {(prediction.weatherImpact ?? 0) > 0 && (
                      <span className={`font-medium text-[10px] sm:text-xs ${getWeatherImpactColor(prediction.weatherImpact ?? 0)}`}>
                        -{((prediction.weatherImpact ?? 0) * 3).toFixed(1)}pts
                      </span>
                    )}
                  </div>
                )}

                {/* Injury info - from NFL.com */}
                {prediction.injuries && prediction.injuries.impactLevel !== 'none' && (
                  <div className={`px-3 sm:px-4 py-1.5 sm:py-2 border-b border-gray-100 flex items-center justify-between text-[10px] sm:text-xs ${
                    prediction.injuries.impactLevel === 'major' ? 'bg-red-50' :
                    prediction.injuries.impactLevel === 'significant' ? 'bg-orange-50' : 'bg-yellow-50'
                  }`}>
                    <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                      <span className="text-sm sm:text-base flex-shrink-0">🏥</span>
                      <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 overflow-hidden">
                        <div className="flex items-center gap-1 min-w-0">
                          <img src={getLogoUrl(away)} alt="" className="w-3 h-3 sm:w-4 sm:h-4 object-contain flex-shrink-0" />
                          <span className={`truncate ${prediction.injuries.awayInjuries.hasQBOut ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {prediction.injuries.awayInjuries.summary}
                          </span>
                        </div>
                        <span className="text-gray-300 flex-shrink-0">|</span>
                        <div className="flex items-center gap-1 min-w-0">
                          <img src={getLogoUrl(home)} alt="" className="w-3 h-3 sm:w-4 sm:h-4 object-contain flex-shrink-0" />
                          <span className={`truncate ${prediction.injuries.homeInjuries.hasQBOut ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                            {prediction.injuries.homeInjuries.summary}
                          </span>
                        </div>
                      </div>
                    </div>
                    {(prediction.injuries.homeInjuries.hasQBOut || prediction.injuries.awayInjuries.hasQBOut) && (
                      <span className="text-red-600 font-bold text-[9px] sm:text-[10px] bg-red-100 px-1 sm:px-1.5 py-0.5 rounded flex-shrink-0 ml-1">
                        QB OUT
                      </span>
                    )}
                  </div>
                )}

                {/* Vegas line status */}
                {hasVegas && (
                  <div className="px-3 sm:px-4 py-1 sm:py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-[9px] sm:text-[10px]">
                    <span className="text-gray-500">Vegas</span>
                    <div className="flex items-center gap-2">
                      {lineOpeningSpread !== undefined && (
                        <div className="relative group">
                          <button
                            type="button"
                            className="w-4 h-4 rounded-full border border-gray-300 text-gray-500 flex items-center justify-center text-[9px] leading-none hover:border-gray-400"
                            aria-label="Line movement details"
                          >
                            i
                          </button>
                          <div className="absolute right-0 mt-2 hidden w-52 rounded-md border border-gray-200 bg-white p-2 text-[10px] text-gray-600 shadow-lg group-hover:block">
                            <div className="font-semibold text-gray-900 mb-1">Line Movement</div>
                            <div>Spread: {lineOpeningSpread} → {lineCurrentSpread ?? '—'}</div>
                            <div>Total: {lineOpeningTotal ?? '—'} → {lineCurrentTotal ?? '—'}</div>
                            {spreadMove !== undefined && (
                              <div className="mt-1">
                                {spreadMove === 0
                                  ? 'No spread movement.'
                                  : `Moved ${Math.abs(spreadMove)} toward ${spreadMoveTeam}.`}
                              </div>
                            )}
                            {totalMove !== undefined && totalMove !== 0 && (
                              <div>Totals moved {Math.abs(totalMove)} {totalMove > 0 ? 'up' : 'down'}.</div>
                            )}
                          </div>
                        </div>
                      )}
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
                )}

                {/* Picks grid - Clean color-coded picks */}
                <div className="grid grid-cols-3 divide-x divide-gray-100">
                  {/* Spread */}
                  <div className="p-2 sm:p-3">
                    <div className="text-[8px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 sm:mb-2 text-center">
                      Spread
                    </div>
                    <div className="relative">
                      <div
                        className={`flex items-center justify-center gap-1 px-1.5 sm:px-2.5 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold ${
                          atsConf === 'low'
                            ? 'bg-gray-100 text-gray-400'
                            : atsConf === 'high'
                              ? 'bg-green-600 text-white'
                              : 'bg-blue-500 text-white'
                        }`}
                      >
                        <img src={getLogoUrl(pickHomeSpread ? home : away)} alt="" className="w-4 h-4 sm:w-5 sm:h-5 object-contain" />
                        <span className="text-[11px] sm:text-sm">{pickHomeSpread ? home : away}</span>
                        <span className="font-mono text-[10px] sm:text-sm">{formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                      </div>
                      {spreadResult && (
                        <div className={`absolute -top-1 -right-1 sm:-top-1.5 sm:-right-1.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs text-white font-bold ${
                          spreadResult === 'win' ? 'bg-green-500' : spreadResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {spreadResult === 'win' ? '✓' : spreadResult === 'loss' ? '✗' : '–'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Moneyline */}
                  <div className="p-2 sm:p-3">
                    <div className="text-[8px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 sm:mb-2 text-center">
                      ML
                    </div>
                    <div className="relative">
                      <div
                        className={`flex items-center justify-center gap-1 px-1.5 sm:px-2.5 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm font-bold ${
                          mlConf === 'high'
                            ? 'bg-green-600 text-white'
                            : mlConf === 'medium'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        <img src={getLogoUrl(pickHomeML ? home : away)} alt="" className="w-4 h-4 sm:w-5 sm:h-5 object-contain" />
                        <span className="text-[11px] sm:text-sm">{pickHomeML ? home : away}</span>
                      </div>
                      {mlResult && (
                        <div className={`absolute -top-1 -right-1 sm:-top-1.5 sm:-right-1.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs text-white font-bold ${
                          mlResult === 'win' ? 'bg-green-500' : 'bg-red-500'
                        }`}>
                          {mlResult === 'win' ? '✓' : '✗'}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Over/Under */}
                  <div className="p-2 sm:p-3">
                    <div className="text-[8px] sm:text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 sm:mb-2 text-center">
                      Total
                    </div>
                    <div className="relative">
                      <div
                        className={`px-1.5 sm:px-2.5 py-1.5 sm:py-2 rounded-lg text-[10px] sm:text-sm font-bold text-center ${
                          ouConf === 'high'
                            ? 'bg-green-600 text-white'
                            : ouConf === 'medium'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        <div>{pickOver ? 'O' : 'U'} {Math.round(displayTotal * 2) / 2}</div>
                      </div>
                      {ouResult && (
                        <div className={`absolute -top-1 -right-1 sm:-top-1.5 sm:-right-1.5 w-4 h-4 sm:w-5 sm:h-5 rounded-full flex items-center justify-center text-[10px] sm:text-xs text-white font-bold ${
                          ouResult === 'win' ? 'bg-green-500' : ouResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {ouResult === 'win' ? '✓' : ouResult === 'loss' ? '✗' : '–'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Results Tally - only show if there are final games */}
        {games.some(({ game }) => game.status === 'final') && (() => {
          // Calculate records from final games
          let atsW = 0, atsL = 0, atsP = 0;
          let mlW = 0, mlL = 0;
          let ouW = 0, ouL = 0, ouP = 0;
          let hiAtsW = 0, hiAtsL = 0, hiAtsP = 0;
          let hiMlW = 0, hiMlL = 0;
          let hiOuW = 0, hiOuL = 0, hiOuP = 0;

          games.filter(({ game }) => game.status === 'final').forEach(({ game, prediction }) => {
            const awayScore = game.awayScore ?? 0;
            const homeScore = game.homeScore ?? 0;
            const actualTotal = awayScore + homeScore;
            const ourSpread = prediction.predictedSpread;
            const ourTotal = prediction.predictedTotal;
            const homeWinProb = prediction.homeWinProbability;
            const hasVegas = prediction.vegasSpread !== undefined;

            // Use Vegas spread if available, otherwise use our predicted spread
            const spreadForGrading = prediction.vegasSpread ?? ourSpread;
            const vegasTotal = prediction.vegasTotal ?? 44;

            const pickHomeSpread = ourSpread < spreadForGrading; // Pick home if we favor home more than Vegas
            const pickHomeML = homeWinProb > 0.5;
            const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 44;

            const atsConf = prediction.atsConfidence || 'medium';
            const ouConf = prediction.ouConfidence || 'medium';
            const mlConf = prediction.mlConfidence || 'medium';

            // ATS: standardized grading
            // homeMargin + homeSpread: >0 home covers, <0 away covers, =0 push
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
                <h2 className="text-lg font-bold text-gray-500">This Week's Results</h2>
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
        {games.some(({ game }) => game.status === 'final') && (
          <div className="grid gap-4 md:grid-cols-2">
            {[...games]
              .filter(({ game }) => game.status === 'final')
              .sort((a, b) => new Date(b.game.gameTime).getTime() - new Date(a.game.gameTime).getTime())
              .map(({ game, prediction }) => {
              const away = game.awayTeam?.abbreviation || 'AWAY';
              const home = game.homeTeam?.abbreviation || 'HOME';
              const ourSpread = prediction.predictedSpread;
              const ourTotal = prediction.predictedTotal;
              const homeWinProb = prediction.homeWinProbability;

              const displaySpread = prediction.vegasSpread ?? ourSpread;
              const displayTotal = prediction.vegasTotal ?? ourTotal;
              const hasVegas = prediction.vegasSpread !== undefined;

              const pickHomeSpread = ourSpread < displaySpread; // Pick home if we favor home more than Vegas
              const pickHomeML = homeWinProb > 0.5;
              const pickOver = hasVegas ? ourTotal > prediction.vegasTotal! : ourTotal > 44;

              const atsConf = prediction.atsConfidence || 'medium';
              const ouConf = prediction.ouConfidence || 'medium';
              const mlConf = prediction.mlConfidence || 'medium';

              // Calculate results for this final game
              const awayScore = game.awayScore ?? 0;
              const homeScore = game.homeScore ?? 0;
              const actualTotal = awayScore + homeScore;
              const vegasTotal = prediction.vegasTotal ?? 44;

              // Spread result: standardized grading
              // homeMargin + homeSpread: >0 home covers, <0 away covers, =0 push
              // Use displaySpread (falls back to ourSpread if no Vegas line)
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

              return (
                <div key={game.id} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden opacity-90">
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
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-mono">{Math.round(prediction.predictedAwayScore)}-{Math.round(prediction.predictedHomeScore)}</span>
                            <span className="text-gray-300">→</span>
                            <span className="font-mono text-lg font-bold text-gray-900">{awayScore}-{homeScore}</span>
                          </div>
                          <div className="text-xs font-semibold text-gray-500">FINAL</div>
                        </div>
                        <div className="flex items-center text-gray-400 group-hover:text-red-600 transition-colors">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </a>

                  {/* Picks grid with results */}
                  <div className="grid grid-cols-3 divide-x divide-gray-100">
                    {/* Spread */}
                    <div className="p-3">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">
                        Spread
                      </div>
                      <div className="relative">
                        <div
                          className={`flex items-center justify-between px-2.5 py-2 rounded-lg text-sm font-bold ${
                            atsConf === 'low'
                              ? 'bg-gray-100 text-gray-400'
                              : atsConf === 'high'
                                ? 'bg-green-600 text-white'
                                : 'bg-blue-500 text-white'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <img src={getLogoUrl(pickHomeSpread ? home : away)} alt="" className="w-5 h-5 object-contain" />
                            <span>{pickHomeSpread ? home : away}</span>
                          </div>
                          <span className="font-mono">{formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}</span>
                        </div>
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          spreadResult === 'win' ? 'bg-green-500' : spreadResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {spreadResult === 'win' ? '✓' : spreadResult === 'loss' ? '✗' : '–'}
                        </div>
                      </div>
                    </div>

                    {/* Moneyline */}
                    <div className="p-3">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">
                        Moneyline
                      </div>
                      <div className="relative">
                        <div
                          className={`flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-bold ${
                            mlConf === 'high'
                              ? 'bg-green-600 text-white'
                              : mlConf === 'medium'
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          <img src={getLogoUrl(pickHomeML ? home : away)} alt="" className="w-5 h-5 object-contain" />
                          <span>{pickHomeML ? home : away}</span>
                        </div>
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          mlResult === 'win' ? 'bg-green-500' : 'bg-red-500'
                        }`}>
                          {mlResult === 'win' ? '✓' : '✗'}
                        </div>
                      </div>
                    </div>

                    {/* Over/Under */}
                    <div className="p-3">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">
                        Total
                      </div>
                      <div className="relative">
                        <div
                          className={`px-2.5 py-2 rounded-lg text-sm font-bold text-center ${
                            ouConf === 'high'
                              ? 'bg-green-600 text-white'
                              : ouConf === 'medium'
                                ? 'bg-blue-500 text-white'
                                : 'bg-gray-100 text-gray-400'
                          }`}
                        >
                          {pickOver ? 'OVER' : 'UNDER'} {Math.round(displayTotal * 2) / 2}
                        </div>
                        <div className={`absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-xs text-white font-bold ${
                          ouResult === 'win' ? 'bg-green-500' : ouResult === 'loss' ? 'bg-red-500' : 'bg-gray-400'
                        }`}>
                          {ouResult === 'win' ? '✓' : ouResult === 'loss' ? '✗' : '–'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        </>
      )}

      <div className="mt-8 text-xs text-gray-500">
        {cronHealth?.error ? (
          <span>Data status unavailable.</span>
        ) : (
          <span>
            Data up-to-date as of {formatHealthTime(cronHealth?.nfl?.lastBlobWriteAt)} (NFL) and{' '}
            {formatHealthTime(cronHealth?.nba?.lastBlobWriteAt)} (NBA).
          </span>
        )}
      </div>
    </div>
  );
}
