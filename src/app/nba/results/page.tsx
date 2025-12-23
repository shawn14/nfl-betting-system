'use client';

import { useState, useEffect } from 'react';

interface BacktestResult {
  gameId: string;
  gameTime: string;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  predictedHomeScore: number;
  predictedAwayScore: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  actualHomeScore: number;
  actualAwayScore: number;
  actualSpread: number;
  actualTotal: number;
  homeWon: boolean;
  spreadPick: 'home' | 'away';
  spreadResult?: 'win' | 'loss' | 'push';
  mlPick: 'home' | 'away';
  mlResult: 'win' | 'loss';
  ouPick?: 'over' | 'under';
  ouResult?: 'win' | 'loss' | 'push';
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
}

interface VegasStats {
  ats: { wins: number; losses: number; pushes: number; winPct: number; gamesWithOdds: number };
  ouVegas: { wins: number; losses: number; pushes: number; winPct: number; gamesWithOdds: number };
}

interface Summary {
  totalGames: number;
  spread: { wins: number; losses: number; pushes: number; winPct: number };
  moneyline: { wins: number; losses: number; winPct: number };
  overUnder: { wins: number; losses: number; pushes: number; winPct: number };
}

interface Analysis {
  summary: {
    totalGames: number;
    avgSpreadError: number;
    medianSpreadError: number;
    avgPredictedMargin: number;
    avgActualMargin: number;
    directionAccuracy: number;
  };
  byPickType: {
    home: { wins: number; losses: number; pushes: number; winPct: number };
    away: { wins: number; losses: number; pushes: number; winPct: number };
  };
  bySpreadSize: {
    small: { wins: number; losses: number; pushes: number; winPct: number; range: string };
    medium: { wins: number; losses: number; pushes: number; winPct: number; range: string };
    large: { wins: number; losses: number; pushes: number; winPct: number; range: string };
  };
  biggestMisses: Array<{
    game: string;
    date: string;
    predictedSpread: number;
    actualSpread: number;
    error: number;
    ourPick: string;
    result: string;
  }>;
  insights: string[];
}

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nba/500-dark/${abbr.toLowerCase()}.png`;
};

interface HighConvictionStats {
  ats: { wins: number; losses: number; pushes: number; winPct: number; total: number };
  ou: { wins: number; losses: number; pushes: number; winPct: number; total: number };
  ml: { wins: number; losses: number; winPct: number; total: number };
}

function computeHighConvictionStats(results: BacktestResult[]): HighConvictionStats {
  let atsW = 0, atsL = 0, atsP = 0;
  let ouW = 0, ouL = 0, ouP = 0;
  let mlW = 0, mlL = 0;

  for (const r of results) {
    // Calculate confidence based on edge (NBA thresholds)
    const spreadEdge = r.vegasSpread !== undefined ? Math.abs(r.predictedSpread - r.vegasSpread) : 0;
    const totalEdge = r.vegasTotal !== undefined ? Math.abs(r.predictedTotal - r.vegasTotal) : 0;
    const mlEdge = Math.abs(r.homeWinProb - 0.5) * 100;

    // High conviction ATS (edge >= 2.5 pts for NBA)
    if (spreadEdge >= 2.5 && r.atsResult) {
      if (r.atsResult === 'win') atsW++;
      else if (r.atsResult === 'loss') atsL++;
      else atsP++;
    }

    // High conviction O/U (edge >= 5 pts)
    if (totalEdge >= 5 && r.ouVegasResult) {
      if (r.ouVegasResult === 'win') ouW++;
      else if (r.ouVegasResult === 'loss') ouL++;
      else ouP++;
    }

    // High conviction ML (edge >= 15%)
    if (mlEdge >= 15 && r.mlResult) {
      if (r.mlResult === 'win') mlW++;
      else mlL++;
    }
  }

  const atsTotal = atsW + atsL;
  const ouTotal = ouW + ouL;
  const mlTotal = mlW + mlL;

  return {
    ats: { wins: atsW, losses: atsL, pushes: atsP, winPct: atsTotal > 0 ? Math.round((atsW / atsTotal) * 1000) / 10 : 0, total: atsW + atsL + atsP },
    ou: { wins: ouW, losses: ouL, pushes: ouP, winPct: ouTotal > 0 ? Math.round((ouW / ouTotal) * 1000) / 10 : 0, total: ouW + ouL + ouP },
    ml: { wins: mlW, losses: mlL, winPct: mlTotal > 0 ? Math.round((mlW / mlTotal) * 1000) / 10 : 0, total: mlTotal },
  };
}

function computeVegasStats(results: BacktestResult[]): VegasStats {
  let atsWins = 0, atsLosses = 0, atsPushes = 0;
  let ouWins = 0, ouLosses = 0, ouPushes = 0;
  let gamesWithSpreadOdds = 0, gamesWithTotalOdds = 0;

  for (const r of results) {
    if (r.vegasSpread !== undefined && r.vegasSpread !== null) {
      gamesWithSpreadOdds++;
      if (r.atsResult === 'win') atsWins++;
      else if (r.atsResult === 'loss') atsLosses++;
      else if (r.atsResult === 'push') atsPushes++;
    }

    if (r.vegasTotal !== undefined && r.vegasTotal !== null && r.vegasTotal > 0) {
      gamesWithTotalOdds++;
      if (r.ouVegasResult) {
        if (r.ouVegasResult === 'win') ouWins++;
        else if (r.ouVegasResult === 'loss') ouLosses++;
        else ouPushes++;
      } else {
        const actualTotal = r.actualTotal;
        const vegasTotal = r.vegasTotal;
        const predictedTotal = r.predictedTotal;
        const pickOver = predictedTotal > vegasTotal;

        if (pickOver) {
          if (actualTotal > vegasTotal) ouWins++;
          else if (actualTotal < vegasTotal) ouLosses++;
          else ouPushes++;
        } else {
          if (actualTotal < vegasTotal) ouWins++;
          else if (actualTotal > vegasTotal) ouLosses++;
          else ouPushes++;
        }
      }
    }
  }

  const atsTotal = atsWins + atsLosses;
  const ouTotal = ouWins + ouLosses;

  return {
    ats: {
      wins: atsWins,
      losses: atsLosses,
      pushes: atsPushes,
      winPct: atsTotal > 0 ? Math.round((atsWins / atsTotal) * 1000) / 10 : 0,
      gamesWithOdds: gamesWithSpreadOdds,
    },
    ouVegas: {
      wins: ouWins,
      losses: ouLosses,
      pushes: ouPushes,
      winPct: ouTotal > 0 ? Math.round((ouWins / ouTotal) * 1000) / 10 : 0,
      gamesWithOdds: gamesWithTotalOdds,
    },
  };
}

function computeAnalysis(results: BacktestResult[]): Analysis {
  const homePicks = { wins: 0, losses: 0, pushes: 0 };
  const awayPicks = { wins: 0, losses: 0, pushes: 0 };
  const smallSpread = { wins: 0, losses: 0, pushes: 0 };
  const mediumSpread = { wins: 0, losses: 0, pushes: 0 };
  const largeSpread = { wins: 0, losses: 0, pushes: 0 };
  const spreadErrors: number[] = [];
  const predictedMargins: number[] = [];
  const actualMargins: number[] = [];
  let correctDirection = 0;
  let wrongDirection = 0;

  const biggestMisses: Analysis['biggestMisses'] = [];

  for (const r of results) {
    const spreadResult = r.spreadResult;
    const predictedMargin = Math.abs(r.predictedSpread);
    const actualMargin = Math.abs(r.actualSpread);
    const spreadError = Math.abs(r.predictedSpread - r.actualSpread);

    spreadErrors.push(spreadError);
    predictedMargins.push(predictedMargin);
    actualMargins.push(actualMargin);

    const predictedWinner = r.predictedSpread < 0 ? 'home' : 'away';
    const actualWinner = r.actualSpread < 0 ? 'home' : r.actualSpread > 0 ? 'away' : 'tie';
    if (actualWinner !== 'tie') {
      if (predictedWinner === actualWinner) correctDirection++;
      else wrongDirection++;
    }

    if (r.spreadPick === 'home') {
      if (spreadResult === 'win') homePicks.wins++;
      else if (spreadResult === 'loss') homePicks.losses++;
      else homePicks.pushes++;
    } else {
      if (spreadResult === 'win') awayPicks.wins++;
      else if (spreadResult === 'loss') awayPicks.losses++;
      else awayPicks.pushes++;
    }

    // NBA spread sizes (different thresholds than NFL)
    if (predictedMargin < 4) {
      if (spreadResult === 'win') smallSpread.wins++;
      else if (spreadResult === 'loss') smallSpread.losses++;
      else smallSpread.pushes++;
    } else if (predictedMargin < 8) {
      if (spreadResult === 'win') mediumSpread.wins++;
      else if (spreadResult === 'loss') mediumSpread.losses++;
      else mediumSpread.pushes++;
    } else {
      if (spreadResult === 'win') largeSpread.wins++;
      else if (spreadResult === 'loss') largeSpread.losses++;
      else largeSpread.pushes++;
    }

    biggestMisses.push({
      game: `${r.awayTeam} @ ${r.homeTeam}`,
      date: new Date(r.gameTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      predictedSpread: Math.round(r.predictedSpread * 10) / 10,
      actualSpread: r.actualSpread,
      error: Math.round(spreadError * 10) / 10,
      ourPick: r.spreadPick === 'home' ? r.homeTeam : r.awayTeam,
      result: spreadResult || 'push',
    });
  }

  biggestMisses.sort((a, b) => b.error - a.error);

  spreadErrors.sort((a, b) => a - b);
  const avgSpreadError = spreadErrors.reduce((a, b) => a + b, 0) / spreadErrors.length;
  const medianSpreadError = spreadErrors[Math.floor(spreadErrors.length / 2)] || 0;
  const avgPredictedMargin = predictedMargins.reduce((a, b) => a + b, 0) / predictedMargins.length;
  const avgActualMargin = actualMargins.reduce((a, b) => a + b, 0) / actualMargins.length;

  const calcWinPct = (bucket: { wins: number; losses: number }) => {
    const total = bucket.wins + bucket.losses;
    return total > 0 ? Math.round((bucket.wins / total) * 1000) / 10 : 0;
  };

  const insights: string[] = [];
  const homeWinPct = calcWinPct(homePicks);
  const awayWinPct = calcWinPct(awayPicks);
  if (Math.abs(homeWinPct - awayWinPct) > 5) {
    if (homeWinPct > awayWinPct) {
      insights.push(`Home picks outperform away picks (${homeWinPct}% vs ${awayWinPct}%).`);
    } else {
      insights.push(`Away picks outperform home picks (${awayWinPct}% vs ${homeWinPct}%).`);
    }
  }
  const smallWinPct = calcWinPct(smallSpread);
  const mediumWinPct = calcWinPct(mediumSpread);
  const largeWinPct = calcWinPct(largeSpread);
  const bestSize = smallWinPct > mediumWinPct && smallWinPct > largeWinPct ? 'small' :
                   mediumWinPct > largeWinPct ? 'medium' : 'large';
  const bestPct = bestSize === 'small' ? smallWinPct : bestSize === 'medium' ? mediumWinPct : largeWinPct;
  if (bestPct > 55) {
    insights.push(`${bestSize.charAt(0).toUpperCase() + bestSize.slice(1)} spreads perform best at ${bestPct}%.`);
  }

  return {
    summary: {
      totalGames: results.length,
      avgSpreadError: Math.round(avgSpreadError * 10) / 10,
      medianSpreadError: Math.round(medianSpreadError * 10) / 10,
      avgPredictedMargin: Math.round(avgPredictedMargin * 10) / 10,
      avgActualMargin: Math.round(avgActualMargin * 10) / 10,
      directionAccuracy: Math.round((correctDirection / (correctDirection + wrongDirection)) * 1000) / 10,
    },
    byPickType: {
      home: { ...homePicks, winPct: homeWinPct },
      away: { ...awayPicks, winPct: awayWinPct },
    },
    bySpreadSize: {
      small: { ...smallSpread, winPct: smallWinPct, range: '0-4 pts' },
      medium: { ...mediumSpread, winPct: mediumWinPct, range: '4-8 pts' },
      large: { ...largeSpread, winPct: largeWinPct, range: '8+ pts' },
    },
    biggestMisses: biggestMisses.slice(0, 20),
    insights,
  };
}

export default function NBAResultsPage() {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [vegasStats, setVegasStats] = useState<VegasStats | null>(null);
  const [highConvStats, setHighConvStats] = useState<HighConvictionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const blobRes = await fetch('/nba-prediction-data.json', { cache: 'no-cache' });
        const blobData = await blobRes.json();
        const rawResults: BacktestResult[] = blobData.backtest?.results || [];
        const seen = new Set<string>();
        const backtestResults = rawResults.filter(r => {
          if (seen.has(r.gameId)) return false;
          seen.add(r.gameId);
          return true;
        });
        // Sort by date descending (most recent first)
        backtestResults.sort((a, b) => new Date(b.gameTime).getTime() - new Date(a.gameTime).getTime());
        setResults(backtestResults);
        setSummary(blobData.backtest?.summary || null);

        if (backtestResults.length > 0) {
          setAnalysis(computeAnalysis(backtestResults));
          setVegasStats(computeVegasStats(backtestResults));
          setHighConvStats(computeHighConvictionStats(backtestResults));
        }
      } catch (error) {
        console.error('Error fetching backtest:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchResults();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const ResultBadge = ({ result }: { result?: 'win' | 'loss' | 'push' }) => {
    if (!result) return <span className="text-gray-400">-</span>;
    const colors = {
      win: 'bg-green-600 text-white',
      loss: 'bg-red-500 text-white',
      push: 'bg-gray-400 text-white',
    };
    const labels = { win: 'W', loss: 'L', push: 'P' };
    return (
      <span className={`px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-bold ${colors[result]}`}>
        <span className="sm:hidden">{labels[result]}</span>
        <span className="hidden sm:inline">{result.toUpperCase()}</span>
      </span>
    );
  };

  const WinPctBadge = ({ pct, threshold = 52.4 }: { pct: number; threshold?: number }) => {
    const color = pct >= threshold ? 'text-green-600' : pct < (100 - threshold) ? 'text-red-600' : 'text-gray-500';
    return <span className={`font-mono font-bold ${color}`}>{pct}%</span>;
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex justify-between items-center border-b border-gray-200 pb-3 sm:pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">NBA Results</h1>
          <span className="bg-orange-100 text-orange-700 text-xs font-bold px-2 py-1 rounded">NBA</span>
        </div>
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className="px-3 sm:px-4 py-1.5 sm:py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors"
        >
          {showAnalysis ? 'Hide' : 'Analysis'}
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="space-y-4">
          {/* ATS vs Vegas */}
          {vegasStats && vegasStats.ats.gamesWithOdds > 0 && (
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-200 rounded-xl p-3 sm:p-4">
              <h2 className="text-orange-800 font-bold text-xs sm:text-sm mb-2 sm:mb-3">ATS vs Vegas</h2>
              <div className="grid grid-cols-2 gap-2 sm:gap-4">
                <div className="bg-white rounded-lg p-2.5 sm:p-4 border border-orange-200">
                  <div className="text-gray-600 text-[10px] sm:text-sm font-medium mb-0.5 sm:mb-1">Spread</div>
                  <div className="text-lg sm:text-2xl font-bold text-gray-900">
                    {vegasStats.ats.wins}-{vegasStats.ats.losses}
                    {vegasStats.ats.pushes > 0 && <span className="text-gray-400 text-base sm:text-2xl">-{vegasStats.ats.pushes}</span>}
                  </div>
                  <div className={`text-base sm:text-xl font-mono font-bold ${vegasStats.ats.winPct > 52.4 ? 'text-green-600' : vegasStats.ats.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                    {vegasStats.ats.winPct}%
                  </div>
                  <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{vegasStats.ats.gamesWithOdds} games</div>
                </div>

                <div className="bg-white rounded-lg p-2.5 sm:p-4 border border-orange-200">
                  <div className="text-gray-600 text-[10px] sm:text-sm font-medium mb-0.5 sm:mb-1">O/U</div>
                  <div className="text-lg sm:text-2xl font-bold text-gray-900">
                    {vegasStats.ouVegas.wins}-{vegasStats.ouVegas.losses}
                    {vegasStats.ouVegas.pushes > 0 && <span className="text-gray-400 text-base sm:text-2xl">-{vegasStats.ouVegas.pushes}</span>}
                  </div>
                  <div className={`text-base sm:text-xl font-mono font-bold ${vegasStats.ouVegas.winPct > 52.4 ? 'text-green-600' : vegasStats.ouVegas.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                    {vegasStats.ouVegas.winPct}%
                  </div>
                  <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{vegasStats.ouVegas.gamesWithOdds} games</div>
                </div>
              </div>
            </div>
          )}

          {/* High Conviction Only */}
          {highConvStats && (highConvStats.ats.total > 0 || highConvStats.ml.total > 0 || highConvStats.ou.total > 0) && (
            <div className="bg-gradient-to-r from-emerald-50 to-green-50 border border-green-300 rounded-xl p-3 sm:p-4">
              <h2 className="text-green-800 font-bold text-xs sm:text-sm mb-2 sm:mb-3 flex items-center gap-2">
                <span className="w-3 h-3 bg-green-600 rounded"></span>
                High Conviction Only
              </h2>
              <div className="grid grid-cols-3 gap-2 sm:gap-4">
                {highConvStats.ats.total > 0 && (
                  <div className="bg-white rounded-lg p-2.5 sm:p-4 border border-green-200">
                    <div className="text-gray-600 text-[10px] sm:text-sm font-medium mb-0.5 sm:mb-1">ATS</div>
                    <div className="text-lg sm:text-2xl font-bold text-gray-900">
                      {highConvStats.ats.wins}-{highConvStats.ats.losses}
                      {highConvStats.ats.pushes > 0 && <span className="text-gray-400 text-base sm:text-2xl">-{highConvStats.ats.pushes}</span>}
                    </div>
                    <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ats.winPct > 52.4 ? 'text-green-600' : highConvStats.ats.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                      {highConvStats.ats.winPct}%
                    </div>
                    <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{highConvStats.ats.total} picks</div>
                  </div>
                )}
                {highConvStats.ml.total > 0 && (
                  <div className="bg-white rounded-lg p-2.5 sm:p-4 border border-green-200">
                    <div className="text-gray-600 text-[10px] sm:text-sm font-medium mb-0.5 sm:mb-1">ML</div>
                    <div className="text-lg sm:text-2xl font-bold text-gray-900">
                      {highConvStats.ml.wins}-{highConvStats.ml.losses}
                    </div>
                    <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ml.winPct > 52.4 ? 'text-green-600' : highConvStats.ml.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                      {highConvStats.ml.winPct}%
                    </div>
                    <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{highConvStats.ml.total} picks</div>
                  </div>
                )}
                {highConvStats.ou.total > 0 && (
                  <div className="bg-white rounded-lg p-2.5 sm:p-4 border border-green-200">
                    <div className="text-gray-600 text-[10px] sm:text-sm font-medium mb-0.5 sm:mb-1">O/U</div>
                    <div className="text-lg sm:text-2xl font-bold text-gray-900">
                      {highConvStats.ou.wins}-{highConvStats.ou.losses}
                      {highConvStats.ou.pushes > 0 && <span className="text-gray-400 text-base sm:text-2xl">-{highConvStats.ou.pushes}</span>}
                    </div>
                    <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ou.winPct > 52.4 ? 'text-green-600' : highConvStats.ou.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                      {highConvStats.ou.winPct}%
                    </div>
                    <div className="text-[9px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">{highConvStats.ou.total} picks</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Directional Accuracy */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 sm:p-4">
            <h2 className="text-gray-600 font-bold text-xs sm:text-sm mb-2 sm:mb-3">Directional Accuracy</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="bg-white rounded-lg p-2 sm:p-4 border border-gray-200">
                <div className="text-gray-500 text-[9px] sm:text-xs font-medium mb-0.5 sm:mb-1">Spread</div>
                <div className="text-sm sm:text-xl font-bold text-gray-900">
                  {summary.spread.wins}-{summary.spread.losses}
                  {summary.spread.pushes > 0 && <span className="text-gray-400 text-xs sm:text-lg">-{summary.spread.pushes}</span>}
                </div>
                <div className={`text-sm sm:text-lg font-mono font-bold ${summary.spread.winPct > 52.4 ? 'text-green-600' : summary.spread.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                  {summary.spread.winPct}%
                </div>
              </div>

              <div className="bg-white rounded-lg p-2 sm:p-4 border border-gray-200">
                <div className="text-gray-500 text-[9px] sm:text-xs font-medium mb-0.5 sm:mb-1">ML</div>
                <div className="text-sm sm:text-xl font-bold text-gray-900">
                  {summary.moneyline.wins}-{summary.moneyline.losses}
                </div>
                <div className={`text-sm sm:text-lg font-mono font-bold ${summary.moneyline.winPct > 50 ? 'text-green-600' : 'text-red-500'}`}>
                  {summary.moneyline.winPct}%
                </div>
              </div>

              <div className="bg-white rounded-lg p-2 sm:p-4 border border-gray-200">
                <div className="text-gray-500 text-[9px] sm:text-xs font-medium mb-0.5 sm:mb-1">O/U</div>
                <div className="text-sm sm:text-xl font-bold text-gray-900">
                  {summary.overUnder.wins}-{summary.overUnder.losses}
                  {summary.overUnder.pushes > 0 && <span className="text-gray-400 text-xs sm:text-lg">-{summary.overUnder.pushes}</span>}
                </div>
                <div className={`text-sm sm:text-lg font-mono font-bold ${summary.overUnder.winPct > 52.4 ? 'text-green-600' : summary.overUnder.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                  {summary.overUnder.winPct}%
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Section */}
      {showAnalysis && analysis && (
        <div className="space-y-4">
          {analysis.insights.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h3 className="font-bold text-amber-800 mb-2">Key Insights</h3>
              <ul className="space-y-1 text-sm">
                {analysis.insights.map((insight, i) => (
                  <li key={i} className="text-amber-700">{insight}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="text-gray-500 text-xs font-medium mb-1">Avg Spread Error</div>
              <div className="text-2xl font-bold text-gray-900">{analysis.summary.avgSpreadError} pts</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="text-gray-500 text-xs font-medium mb-1">Median Error</div>
              <div className="text-2xl font-bold text-gray-900">{analysis.summary.medianSpreadError} pts</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="text-gray-500 text-xs font-medium mb-1">Direction Accuracy</div>
              <div className="text-2xl font-bold text-green-600">{analysis.summary.directionAccuracy}%</div>
              <div className="text-xs text-gray-400">Picking winners</div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="text-gray-500 text-xs font-medium mb-1">Avg Margins</div>
              <div className="text-lg font-bold text-gray-900">
                <span>Pred: {analysis.summary.avgPredictedMargin}</span>
                <span className="text-gray-300 mx-1">|</span>
                <span>Act: {analysis.summary.avgActualMargin}</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-3">By Pick Type</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Home Picks</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.byPickType.home.wins}-{analysis.byPickType.home.losses}</span>
                    <WinPctBadge pct={analysis.byPickType.home.winPct} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Away Picks</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.byPickType.away.wins}-{analysis.byPickType.away.losses}</span>
                    <WinPctBadge pct={analysis.byPickType.away.winPct} />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <h3 className="font-bold text-gray-900 mb-3">By Predicted Spread Size</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Small ({analysis.bySpreadSize.small.range})</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.bySpreadSize.small.wins}-{analysis.bySpreadSize.small.losses}</span>
                    <WinPctBadge pct={analysis.bySpreadSize.small.winPct} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Medium ({analysis.bySpreadSize.medium.range})</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.bySpreadSize.medium.wins}-{analysis.bySpreadSize.medium.losses}</span>
                    <WinPctBadge pct={analysis.bySpreadSize.medium.winPct} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Large ({analysis.bySpreadSize.large.range})</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.bySpreadSize.large.wins}-{analysis.bySpreadSize.large.losses}</span>
                    <WinPctBadge pct={analysis.bySpreadSize.large.winPct} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Biggest Misses */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-3">Biggest Spread Misses</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-left border-b border-gray-200">
                  <tr>
                    <th className="pb-2 font-medium">Game</th>
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 text-right font-medium">Predicted</th>
                    <th className="pb-2 text-right font-medium">Actual</th>
                    <th className="pb-2 text-right font-medium">Error</th>
                    <th className="pb-2 font-medium">Pick</th>
                    <th className="pb-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analysis.biggestMisses.slice(0, 10).map((miss, i) => (
                    <tr key={i}>
                      <td className="py-2 text-gray-900">{miss.game}</td>
                      <td className="py-2 text-gray-600">{miss.date}</td>
                      <td className="py-2 text-right font-mono text-gray-900">{miss.predictedSpread > 0 ? '+' : ''}{miss.predictedSpread}</td>
                      <td className="py-2 text-right font-mono text-gray-900">{miss.actualSpread > 0 ? '+' : ''}{miss.actualSpread}</td>
                      <td className="py-2 text-right font-mono text-red-500 font-bold">{miss.error}</td>
                      <td className="py-2 text-gray-700">{miss.ourPick}</td>
                      <td className="py-2">
                        <ResultBadge result={miss.result as 'win' | 'loss' | 'push'} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm min-w-[600px]">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-left font-semibold">Game</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-semibold">Pred</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-semibold">Actual</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-semibold">ATS</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-semibold">ML</th>
                <th className="px-2 sm:px-4 py-2 sm:py-3 text-center font-semibold">O/U</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((game) => (
                <tr key={game.gameId} className="hover:bg-gray-50">
                  <td className="px-2 sm:px-4 py-2 sm:py-3">
                    <div className="flex items-center gap-1 sm:gap-2">
                      <img src={getLogoUrl(game.awayTeam)} alt="" className="w-4 h-4 sm:w-6 sm:h-6" />
                      <img src={getLogoUrl(game.homeTeam)} alt="" className="w-4 h-4 sm:w-6 sm:h-6" />
                      <div>
                        <div className="font-semibold text-gray-900 text-[11px] sm:text-sm">{game.awayTeam}@{game.homeTeam}</div>
                        <div className="text-[9px] sm:text-xs text-gray-500">
                          {formatDate(game.gameTime)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                    <div className="font-mono text-gray-900 text-[11px] sm:text-sm">{Math.round(game.predictedAwayScore)}-{Math.round(game.predictedHomeScore)}</div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                    <div className="font-mono font-bold text-gray-900 text-[11px] sm:text-sm">{game.actualAwayScore}-{game.actualHomeScore}</div>
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                    <ResultBadge result={game.spreadResult} />
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                    <ResultBadge result={game.mlResult} />
                  </td>
                  <td className="px-2 sm:px-4 py-2 sm:py-3 text-center">
                    <ResultBadge result={game.ouResult} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {results.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-500 py-12">
          No completed games to analyze yet.
        </div>
      )}
    </div>
  );
}
