import type { Metadata } from 'next';
import { buildPropsReport } from '@/lib/props-data';
import { RULE, SERIES_LABEL } from '@/lib/props-fair';

export const metadata: Metadata = {
  title: 'NFL Props Watch - Kalshi prop ladders vs sportsbook fair value',
  description: 'Every open NFL player-prop rung on Kalshi priced against the de-vigged consensus of US sportsbooks, with fee-adjusted edge. Read-only research view, refreshed every five minutes.',
};
export const revalidate = 300;

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}¢`);
const c = (v: number | null | undefined, sign = true) => (v === null || v === undefined ? '—' : `${sign && v > 0 ? '+' : ''}${v.toFixed(1)}¢`);
const fmtTs = (iso: string) => (iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—');
const kickoff = (iso: string) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const seriesOf = (ticker: string) => ticker.split('-')[0];
const playerTitle = (p: string) => p.replace(/\b\w/g, ch => ch.toUpperCase());

export default async function PropsPage() {
  const r = await buildPropsReport();
  const oddsTs = r.games.map(g => g.snapshotTs).filter(Boolean).sort();
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">NFL Props Watch</h1>
          <p className="text-sm text-gray-500">Every open Kalshi prop rung priced against the de-vigged sportsbook consensus. Research view, nothing here is a pick.</p>
        </div>
        <div className="text-xs text-gray-500 text-right">
          <div>Kalshi ladders: {fmtTs(r.kalshiTs)} · {r.kalshiRows.toLocaleString()} markets</div>
          <div>Sportsbook lines: {oddsTs.length ? `${fmtTs(oddsTs[0])} – ${fmtTs(oddsTs[oddsTs.length - 1])}` : '—'} · {r.games.length} games</div>
        </div>
      </div>

      {r.error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">Data unavailable: {r.error}</div>}

      <div className={`rounded-xl border p-4 ${r.overRule.length ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'}`}>
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">Rule (frozen 2026-09-11)</div>
        <div className="text-sm text-gray-700">
          Fair value = median of ≥{RULE.minBooks} books after removing each book&apos;s vig, matched only where a book line lands exactly on a Kalshi rung. Net edge = fair − price − Kalshi taker fee − {Math.round(RULE.haircut * 100)}¢ haircut.
          A rung counts when net edge ≥ {RULE.minNetEdgeC}¢; a gap beyond {RULE.investigateGapC}¢ against real volume is investigated, not bet.
        </div>
        <div className="mt-2 text-base font-semibold text-gray-900">{r.overRule.length} of {r.matched.toLocaleString()} matched rungs clear the rule right now.</div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
            <tr><th className="text-left px-3 py-2">Stat</th><th className="text-right px-3 py-2">Matched rungs</th><th className="text-right px-3 py-2">Median gap</th><th className="text-right px-3 py-2">90th pct gap</th><th className="text-right px-3 py-2">Over rule</th><th className="text-right px-3 py-2">Best net edge</th></tr>
          </thead>
          <tbody>
            {r.bySeries.map(s => (
              <tr key={s.series} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium text-gray-900">{s.label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{s.matched}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c(s.medianAbsGapC, false)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{c(s.p90AbsGapC, false)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.overRule ? 'text-green-700 font-semibold' : 'text-gray-500'}`}>{s.overRule}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${s.bestEdgeC !== null && s.bestEdgeC >= RULE.minNetEdgeC ? 'text-green-700 font-semibold' : 'text-gray-700'}`}>{c(s.bestEdgeC)}</td>
              </tr>
            ))}
            {!r.bySeries.length && <tr><td className="px-3 py-3 text-gray-500" colSpan={6}>No matched rungs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="text-base font-semibold text-gray-900">Closest to the rule</h2>
          <span className="text-xs text-gray-500">Top 40 rungs by net edge after fees · YES = buy the over side, NO = buy the under side</span>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[10px] uppercase tracking-wider text-gray-500">
              <tr><th className="text-left px-3 py-2">Player</th><th className="text-left px-3 py-2">Stat</th><th className="text-right px-3 py-2">Rung</th><th className="text-right px-3 py-2">Books fair</th><th className="text-right px-3 py-2">Books</th><th className="text-right px-3 py-2">Kalshi bid / ask</th><th className="text-right px-3 py-2">Size at ask</th><th className="text-right px-3 py-2">Side</th><th className="text-right px-3 py-2">Net edge</th></tr>
            </thead>
            <tbody>
              {r.top.map(e => (
                <tr key={e.ticker} className={`border-t border-gray-100 ${(e.bestEdgeC ?? -99) >= RULE.minNetEdgeC ? 'bg-green-50' : ''}`}>
                  <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{playerTitle(e.player)}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{SERIES_LABEL[seriesOf(e.ticker)] || seriesOf(e.ticker)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.threshold + 0.5}+</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(e.pFair)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{e.nBooks}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{pct(e.yesBid)} / {pct(e.yesAsk)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500">{e.askSize === null ? '—' : Math.round(e.askSize)}</td>
                  <td className="px-3 py-2 text-right font-medium">{e.side}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-semibold ${(e.bestEdgeC ?? -99) >= RULE.minNetEdgeC ? 'text-green-700' : (e.bestEdgeC ?? 0) > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{c(e.bestEdgeC)}</td>
                </tr>
              ))}
              {!r.top.length && <tr><td className="px-3 py-3 text-gray-500" colSpan={9}>Nothing to show yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-2">Games covered</div>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3 text-sm text-gray-700">
          {r.games.map(g => (<div key={g.eventId} className="flex justify-between gap-3"><span>{g.away} @ {g.home}</span><span className="text-gray-400 whitespace-nowrap">{kickoff(g.commence)} · lines {fmtTs(g.snapshotTs).split(', ').pop()}</span></div>))}
        </div>
      </div>

      <p className="text-xs text-gray-400 max-w-3xl">
        Sources: Kalshi public market data (every 5 min) and The Odds API US books (cadence tightens toward kickoff). Kalshi prop markets are per-player ladders (60+, 70+, …) that resolve on the official stat line.
        Fair values are the books&apos; opinion, not ours. Gaps here are measured, not traded; whether they close toward the books after kickoff windows is the test that decides anything further.
      </p>
    </div>
  );
}
