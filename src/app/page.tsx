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
  spreadEdge?: number;
  totalEdge?: number;
  atsConfidence?: 'high' | 'medium' | 'low';
  ouConfidence?: 'high' | 'medium' | 'low';
  isAtsBestBet?: boolean;
  isOuBestBet?: boolean;
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

export default function Dashboard() {
  const [games, setGames] = useState<GameWithPrediction[]>([]);
  const [recentGames, setRecentGames] = useState<Game[]>([]);
  const [liveGames, setLiveGames] = useState<LiveGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showBestBets, setShowBestBets] = useState(true);
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
      // Fetch live scores
      fetchLiveScores();
    };
    init();

    // Refresh live scores every 30 seconds
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

      {/* Best Bets Section - Collapsible */}
      {games.filter(g => g.prediction.isAtsBestBet || g.prediction.isOuBestBet).length > 0 && (
        <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border border-green-200 overflow-hidden">
          <button
            onClick={() => setShowBestBets(!showBestBets)}
            className="w-full flex items-center justify-between p-3 hover:bg-green-100/50 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">🎯</span>
              <h2 className="text-sm font-bold text-green-800 uppercase tracking-wide">Best Bets</h2>
              <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded-full">
                {games.filter(g => g.prediction.isAtsBestBet || g.prediction.isOuBestBet).length} picks
              </span>
            </div>
            <svg
              className={`w-5 h-5 text-green-600 transition-transform ${showBestBets ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showBestBets && (
          <div className="px-4 pb-4">
          <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {games.filter(g => g.prediction.isAtsBestBet || g.prediction.isOuBestBet).map(({ game, prediction }) => {
              const away = game.awayTeam?.abbreviation || 'AWAY';
              const home = game.homeTeam?.abbreviation || 'HOME';
              const pickHomeSpread = prediction.predictedSpread < 0;
              const displaySpread = prediction.vegasSpread ?? prediction.predictedSpread;
              const displayTotal = prediction.vegasTotal ?? prediction.predictedTotal;
              const pickOver = prediction.predictedTotal > (prediction.vegasTotal ?? 44);

              // Situation badges
              const situations: string[] = [];
              if (prediction.isDivisional) situations.push('DIV');
              if (prediction.isLateSeasonGame) situations.push('LATE SZN');
              if (prediction.isLargeSpread) situations.push('BIG LINE');
              if (prediction.isSmallSpread) situations.push('CLOSE');
              if (prediction.isEloMismatch) situations.push('MISMATCH');

              return (
                <div key={`best-${game.id}`} className="bg-white rounded-lg p-3 shadow-sm border border-green-100">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <img src={getLogoUrl(away)} alt={away} className="w-5 h-5 object-contain" />
                      <span className="text-xs text-gray-500">@</span>
                      <img src={getLogoUrl(home)} alt={home} className="w-5 h-5 object-contain" />
                    </div>
                    <span className="text-[10px] text-gray-400">{formatTime(game.gameTime).split(',')[0]}</span>
                  </div>
                  {/* Situation badges */}
                  {situations.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {situations.map(s => (
                        <span key={s} className="text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {prediction.isAtsBestBet && (
                      <div className="flex-1 bg-green-100 rounded px-2 py-1.5 text-center">
                        <div className="text-[10px] text-green-600 font-medium">ATS</div>
                        <div className="text-sm font-bold text-green-800">
                          {pickHomeSpread ? home : away} {formatSpread(pickHomeSpread ? displaySpread : -displaySpread)}
                        </div>
                      </div>
                    )}
                    {prediction.isOuBestBet && (
                      <div className="flex-1 bg-green-100 rounded px-2 py-1.5 text-center">
                        <div className="text-[10px] text-green-600 font-medium">TOTAL</div>
                        <div className="text-sm font-bold text-green-800">
                          {pickOver ? 'OVER' : 'UNDER'} {Math.round(displayTotal * 2) / 2}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[10px] text-green-600">
            Based on 169 games: Divisional 61.5% • Late Season 62.9% • Large Spreads 61.7% • Small Spreads 60% • Elo Mismatch 61.4%
          </div>
          </div>
        )}
        </div>
      )}

      {/* Upcoming Picks Header */}
      <div className="flex justify-between items-center border-b border-gray-200 pb-3">
        <h1 className="text-xl font-bold text-gray-900">This Week's Picks</h1>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-green-600 rounded-full"></span> High conf</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-yellow-500 rounded-full"></span> Medium</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded-full"></span> Low</span>
        </div>
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
            const ourSpread = prediction.predictedSpread;
            const ourTotal = prediction.predictedTotal;
            const homeWinProb = prediction.homeWinProbability;

            // Use Vegas lines if available, otherwise use our predictions
            const displaySpread = prediction.vegasSpread ?? ourSpread;
            const displayTotal = prediction.vegasTotal ?? ourTotal;
            const hasVegas = prediction.vegasSpread !== undefined;

            // Spread pick: negative spread = home favored, we pick based on our prediction
            // If our spread is more negative than Vegas, we like home more (pick home)
            const spreadEdge = hasVegas ? (prediction.vegasSpread! - ourSpread) : 0;
            const pickHomeSpread = ourSpread < 0; // We pick home if we predict home favored
            const spreadStrong = hasVegas ? Math.abs(spreadEdge) >= 2.5 : Math.abs(ourSpread) >= 3;

            // ML pick: based on win probability
            const pickHomeML = homeWinProb > 0.5;
            const mlStrong = homeWinProb > 0.6 || homeWinProb < 0.4;

            // O/U pick: if our total > 44 (league avg), pick over
            const totalEdge = hasVegas ? (ourTotal - prediction.vegasTotal!) : 0;
            const pickOver = ourTotal > 44;
            const ouStrong = hasVegas ? Math.abs(totalEdge) >= 2.5 : Math.abs(ourTotal - 44) >= 3;

            // Confidence indicators
            const atsConf = prediction.atsConfidence || 'medium';
            const ouConf = prediction.ouConfidence || 'medium';

            // 60%+ situation badges
            const situations: string[] = [];
            if (prediction.isDivisional) situations.push('DIV');
            if (prediction.isLateSeasonGame) situations.push('LATE SZN');
            if (prediction.isLargeSpread) situations.push('BIG LINE');
            if (prediction.isSmallSpread) situations.push('CLOSE');
            if (prediction.isEloMismatch) situations.push('MISMATCH');

            return (
              <div key={game.id} className={`bg-white rounded-xl border shadow-sm overflow-hidden hover:shadow-md transition-shadow ${
                atsConf === 'low' ? 'border-red-200' : prediction.sixtyPlusFactors && prediction.sixtyPlusFactors >= 2 ? 'border-green-300' : 'border-gray-200'
              }`}>
                {/* 60%+ situation highlight */}
                {situations.length > 0 && atsConf !== 'low' && (
                  <div className="bg-green-50 px-3 py-1.5 flex items-center gap-2">
                    <span className="text-[10px] text-green-700 font-medium">60%+ ATS:</span>
                    <div className="flex flex-wrap gap-1">
                      {situations.map(s => (
                        <span key={s} className="text-[9px] font-bold text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {/* Low confidence warning - medium spreads are 46.7% ATS */}
                {atsConf === 'low' && (
                  <div className="bg-red-50 px-3 py-1.5 text-[10px] text-red-600 font-medium flex items-center gap-1">
                    <span>⚠️</span> Medium spread (3.5-6.5) - historically 46.7% ATS - AVOID
                  </div>
                )}
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
                      <div className="flex items-center text-gray-400 group-hover:text-red-600 transition-colors">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </a>

                {/* Weather info */}
                {prediction.weather && (
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-3">
                      <span className="text-base">{getWeatherIcon(prediction.weather.conditions)}</span>
                      <span className="text-gray-600 capitalize">{prediction.weather.conditions}</span>
                      <span className="text-gray-400">|</span>
                      <span className="text-gray-600">{prediction.weather.temperature}°F</span>
                      {prediction.weather.windSpeed > 0 && (
                        <>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">{prediction.weather.windSpeed} mph wind</span>
                        </>
                      )}
                      {prediction.weather.precipitation > 0 && (
                        <>
                          <span className="text-gray-400">|</span>
                          <span className="text-gray-600">{prediction.weather.precipitation}% precip</span>
                        </>
                      )}
                    </div>
                    {(prediction.weatherImpact ?? 0) > 0 && (
                      <span className={`font-medium ${getWeatherImpactColor(prediction.weatherImpact ?? 0)}`}>
                        -{((prediction.weatherImpact ?? 0) * 3).toFixed(1)} pts adj
                      </span>
                    )}
                  </div>
                )}

                {/* Injury info - from NFL.com */}
                {prediction.injuries && prediction.injuries.impactLevel !== 'none' && (
                  <div className={`px-4 py-2 border-b border-gray-100 flex items-center justify-between text-xs ${
                    prediction.injuries.impactLevel === 'major' ? 'bg-red-50' :
                    prediction.injuries.impactLevel === 'significant' ? 'bg-orange-50' : 'bg-yellow-50'
                  }`}>
                    <div className="flex items-center gap-4">
                      <span className="text-base">🏥</span>
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <img src={getLogoUrl(away)} alt="" className="w-4 h-4 object-contain" />
                          <span className={prediction.injuries.awayInjuries.hasQBOut ? 'text-red-600 font-medium' : 'text-gray-600'}>
                            {prediction.injuries.awayInjuries.summary}
                          </span>
                        </div>
                        <span className="text-gray-300">|</span>
                        <div className="flex items-center gap-1.5">
                          <img src={getLogoUrl(home)} alt="" className="w-4 h-4 object-contain" />
                          <span className={prediction.injuries.homeInjuries.hasQBOut ? 'text-red-600 font-medium' : 'text-gray-600'}>
                            {prediction.injuries.homeInjuries.summary}
                          </span>
                        </div>
                      </div>
                    </div>
                    {(prediction.injuries.homeInjuries.hasQBOut || prediction.injuries.awayInjuries.hasQBOut) && (
                      <span className="text-red-600 font-bold text-[10px] bg-red-100 px-1.5 py-0.5 rounded">
                        QB OUT
                      </span>
                    )}
                  </div>
                )}

                {/* Vegas line status */}
                {hasVegas && (
                  <div className="px-4 py-1.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between text-[10px]">
                    <span className="text-gray-500">Vegas Lines</span>
                    {prediction.oddsLockedAt ? (
                      <span className="text-green-600 font-medium flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        Locked {new Date(prediction.oddsLockedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </span>
                    ) : (
                      <span className="text-gray-400">Live - locks 1hr before game</span>
                    )}
                  </div>
                )}

                {/* Picks grid */}
                <div className="grid grid-cols-3 divide-x divide-gray-100">
                  {/* Spread */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex items-center justify-center gap-1">
                      Spread
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        atsConf === 'high' ? 'bg-green-500' : atsConf === 'medium' ? 'bg-yellow-500' : 'bg-red-400'
                      }`}></span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-sm font-medium ${
                          !pickHomeSpread
                            ? spreadStrong
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <img src={getLogoUrl(away)} alt="" className="w-4 h-4 object-contain" />
                          <span>{away}</span>
                        </div>
                        <span className="font-mono">{formatSpread(-displaySpread)}</span>
                      </div>
                      <div
                        className={`flex items-center justify-between px-2 py-1.5 rounded-lg text-sm font-medium ${
                          pickHomeSpread
                            ? spreadStrong
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <img src={getLogoUrl(home)} alt="" className="w-4 h-4 object-contain" />
                          <span>{home}</span>
                        </div>
                        <span className="font-mono">{formatSpread(displaySpread)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Moneyline */}
                  <div className="p-3">
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center">Moneyline</div>
                    <div className="flex flex-col gap-1.5">
                      <div
                        className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-sm font-medium ${
                          !pickHomeML
                            ? mlStrong
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
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
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
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
                    <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 text-center flex items-center justify-center gap-1">
                      Total
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        ouConf === 'high' ? 'bg-green-500' : ouConf === 'medium' ? 'bg-yellow-500' : 'bg-red-400'
                      }`}></span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <div
                        className={`px-2 py-1.5 rounded-lg text-sm font-medium text-center ${
                          pickOver
                            ? ouStrong
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        O {Math.round(displayTotal * 2) / 2}
                      </div>
                      <div
                        className={`px-2 py-1.5 rounded-lg text-sm font-medium text-center ${
                          !pickOver
                            ? ouStrong
                              ? 'bg-green-700 text-white'
                              : 'bg-green-100 text-green-800 ring-1 ring-green-300'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        U {Math.round(displayTotal * 2) / 2}
                      </div>
                    </div>
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
