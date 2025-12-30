'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type SummaryStats = {
  ats: number;
  ml: number;
  ou: number;
};

export default function FooterStats() {
  const pathname = usePathname();
  const isNBA = pathname?.startsWith('/nba');
  const isNHL = pathname?.startsWith('/nhl');
  const [stats, setStats] = useState<SummaryStats | null>(null);

  const sport = isNHL ? 'NHL' : isNBA ? 'NBA' : 'NFL';
  const spreadLabel = isNHL ? 'PL' : 'ATS'; // Puck Line for NHL

  useEffect(() => {
    let cancelled = false;
    const url = isNHL
      ? '/nhl-prediction-data.json'
      : isNBA
        ? '/nba-prediction-data.json'
        : '/prediction-data.json';

    const loadStats = async () => {
      try {
        const response = await fetch(url, { cache: 'no-cache' });
        const data = await response.json();
        // Use high conviction stats (falls back to regular summary if not available yet)
        const summary = data?.backtest?.highConvictionSummary || data?.backtest?.summary;
        if (!summary || cancelled) return;

        setStats({
          ats: summary.spread?.winPct ?? 0,
          ml: summary.moneyline?.winPct ?? 0,
          ou: summary.overUnder?.winPct ?? 0,
        });
      } catch {
        if (!cancelled) setStats(null);
      }
    };

    loadStats();
    return () => { cancelled = true; };
  }, [isNBA, isNHL]);

  if (!stats) {
    return <span className="text-[10px] sm:text-sm">Loading stats...</span>;
  }

  return (
    <span className="text-[10px] sm:text-sm flex items-center gap-1.5">
      <span className="bg-green-100 text-green-700 px-1 py-0.5 rounded text-[9px] sm:text-[10px] font-bold">HIGH CONV</span>
      <span>{sport}: {spreadLabel} {stats.ats}% | ML {stats.ml}% | O/U {stats.ou}%</span>
    </span>
  );
}
