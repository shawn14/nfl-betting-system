'use client';

import { useState, useEffect } from 'react';

interface BacktestResult {
  gameId: string;
  gameTime: string;
  week?: number;
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
  // Vegas odds data
  vegasSpread?: number;
  vegasTotal?: number;
  atsResult?: 'win' | 'loss' | 'push';
  ouVegasResult?: 'win' | 'loss' | 'push';
  // 60%+ situation flags
  isDivisional?: boolean;
  isLateSeasonGame?: boolean;
  isLargeSpread?: boolean;
  isSmallSpread?: boolean;
  isMediumSpread?: boolean;
  isEloMismatch?: boolean;
}

interface VegasStats {
  ats: { wins: number; losses: number; pushes: number; winPct: number; gamesWithOdds: number };
  ouVegas: { wins: number; losses: number; pushes: number; winPct: number; gamesWithOdds: number };
}

interface SituationStats {
  name: string;
  wins: number;
  losses: number;
  pushes: number;
  winPct: number;
  total: number;
  badge: string;
  highlight: boolean;
}

function computeSituationStats(results: BacktestResult[]): SituationStats[] {
  const situations = {
    divisional: { name: 'Divisional Games', wins: 0, losses: 0, pushes: 0, badge: 'DIV' },
    lateSeason: { name: 'Late Season (Wk 13+)', wins: 0, losses: 0, pushes: 0, badge: 'LATE SZN' },
    largeSpread: { name: 'Large Spread (≥7)', wins: 0, losses: 0, pushes: 0, badge: 'BIG LINE' },
    smallSpread: { name: 'Small Spread (≤3)', wins: 0, losses: 0, pushes: 0, badge: 'CLOSE' },
    mediumSpread: { name: 'Medium Spread (3.5-6.5)', wins: 0, losses: 0, pushes: 0, badge: 'AVOID' },
    eloMismatch: { name: 'Elo Mismatch (>100)', wins: 0, losses: 0, pushes: 0, badge: 'MISMATCH' },
  };

  for (const r of results) {
    if (!r.atsResult || r.vegasSpread === undefined) continue;

    const addResult = (key: keyof typeof situations) => {
      if (r.atsResult === 'win') situations[key].wins++;
      else if (r.atsResult === 'loss') situations[key].losses++;
      else situations[key].pushes++;
    };

    if (r.isDivisional) addResult('divisional');
    if (r.isLateSeasonGame) addResult('lateSeason');
    if (r.isLargeSpread) addResult('largeSpread');
    if (r.isSmallSpread) addResult('smallSpread');
    if (r.isMediumSpread) addResult('mediumSpread');
    if (r.isEloMismatch) addResult('eloMismatch');
  }

  return Object.values(situations).map(s => {
    const total = s.wins + s.losses;
    const winPct = total > 0 ? Math.round((s.wins / total) * 1000) / 10 : 0;
    return {
      ...s,
      total: s.wins + s.losses + s.pushes,
      winPct,
      highlight: winPct >= 60 || (s.badge === 'AVOID' && winPct < 50),
    };
  }).filter(s => s.total > 0);
}

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
    // High conviction = same criteria for ALL bet types (ATS spread edge >= 2 pts)
    const spreadEdge = r.vegasSpread !== undefined ? Math.abs(r.predictedSpread - r.vegasSpread) : 0;
    const highConv = spreadEdge >= 2;

    if (highConv) {
      // ATS result
      if (r.atsResult) {
        if (r.atsResult === 'win') atsW++;
        else if (r.atsResult === 'loss') atsL++;
        else atsP++;
      }

      // O/U result (same high conviction games)
      if (r.ouVegasResult) {
        if (r.ouVegasResult === 'win') ouW++;
        else if (r.ouVegasResult === 'loss') ouL++;
        else ouP++;
      }

      // ML result (same high conviction games)
      if (r.mlResult) {
        if (r.mlResult === 'win') mlW++;
        else mlL++;
      }
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
    // ATS vs Vegas
    if (r.vegasSpread !== undefined && r.vegasSpread !== null) {
      gamesWithSpreadOdds++;
      if (r.atsResult === 'win') atsWins++;
      else if (r.atsResult === 'loss') atsLosses++;
      else if (r.atsResult === 'push') atsPushes++;
    }

    // O/U vs Vegas
    if (r.vegasTotal !== undefined && r.vegasTotal !== null && r.vegasTotal > 0) {
      gamesWithTotalOdds++;
      // Use stored result if available, otherwise calculate
      if (r.ouVegasResult) {
        if (r.ouVegasResult === 'win') ouWins++;
        else if (r.ouVegasResult === 'loss') ouLosses++;
        else ouPushes++;
      } else {
        // Fallback: calculate O/U result vs Vegas total
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
  byActualMargin: {
    closeGames: { wins: number; losses: number; pushes: number; winPct: number; range: string };
    blowouts: { wins: number; losses: number; pushes: number; winPct: number; range: string };
  };
  weeklyPerformance: Array<{ week: number; wins: number; losses: number; pushes: number; winPct: number }>;
  biggestMisses: Array<{
    game: string;
    week: number;
    predictedSpread: number;
    actualSpread: number;
    error: number;
    ourPick: string;
    result: string;
  }>;
  insights: string[];
}

const getLogoUrl = (abbr: string) => {
  return `https://a.espncdn.com/i/teamlogos/nfl/500-dark/${abbr.toLowerCase()}.png`;
};

function computeAnalysis(results: BacktestResult[]): Analysis {
  const homePicks = { wins: 0, losses: 0, pushes: 0 };
  const awayPicks = { wins: 0, losses: 0, pushes: 0 };
  const smallSpread = { wins: 0, losses: 0, pushes: 0 };
  const mediumSpread = { wins: 0, losses: 0, pushes: 0 };
  const largeSpread = { wins: 0, losses: 0, pushes: 0 };
  const closeGames = { wins: 0, losses: 0, pushes: 0 };
  const blowouts = { wins: 0, losses: 0, pushes: 0 };
  const weeklyPerformance: Record<number, { wins: number; losses: number; pushes: number }> = {};
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

    // Direction accuracy
    const predictedWinner = r.predictedSpread < 0 ? 'home' : 'away';
    const actualWinner = r.actualSpread < 0 ? 'home' : r.actualSpread > 0 ? 'away' : 'tie';
    if (actualWinner !== 'tie') {
      if (predictedWinner === actualWinner) correctDirection++;
      else wrongDirection++;
    }

    // Home vs Away picks
    if (r.spreadPick === 'home') {
      if (spreadResult === 'win') homePicks.wins++;
      else if (spreadResult === 'loss') homePicks.losses++;
      else homePicks.pushes++;
    } else {
      if (spreadResult === 'win') awayPicks.wins++;
      else if (spreadResult === 'loss') awayPicks.losses++;
      else awayPicks.pushes++;
    }

    // By spread size
    if (predictedMargin < 3) {
      if (spreadResult === 'win') smallSpread.wins++;
      else if (spreadResult === 'loss') smallSpread.losses++;
      else smallSpread.pushes++;
    } else if (predictedMargin < 7) {
      if (spreadResult === 'win') mediumSpread.wins++;
      else if (spreadResult === 'loss') mediumSpread.losses++;
      else mediumSpread.pushes++;
    } else {
      if (spreadResult === 'win') largeSpread.wins++;
      else if (spreadResult === 'loss') largeSpread.losses++;
      else largeSpread.pushes++;
    }

    // Close games vs blowouts
    if (actualMargin < 7) {
      if (spreadResult === 'win') closeGames.wins++;
      else if (spreadResult === 'loss') closeGames.losses++;
      else closeGames.pushes++;
    } else {
      if (spreadResult === 'win') blowouts.wins++;
      else if (spreadResult === 'loss') blowouts.losses++;
      else blowouts.pushes++;
    }

    // Weekly performance
    const week = r.week || 0;
    if (!weeklyPerformance[week]) {
      weeklyPerformance[week] = { wins: 0, losses: 0, pushes: 0 };
    }
    if (spreadResult === 'win') weeklyPerformance[week].wins++;
    else if (spreadResult === 'loss') weeklyPerformance[week].losses++;
    else weeklyPerformance[week].pushes++;

    // Track for biggest misses
    biggestMisses.push({
      game: `${r.awayTeam} @ ${r.homeTeam}`,
      week,
      predictedSpread: Math.round(r.predictedSpread * 10) / 10,
      actualSpread: r.actualSpread,
      error: Math.round(spreadError * 10) / 10,
      ourPick: r.spreadPick === 'home' ? r.homeTeam : r.awayTeam,
      result: spreadResult || 'push',
    });
  }

  // Sort and slice biggest misses
  biggestMisses.sort((a, b) => b.error - a.error);

  // Calculate averages
  spreadErrors.sort((a, b) => a - b);
  const avgSpreadError = spreadErrors.reduce((a, b) => a + b, 0) / spreadErrors.length;
  const medianSpreadError = spreadErrors[Math.floor(spreadErrors.length / 2)] || 0;
  const avgPredictedMargin = predictedMargins.reduce((a, b) => a + b, 0) / predictedMargins.length;
  const avgActualMargin = actualMargins.reduce((a, b) => a + b, 0) / actualMargins.length;

  const calcWinPct = (bucket: { wins: number; losses: number }) => {
    const total = bucket.wins + bucket.losses;
    return total > 0 ? Math.round((bucket.wins / total) * 1000) / 10 : 0;
  };

  // Generate insights
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
      small: { ...smallSpread, winPct: smallWinPct, range: '0-3 pts' },
      medium: { ...mediumSpread, winPct: mediumWinPct, range: '3-7 pts' },
      large: { ...largeSpread, winPct: largeWinPct, range: '7+ pts' },
    },
    byActualMargin: {
      closeGames: { ...closeGames, winPct: calcWinPct(closeGames), range: '<7 pts' },
      blowouts: { ...blowouts, winPct: calcWinPct(blowouts), range: '7+ pts' },
    },
    weeklyPerformance: Object.entries(weeklyPerformance)
      .map(([week, data]) => ({ week: parseInt(week), ...data, winPct: calcWinPct(data) }))
      .sort((a, b) => a.week - b.week),
    biggestMisses: biggestMisses.slice(0, 20),
    insights,
  };
}

// Generate a one-line recap from stats
function generateRecap(highConv: HighConvictionStats, overall: VegasStats): string {
  const parts: string[] = [];

  if (highConv.ml.total > 0) {
    if (highConv.ml.winPct >= 65) parts.push('ML is strong');
    else if (highConv.ml.winPct >= 55) parts.push('ML is solid');
    else if (highConv.ml.winPct < 50) parts.push('ML is struggling');
  }

  if (highConv.ats.total > 0) {
    if (highConv.ats.winPct >= 58) parts.push('ATS is profitable');
    else if (highConv.ats.winPct >= 52) parts.push('ATS is steady');
    else if (highConv.ats.winPct < 50) parts.push('ATS is mixed');
  }

  if (highConv.ou.total > 0) {
    if (highConv.ou.winPct >= 58) parts.push('totals hitting well');
    else if (highConv.ou.winPct >= 52) parts.push('totals are steady');
    else if (highConv.ou.winPct < 50) parts.push('totals need work');
  }

  if (parts.length === 0) return 'Building sample size for high conviction picks.';
  return parts.join('; ') + '.';
}

export default function ResultsPage() {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [vegasStats, setVegasStats] = useState<VegasStats | null>(null);
  const [highConvStats, setHighConvStats] = useState<HighConvictionStats | null>(null);
  const [situationStats, setSituationStats] = useState<SituationStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [viewMode, setViewMode] = useState<'conviction' | 'overall'>('conviction');

  useEffect(() => {
    const fetchResults = async () => {
      try {
        // Fetch backtest from pre-computed blob (instant!)
        const blobRes = await fetch('/prediction-data.json', { cache: 'no-cache' });
        const blobData = await blobRes.json();
        const rawResults: BacktestResult[] = blobData.backtest?.results || [];
        // Deduplicate by gameId
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

        // Compute analysis client-side from blob data
        if (backtestResults.length > 0) {
          setAnalysis(computeAnalysis(backtestResults));
          setVegasStats(computeVegasStats(backtestResults));
          setHighConvStats(computeHighConvictionStats(backtestResults));
          setSituationStats(computeSituationStats(backtestResults));
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
        <div className="w-12 h-12 border-4 border-red-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const formatDate = (date?: string | { _seconds?: number }) => {
    if (!date) return '—';
    if (typeof date === 'object' && typeof date._seconds === 'number') {
      return new Date(date._seconds * 1000).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    }
    if (typeof date !== 'string') return '—';
    const parsed = Date.parse(date);
    if (Number.isNaN(parsed)) return '—';
    return new Date(parsed).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const ResultBadge = ({ result }: { result?: 'win' | 'loss' | 'push' }) => {
    if (!result) return <span className="text-gray-400">—</span>;
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

  // Calculate Current Form (rolling 20 HIGH CONVICTION ATS picks only)
  const highConvictionResults = results.filter(r => {
    if (r.vegasSpread === undefined || !r.atsResult) return false;
    const spreadEdge = Math.abs(r.predictedSpread - r.vegasSpread);
    return spreadEdge >= 2; // High conviction threshold
  });
  const last20 = highConvictionResults.slice(0, 20);
  const last20ATS = last20.reduce((acc, r) => {
    if (r.atsResult === 'win') acc.wins++;
    else if (r.atsResult === 'loss') acc.losses++;
    return acc;
  }, { wins: 0, losses: 0 });
  const formScore = last20ATS.wins + last20ATS.losses > 0
    ? Math.round((last20ATS.wins / (last20ATS.wins + last20ATS.losses)) * 100)
    : 50;

  // Calculate deltas between high conviction and overall
  const getDelta = (highPct: number, overallPct: number) => {
    const delta = Math.round((highPct - overallPct) * 10) / 10;
    return delta;
  };

  // Get form status text
  const getFormStatus = (score: number) => {
    if (score >= 60) return { text: 'Hot streak', color: 'text-green-600' };
    if (score >= 55) return { text: 'Running well', color: 'text-green-600' };
    if (score >= 50) return { text: 'On track', color: 'text-blue-600' };
    if (score >= 45) return { text: 'Cooling off', color: 'text-amber-600' };
    return { text: 'Cold spell', color: 'text-red-600' };
  };

  const formStatus = getFormStatus(formScore);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Results</h1>
          <span className="bg-green-100 text-green-700 text-[10px] sm:text-xs font-bold px-2 py-1 rounded">HIGH CONVICTION FOCUS</span>
        </div>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('conviction')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition ${
                viewMode === 'conviction' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              High Conviction
            </button>
            <button
              onClick={() => setViewMode('overall')}
              className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-md transition ${
                viewMode === 'overall' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Overall
            </button>
          </div>
          <button
            onClick={() => setShowAnalysis(!showAnalysis)}
            className="px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-900 hover:bg-gray-800 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors"
          >
            {showAnalysis ? 'Hide' : 'Analysis'}
          </button>
        </div>
      </div>

      {/* Current Form - Compact */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-bold text-gray-900 text-sm">Current Form</h3>
            <span className="text-xs text-gray-400">Last 20 picks</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-0.5">
              {last20.slice(0, 20).reverse().map((r, i) => (
                <div
                  key={i}
                  className={`w-2.5 h-5 rounded-sm ${
                    r.atsResult === 'win' ? 'bg-green-500' :
                    r.atsResult === 'loss' ? 'bg-red-500' : 'bg-gray-300'
                  }`}
                  title={`${r.awayTeam} @ ${r.homeTeam}: ${r.atsResult?.toUpperCase() || 'PUSH'}`}
                />
              ))}
            </div>
            <div className="text-right">
              <div className={`text-lg font-bold font-mono ${formStatus.color}`}>
                {last20ATS.wins}-{last20ATS.losses}
              </div>
              <div className={`text-[10px] font-medium ${formStatus.color}`}>{formStatus.text}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Performance Section */}
      {highConvStats && vegasStats && (
        <div className="space-y-4">
          {/* Primary Stats Card - High Conviction or Overall based on viewMode */}
          <div className={`relative bg-white rounded-2xl border shadow-sm overflow-hidden ${
            viewMode === 'conviction' ? 'border-green-200' : 'border-gray-200'
          }`}>
            {/* Left accent rail */}
            <div className={`absolute left-0 top-0 h-full w-1 ${viewMode === 'conviction' ? 'bg-green-500' : 'bg-gray-300'}`} />

            <div className="p-4 sm:p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className={`font-bold text-sm sm:text-base ${viewMode === 'conviction' ? 'text-green-800' : 'text-gray-700'}`}>
                    {viewMode === 'conviction' ? 'High Conviction Performance' : 'Overall Performance'}
                  </h2>
                  {viewMode === 'conviction' && (
                    <span className="text-[10px] text-green-600 bg-green-50 px-2 py-0.5 rounded">
                      {(highConvStats.ats.total + highConvStats.ml.total + highConvStats.ou.total)} picks
                    </span>
                  )}
                </div>
                {highConvStats && vegasStats && (
                  <div className="text-xs text-gray-500 max-w-[200px] sm:max-w-none truncate sm:whitespace-normal">
                    {viewMode === 'conviction' && generateRecap(highConvStats, vegasStats)}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 sm:gap-4">
                {viewMode === 'conviction' ? (
                  <>
                    {/* High Conviction ATS */}
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">ATS</div>
                      <div className="text-lg sm:text-2xl font-bold text-gray-900">
                        {highConvStats.ats.wins}-{highConvStats.ats.losses}
                        {highConvStats.ats.pushes > 0 && <span className="text-gray-400 text-base sm:text-lg">-{highConvStats.ats.pushes}</span>}
                      </div>
                      <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ats.winPct > 52.4 ? 'text-green-600' : highConvStats.ats.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                        {highConvStats.ats.winPct}%
                      </div>
                      <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{highConvStats.ats.total} picks</div>
                    </div>

                    {/* High Conviction ML */}
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">ML</div>
                      <div className="text-lg sm:text-2xl font-bold text-gray-900">
                        {highConvStats.ml.wins}-{highConvStats.ml.losses}
                      </div>
                      <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ml.winPct > 52.4 ? 'text-green-600' : highConvStats.ml.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                        {highConvStats.ml.winPct}%
                      </div>
                      <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{highConvStats.ml.total} picks</div>
                    </div>

                    {/* High Conviction O/U */}
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">O/U</div>
                      <div className="text-lg sm:text-2xl font-bold text-gray-900">
                        {highConvStats.ou.wins}-{highConvStats.ou.losses}
                        {highConvStats.ou.pushes > 0 && <span className="text-gray-400 text-base sm:text-lg">-{highConvStats.ou.pushes}</span>}
                      </div>
                      <div className={`text-base sm:text-xl font-mono font-bold ${highConvStats.ou.winPct > 52.4 ? 'text-green-600' : highConvStats.ou.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                        {highConvStats.ou.winPct}%
                      </div>
                      <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{highConvStats.ou.total} picks</div>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Overall ATS */}
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">ATS</div>
                      <div className="text-lg sm:text-2xl font-bold text-gray-900">
                        {vegasStats.ats.wins}-{vegasStats.ats.losses}
                        {vegasStats.ats.pushes > 0 && <span className="text-gray-400 text-base sm:text-lg">-{vegasStats.ats.pushes}</span>}
                      </div>
                      <div className={`text-base sm:text-xl font-mono font-bold ${vegasStats.ats.winPct > 52.4 ? 'text-green-600' : vegasStats.ats.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                        {vegasStats.ats.winPct}%
                      </div>
                      <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{vegasStats.ats.gamesWithOdds} games</div>
                    </div>

                    {/* Overall ML */}
                    {summary && (
                      <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                        <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">ML</div>
                        <div className="text-lg sm:text-2xl font-bold text-gray-900">
                          {summary.moneyline.wins}-{summary.moneyline.losses}
                        </div>
                        <div className={`text-base sm:text-xl font-mono font-bold ${summary.moneyline.winPct > 50 ? 'text-green-600' : 'text-red-500'}`}>
                          {summary.moneyline.winPct}%
                        </div>
                        <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{summary.moneyline.wins + summary.moneyline.losses} games</div>
                      </div>
                    )}

                    {/* Overall O/U */}
                    <div className="bg-gray-50 rounded-xl p-3 sm:p-4">
                      <div className="text-gray-500 text-[10px] sm:text-xs font-medium mb-1">O/U</div>
                      <div className="text-lg sm:text-2xl font-bold text-gray-900">
                        {vegasStats.ouVegas.wins}-{vegasStats.ouVegas.losses}
                        {vegasStats.ouVegas.pushes > 0 && <span className="text-gray-400 text-base sm:text-lg">-{vegasStats.ouVegas.pushes}</span>}
                      </div>
                      <div className={`text-base sm:text-xl font-mono font-bold ${vegasStats.ouVegas.winPct > 52.4 ? 'text-green-600' : vegasStats.ouVegas.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
                        {vegasStats.ouVegas.winPct}%
                      </div>
                      <div className="text-[9px] sm:text-xs text-gray-400 mt-1">{vegasStats.ouVegas.gamesWithOdds} games</div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Comparison Row - Show opposite of current view */}
          <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-gray-500">
                {viewMode === 'conviction' ? 'Compared to Overall' : 'High Conviction Edge'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              {/* ATS Comparison */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">ATS</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {viewMode === 'conviction'
                      ? `${vegasStats.ats.winPct}%`
                      : `${highConvStats.ats.winPct}%`}
                  </span>
                  {(() => {
                    const delta = viewMode === 'conviction'
                      ? getDelta(highConvStats.ats.winPct, vegasStats.ats.winPct)
                      : getDelta(highConvStats.ats.winPct, vegasStats.ats.winPct);
                    return (
                      <span className={`text-xs font-mono font-bold ${
                        delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* ML Comparison */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">ML</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {viewMode === 'conviction'
                      ? `${summary?.moneyline.winPct || 0}%`
                      : `${highConvStats.ml.winPct}%`}
                  </span>
                  {(() => {
                    const delta = getDelta(highConvStats.ml.winPct, summary?.moneyline.winPct || 0);
                    return (
                      <span className={`text-xs font-mono font-bold ${
                        delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* O/U Comparison */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-500">O/U</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">
                    {viewMode === 'conviction'
                      ? `${vegasStats.ouVegas.winPct}%`
                      : `${highConvStats.ou.winPct}%`}
                  </span>
                  {(() => {
                    const delta = getDelta(highConvStats.ou.winPct, vegasStats.ouVegas.winPct);
                    return (
                      <span className={`text-xs font-mono font-bold ${
                        delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-500' : 'text-gray-400'
                      }`}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Spread Analysis */}
      {showAnalysis && analysis && (
        <div className="space-y-4">
          {/* Insights */}
          {analysis.insights.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <h3 className="font-bold text-amber-800 mb-2">Key Insights</h3>
              <ul className="space-y-1 text-sm">
                {analysis.insights.map((insight, i) => (
                  <li key={i} className="text-amber-700">• {insight}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Analysis Stats */}
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

          {/* By Pick Type */}
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
              <h3 className="font-bold text-gray-900 mb-3">By Actual Margin</h3>
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Close Games (&lt;7 pts)</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.byActualMargin.closeGames.wins}-{analysis.byActualMargin.closeGames.losses}</span>
                    <WinPctBadge pct={analysis.byActualMargin.closeGames.winPct} />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Blowouts (7+ pts)</span>
                  <div>
                    <span className="text-sm text-gray-900 mr-2">{analysis.byActualMargin.blowouts.wins}-{analysis.byActualMargin.blowouts.losses}</span>
                    <WinPctBadge pct={analysis.byActualMargin.blowouts.winPct} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* By Spread Size */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-3">By Predicted Spread Size</h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-gray-500 text-xs font-medium mb-1">Small (0-3 pts)</div>
                <div className="text-lg font-bold text-gray-900">{analysis.bySpreadSize.small.wins}-{analysis.bySpreadSize.small.losses}</div>
                <WinPctBadge pct={analysis.bySpreadSize.small.winPct} />
              </div>
              <div className="text-center">
                <div className="text-gray-500 text-xs font-medium mb-1">Medium (3-7 pts)</div>
                <div className="text-lg font-bold text-gray-900">{analysis.bySpreadSize.medium.wins}-{analysis.bySpreadSize.medium.losses}</div>
                <WinPctBadge pct={analysis.bySpreadSize.medium.winPct} />
              </div>
              <div className="text-center">
                <div className="text-gray-500 text-xs font-medium mb-1">Large (7+ pts)</div>
                <div className="text-lg font-bold text-gray-900">{analysis.bySpreadSize.large.wins}-{analysis.bySpreadSize.large.losses}</div>
                <WinPctBadge pct={analysis.bySpreadSize.large.winPct} />
              </div>
            </div>
          </div>

          {/* Weekly Performance */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <h3 className="font-bold text-gray-900 mb-3">Weekly Performance</h3>
            <div className="flex flex-wrap gap-2">
              {analysis.weeklyPerformance.map((week) => (
                <div
                  key={week.week}
                  className={`px-3 py-2 rounded-lg text-center border ${
                    week.winPct >= 52.4 ? 'bg-green-50 border-green-200 text-green-800' : week.winPct < 47.6 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-700'
                  }`}
                >
                  <div className="text-xs font-medium opacity-70">Wk {week.week}</div>
                  <div className="font-mono text-sm font-bold">{week.wins}-{week.losses}</div>
                </div>
              ))}
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
                    <th className="pb-2 font-medium">Wk</th>
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
                      <td className="py-2 text-gray-600">{miss.week}</td>
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
