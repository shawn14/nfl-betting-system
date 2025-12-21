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

export default function ResultsPage() {
  const [results, setResults] = useState<BacktestResult[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(false);

  useEffect(() => {
    const fetchResults = async () => {
      try {
        // Fetch backtest from pre-computed blob (instant!)
        const [blobRes, analysisRes] = await Promise.all([
          fetch('/prediction-data.json', { cache: 'no-cache' }),
          fetch('/api/backtest/analysis'),
        ]);
        const blobData = await blobRes.json();
        const analysisData = await analysisRes.json();
        setResults(blobData.backtest?.results || []);
        setSummary(blobData.backtest?.summary || null);
        setAnalysis(analysisData);
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
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  const formatDate = (date: string) => {
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  const formatSpread = (spread: number) => {
    if (spread > 0) return `+${spread}`;
    return spread.toString();
  };

  const ResultBadge = ({ result }: { result?: 'win' | 'loss' | 'push' }) => {
    if (!result) return <span className="text-gray-400">—</span>;
    const colors = {
      win: 'bg-emerald-500 text-white',
      loss: 'bg-red-500 text-white',
      push: 'bg-gray-400 text-white',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-bold ${colors[result]}`}>
        {result.toUpperCase()}
      </span>
    );
  };

  const WinPctBadge = ({ pct, threshold = 52.4 }: { pct: number; threshold?: number }) => {
    const color = pct >= threshold ? 'text-emerald-600' : pct < (100 - threshold) ? 'text-red-600' : 'text-gray-500';
    return <span className={`font-mono font-bold ${color}`}>{pct}%</span>;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Performance Results</h1>
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {showAnalysis ? 'Hide Analysis' : 'Show Analysis'}
        </button>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          {/* Spread */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-1">Against the Spread</div>
            <div className="text-3xl font-bold text-gray-900">
              {summary.spread.wins}-{summary.spread.losses}
              {summary.spread.pushes > 0 && <span className="text-gray-400">-{summary.spread.pushes}</span>}
            </div>
            <div className={`text-2xl font-mono font-bold ${summary.spread.winPct > 52.4 ? 'text-emerald-500' : summary.spread.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
              {summary.spread.winPct}%
            </div>
            <div className="text-xs text-gray-400 mt-2">Need 52.4% to beat vig</div>
          </div>

          {/* Moneyline */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-1">Moneyline</div>
            <div className="text-3xl font-bold text-gray-900">
              {summary.moneyline.wins}-{summary.moneyline.losses}
            </div>
            <div className={`text-2xl font-mono font-bold ${summary.moneyline.winPct > 50 ? 'text-emerald-500' : 'text-red-500'}`}>
              {summary.moneyline.winPct}%
            </div>
            <div className="text-xs text-gray-400 mt-2">Picking winners straight up</div>
          </div>

          {/* Over/Under */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="text-gray-500 text-sm font-medium mb-1">Over/Under</div>
            <div className="text-3xl font-bold text-gray-900">
              {summary.overUnder.wins}-{summary.overUnder.losses}
              {summary.overUnder.pushes > 0 && <span className="text-gray-400">-{summary.overUnder.pushes}</span>}
            </div>
            <div className={`text-2xl font-mono font-bold ${summary.overUnder.winPct > 52.4 ? 'text-emerald-500' : summary.overUnder.winPct < 47.6 ? 'text-red-500' : 'text-gray-500'}`}>
              {summary.overUnder.winPct}%
            </div>
            <div className="text-xs text-gray-400 mt-2">vs league avg (44 pts)</div>
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
              <div className="text-2xl font-bold text-emerald-500">{analysis.summary.directionAccuracy}%</div>
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
                    week.winPct >= 52.4 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : week.winPct < 47.6 ? 'bg-red-50 border-red-200 text-red-800' : 'bg-gray-50 border-gray-200 text-gray-700'
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
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Game</th>
              <th className="px-4 py-3 text-center font-semibold">Predicted</th>
              <th className="px-4 py-3 text-center font-semibold">Actual</th>
              <th className="px-4 py-3 text-center font-semibold">Spread</th>
              <th className="px-4 py-3 text-center font-semibold">ML</th>
              <th className="px-4 py-3 text-center font-semibold">O/U</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {results.map((game) => (
              <tr key={game.gameId} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <img src={getLogoUrl(game.awayTeam)} alt="" className="w-6 h-6" />
                    <img src={getLogoUrl(game.homeTeam)} alt="" className="w-6 h-6" />
                    <div>
                      <div className="font-semibold text-gray-900">{game.awayTeam} @ {game.homeTeam}</div>
                      <div className="text-xs text-gray-500">
                        {formatDate(game.gameTime)}
                        {game.week && ` • Wk ${game.week}`}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="font-mono text-gray-900">{Math.round(game.predictedAwayScore)}-{Math.round(game.predictedHomeScore)}</div>
                  <div className="text-xs text-gray-500">{formatSpread(game.predictedSpread)}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="font-mono font-bold text-gray-900">{game.actualAwayScore}-{game.actualHomeScore}</div>
                  <div className="text-xs text-gray-500">{formatSpread(game.actualSpread)}</div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">
                    {game.spreadPick === 'home' ? game.homeTeam : game.awayTeam}
                  </div>
                  <ResultBadge result={game.spreadResult} />
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">
                    {game.mlPick === 'home' ? game.homeTeam : game.awayTeam}
                  </div>
                  <ResultBadge result={game.mlResult} />
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="text-xs text-gray-500 mb-1">
                    {game.ouPick?.toUpperCase()}
                  </div>
                  <ResultBadge result={game.ouResult} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {results.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 text-center text-gray-500 py-12">
          No completed games to analyze yet.
        </div>
      )}
    </div>
  );
}
