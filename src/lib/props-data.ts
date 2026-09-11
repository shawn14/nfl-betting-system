// Loads the latest recorder snapshots from Blob and builds the props-watch report for the /props page.
import { gunzipSync } from 'zlib';
import { computeEdges, extractLines, fairRungs, rowsFromSnapshot, RULE, SERIES_LABEL, type RungEdge } from '@/lib/props-fair';

const BLOB = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com';
const REVALIDATE = 300; // matches the 5-min Kalshi cadence

async function getGz(path: string): Promise<any> {
  const res = await fetch(`${BLOB}/${path}`, { next: { revalidate: REVALIDATE } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf8'));
}
async function getJson(path: string): Promise<any> {
  const res = await fetch(`${BLOB}/${path}`, { next: { revalidate: REVALIDATE } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export interface SeriesSummary { series: string; label: string; matched: number; medianAbsGapC: number | null; p90AbsGapC: number | null; overRule: number; bestEdgeC: number | null }
export interface GameInfo { eventId: string; away: string; home: string; commence: string; snapshotTs: string; hoursToKick: number | null }
export interface PropsReport {
  kalshiTs: string; kalshiRows: number; games: GameInfo[]; fairRungs: number; matched: number;
  bySeries: SeriesSummary[]; top: RungEdge[]; overRule: RungEdge[]; generatedAt: string; error?: string;
}

function q(v: number[], p: number): number | null { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; }

export async function buildPropsReport(): Promise<PropsReport> {
  const generatedAt = new Date().toISOString();
  try {
    const [kalshi, oddsIndex] = await Promise.all([getGz('kalshi-props/latest.json.gz'), getJson('odds-props/index.json')]);
    const rows = rowsFromSnapshot(kalshi);
    // latest snapshot per event id (path ends with -<eventId>.json.gz; paths sort chronologically)
    const latest = new Map<string, string>();
    for (const s of (oddsIndex.snapshots || []) as Array<{ path: string }>) {
      const m = s.path.match(/-([0-9a-f]{32})\.json\.gz$/); if (!m) continue;
      const prev = latest.get(m[1]); if (!prev || s.path > prev) latest.set(m[1], s.path);
    }
    const payloads = await Promise.all([...latest.values()].map(p => getGz(p).catch(() => null)));
    const games: GameInfo[] = []; let rungs: ReturnType<typeof fairRungs> = [];
    for (const p of payloads) {
      if (!p) continue;
      rungs = rungs.concat(fairRungs(extractLines(p)));
      const e = p.event || {};
      games.push({ eventId: e.id, away: e.away_team, home: e.home_team, commence: e.commence_time, snapshotTs: p.ts, hoursToKick: p.hoursToKick ?? null });
    }
    games.sort((a, b) => (a.commence || '').localeCompare(b.commence || ''));
    const edges = computeEdges(rows, rungs);
    const bySeriesMap = new Map<string, RungEdge[]>();
    for (const e of edges) { const a = bySeriesMap.get(e.series) || []; a.push(e); bySeriesMap.set(e.series, a); }
    const bySeries: SeriesSummary[] = [...bySeriesMap.entries()].map(([series, es]) => {
      const gaps = es.map(e => e.gapC).filter((g): g is number => g !== null).map(Math.abs);
      const best = es.map(e => e.bestEdgeC).filter((b): b is number => b !== null);
      return { series, label: SERIES_LABEL[series] || series, matched: es.length, medianAbsGapC: q(gaps, 0.5), p90AbsGapC: q(gaps, 0.9), overRule: best.filter(b => b >= RULE.minNetEdgeC).length, bestEdgeC: best.length ? Math.max(...best) : null };
    }).sort((a, b) => b.matched - a.matched);
    const ranked = edges.filter(e => e.bestEdgeC !== null).sort((a, b) => (b.bestEdgeC as number) - (a.bestEdgeC as number));
    return { kalshiTs: kalshi.ts, kalshiRows: rows.length, games, fairRungs: rungs.length, matched: edges.length, bySeries, top: ranked.slice(0, 40), overRule: ranked.filter(e => (e.bestEdgeC as number) >= RULE.minNetEdgeC), generatedAt };
  } catch (error) {
    return { kalshiTs: '', kalshiRows: 0, games: [], fairRungs: 0, matched: 0, bySeries: [], top: [], overRule: [], generatedAt, error: error instanceof Error ? error.message : String(error) };
  }
}
