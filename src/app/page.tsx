import type { Metadata } from 'next';
import { fetchAllSportsData, getBacktestResults, type BacktestResult } from '@/lib/blob-data';
import LoginButton from '@/components/LoginButton';

export const metadata: Metadata = {
  title: 'Prediction Matrix - AI NFL, NBA, NHL & CBB Betting Predictions',
  description:
    'AI-powered NFL, NBA, NHL & College Basketball betting predictions. Get daily picks, Elo rankings, ATS results, and expert analysis for smarter sports betting.',
  keywords: [
    'sports betting',
    'NFL picks',
    'NBA picks',
    'NHL picks',
    'college basketball picks',
    'betting predictions',
    'Elo ratings',
    'ATS',
    'spread predictions',
    'sports analytics',
  ],
};

function computeHighConvictionStats(results: BacktestResult[]) {
  let mlW = 0,
    mlL = 0;
  let atsW = 0,
    atsL = 0;
  let ouW = 0,
    ouL = 0;

  for (const r of results) {
    if (r.vegasSpread === undefined) continue;

    const totalEdge =
      r.vegasTotal !== undefined
        ? Math.abs(r.predictedTotal - r.vegasTotal)
        : 0;
    const mlEdge = Math.abs(r.homeWinProb - 0.5) * 100;

    if (mlEdge >= 15 && r.mlResult) {
      if (r.mlResult === 'win') mlW++;
      else mlL++;
    }

    if (r.conviction?.isHighConviction && r.atsResult) {
      if (r.atsResult === 'win') atsW++;
      else if (r.atsResult === 'loss') atsL++;
    }

    if (totalEdge >= 5 && r.ouVegasResult) {
      if (r.ouVegasResult === 'win') ouW++;
      else if (r.ouVegasResult === 'loss') ouL++;
    }
  }

  return {
    ml: mlW + mlL > 0 ? ((mlW / (mlW + mlL)) * 100).toFixed(1) : null,
    ats: atsW + atsL > 0 ? ((atsW / (atsW + atsL)) * 100).toFixed(1) : null,
    ou: ouW + ouL > 0 ? ((ouW / (ouW + ouL)) * 100).toFixed(1) : null,
  };
}

export default async function LandingPage() {
  const { nfl, nba, nhl } = await fetchAllSportsData();

  const allResults: BacktestResult[] = [
    ...getBacktestResults(nfl),
    ...getBacktestResults(nba),
    ...getBacktestResults(nhl),
  ];

  const stats =
    allResults.length > 0 ? computeHighConvictionStats(allResults) : null;

  return (
    <div className="min-h-[70vh] flex items-center">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center w-full">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-red-600">
            Prediction Matrix
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
            NFL, NBA, NHL &amp; CBB predictions
            <span className="block text-red-600">built to find real signal.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl">
            Built on historical outcomes, line movement, injuries, and market
            consensus — updated every two hours.
          </p>

          {/* Server-rendered proof point — crawlable by search engines */}
          {stats && (stats.ml || stats.ats || stats.ou) && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-gray-500">
                High Conviction this season:
              </span>
              <div className="flex items-center gap-4 font-mono">
                {stats.ml && (
                  <span className="text-gray-900 font-semibold">
                    {stats.ml}% ML
                  </span>
                )}
                {stats.ats && (
                  <span className="text-gray-900 font-semibold">
                    {stats.ats}% ATS
                  </span>
                )}
                {stats.ou && (
                  <span className="text-gray-900 font-semibold">
                    {stats.ou}% O/U
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Client island for auth — only interactive part of the page */}
          <LoginButton />
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">
              How it works
            </span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">
              Updated every 2 hours
            </span>
          </div>
          <div className="space-y-4 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">01</span>
              <div>
                <div className="text-gray-900 font-semibold">
                  Model projects the game
                </div>
                Elo ratings, pace, scoring efficiency, and matchup context.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">02</span>
              <div>
                <div className="text-gray-900 font-semibold">
                  Market context applied
                </div>
                Vegas lines, movement, and where the edge actually is.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">03</span>
              <div>
                <div className="text-gray-900 font-semibold">
                  High Conviction flagged
                </div>
                Only highlighted when historical patterns show real signal.
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-xs text-gray-500">
            No parlays. No locks. No hype. Just probability and discipline.
          </div>
        </div>
      </div>

      {/* Footer credibility line */}
      <div className="absolute bottom-8 left-0 right-0 text-center">
        <p className="text-xs text-gray-400">
          Built by people who track results, not screenshots.
        </p>
      </div>
    </div>
  );
}
