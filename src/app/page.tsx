'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/components/AuthProvider';

interface BacktestResult {
  vegasSpread?: number;
  vegasTotal?: number;
  predictedSpread: number;
  predictedTotal: number;
  homeWinProb: number;
  atsResult?: 'win' | 'loss' | 'push';
  mlResult?: 'win' | 'loss';
  ouVegasResult?: 'win' | 'loss' | 'push';
  conviction?: { isHighConviction?: boolean };
}

function computeHighConvictionStats(results: BacktestResult[]) {
  let mlW = 0, mlL = 0;
  let atsW = 0, atsL = 0;
  let ouW = 0, ouL = 0;

  for (const r of results) {
    if (r.vegasSpread === undefined) continue;

    const spreadEdge = Math.abs(r.predictedSpread - r.vegasSpread);
    const totalEdge = r.vegasTotal !== undefined ? Math.abs(r.predictedTotal - r.vegasTotal) : 0;
    const mlEdge = Math.abs(r.homeWinProb - 0.5) * 100;

    // High conviction ML (15%+ edge)
    if (mlEdge >= 15 && r.mlResult) {
      if (r.mlResult === 'win') mlW++;
      else mlL++;
    }

    // High conviction ATS (using conviction flag or spread edge)
    if (r.conviction?.isHighConviction && r.atsResult) {
      if (r.atsResult === 'win') atsW++;
      else if (r.atsResult === 'loss') atsL++;
    }

    // High conviction O/U (5+ point edge)
    if (totalEdge >= 5 && r.ouVegasResult) {
      if (r.ouVegasResult === 'win') ouW++;
      else if (r.ouVegasResult === 'loss') ouL++;
    }
  }

  return {
    ml: { w: mlW, l: mlL, pct: mlW + mlL > 0 ? ((mlW / (mlW + mlL)) * 100).toFixed(1) : null },
    ats: { w: atsW, l: atsL, pct: atsW + atsL > 0 ? ((atsW / (atsW + atsL)) * 100).toFixed(1) : null },
    ou: { w: ouW, l: ouL, pct: ouW + ouL > 0 ? ((ouW / (ouW + ouL)) * 100).toFixed(1) : null },
  };
}

export default function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [stats, setStats] = useState<{ ml: string | null; ats: string | null; ou: string | null } | null>(null);

  useEffect(() => {
    if (!loading && user) {
      router.replace('/dashboard');
    }
  }, [loading, router, user]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [nflRes, nbaRes, nhlRes, wnbaRes] = await Promise.all([
          fetch('/prediction-data.json').then(r => r.json()).catch(() => null),
          fetch('/nba-prediction-data.json').then(r => r.json()).catch(() => null),
          fetch('/nhl-prediction-data.json').then(r => r.json()).catch(() => null),
          fetch('/wnba-prediction-data.json').then(r => r.json()).catch(() => null),
        ]);

        // Combine all backtest results
        const allResults: BacktestResult[] = [
          ...(nflRes?.backtest?.results || nflRes?.backtest || []),
          ...(nbaRes?.backtest?.results || nbaRes?.backtest || []),
          ...(nhlRes?.backtest?.results || nhlRes?.backtest || []),
          ...(wnbaRes?.backtest?.results || wnbaRes?.backtest || []),
        ];

        if (allResults.length > 0) {
          const computed = computeHighConvictionStats(allResults);
          setStats({
            ml: computed.ml.pct,
            ats: computed.ats.pct,
            ou: computed.ou.pct,
          });
        }
      } catch (error) {
        console.error('Error fetching stats:', error);
      }
    }
    fetchStats();
  }, []);

  const handleGoogleLogin = async () => {
    if (!auth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  return (
    <div className="min-h-[70vh] flex items-center">
      <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] items-center w-full">
        <div className="space-y-6">
          <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.3em] text-red-600">
            Prediction Matrix
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 leading-tight">
            NFL, NBA & NHL predictions
            <span className="block text-red-600">built to find real signal.</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-600 max-w-xl">
            Built on historical outcomes, line movement, injuries, and market consensus — updated every two hours.
          </p>

          {/* Live proof point */}
          {stats && (stats.ml || stats.ats || stats.ou) && (
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <span className="text-gray-500">High Conviction this season:</span>
              <div className="flex items-center gap-4 font-mono">
                {stats.ml && (
                  <span className="text-gray-900 font-semibold">{stats.ml}% ML</span>
                )}
                {stats.ats && (
                  <span className="text-gray-900 font-semibold">{stats.ats}% ATS</span>
                )}
                {stats.ou && (
                  <span className="text-gray-900 font-semibold">{stats.ou}% O/U</span>
                )}
              </div>
            </div>
          )}

          {!user && (
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={handleGoogleLogin}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 transition-colors"
                >
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-900 text-[10px] font-bold">
                    G
                  </span>
                  Continue with Google
                </button>
                <button
                  onClick={() => router.push('/about')}
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 px-5 py-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  See how it works
                </button>
              </div>
              <div className="text-xs text-gray-400">
                No credit card · No spam · Leave anytime
              </div>
            </div>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-900">How it works</span>
            <span className="text-[10px] text-gray-400 uppercase tracking-wider">Updated every 2 hours</span>
          </div>
          <div className="space-y-4 text-sm text-gray-600">
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">01</span>
              <div>
                <div className="text-gray-900 font-semibold">Model projects the game</div>
                Elo ratings, pace, scoring efficiency, and matchup context.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">02</span>
              <div>
                <div className="text-gray-900 font-semibold">Market context applied</div>
                Vegas lines, movement, and where the edge actually is.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="text-red-600 font-bold">03</span>
              <div>
                <div className="text-gray-900 font-semibold">High Conviction flagged</div>
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
