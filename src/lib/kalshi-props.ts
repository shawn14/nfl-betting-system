// Kalshi NFL prop-ladder capture (public API, no key). Part of the props watch:
// record Kalshi rungs + sportsbook lines side by side, measure gaps and convergence, then paper-trade.
// Design note: prices come from the *_dollars / *_fp fields — the legacy cent fields are null on the
// public endpoint. Never send a spoofed browser User-Agent (Kalshi/ESPN edges 403 those).

import { list, put } from '@vercel/blob';

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// Player-prop ladders (one market per player per threshold) plus the three game markets as reference.
export const KALSHI_NFL_PROP_SERIES = [
  'KXNFLPASSYDS', 'KXNFLRSHYDS', 'KXNFLRECYDS', 'KXNFLREC', 'KXNFLTD',
  'KXNFLPASSTDS', 'KXNFLRSHATT', 'KXNFLPASSATT', 'KXNFLPASSCOMP', 'KXNFLPASSINT',
  'KXNFLRRYDS', 'KXNFLFIRSTTD',
] as const;
export const KALSHI_NFL_GAME_SERIES = ['KXNFLGAME', 'KXNFLSPREAD', 'KXNFLTOTAL'] as const;

// Compact row layout (arrays keep a 4,000-market snapshot small). Order is the contract for readers.
export const SNAPSHOT_COLS = [
  'ticker', 'event', 'series', 'subtitle', 'strike',
  'yes_bid', 'yes_ask', 'yes_bid_size', 'yes_ask_size', 'last', 'volume', 'open_interest', 'close_time', 'status',
] as const;
export type SnapshotRow = [string, string, string, string, number | null,
  number | null, number | null, number | null, number | null, number | null, number | null, number | null, string, string];

interface KalshiMarket {
  ticker: string; event_ticker: string; yes_sub_title?: string; floor_strike?: number | string | null;
  yes_bid_dollars?: string; yes_ask_dollars?: string; yes_bid_size_fp?: string; yes_ask_size_fp?: string;
  last_price_dollars?: string; volume_fp?: string; open_interest_fp?: string; close_time?: string; status?: string;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getJson(url: string, retries = 2): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const ct = res.headers.get('content-type') || '';
      if (!res.ok || !ct.includes('json')) throw new Error(`Kalshi ${res.status} ${ct.split(';')[0]}: ${url}`);
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await new Promise(r => setTimeout(r, 400 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** All open markets of one series (paginated; RECYDS alone is >1,000 markets). */
export async function fetchSeriesMarkets(series: string): Promise<KalshiMarket[]> {
  const out: KalshiMarket[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const data = await getJson(`${KALSHI_BASE}/markets?series_ticker=${series}&status=open&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...(data.markets || []));
    cursor = data.cursor || '';
    if (!cursor || !(data.markets || []).length) break;
  }
  return out;
}

export function toRow(m: KalshiMarket, series: string): SnapshotRow {
  return [
    m.ticker, m.event_ticker, series, m.yes_sub_title || '', num(m.floor_strike),
    num(m.yes_bid_dollars), num(m.yes_ask_dollars), num(m.yes_bid_size_fp), num(m.yes_ask_size_fp),
    num(m.last_price_dollars), num(m.volume_fp), num(m.open_interest_fp), m.close_time || '', m.status || '',
  ];
}

/** Snapshot every configured series. Returns rows plus per-series counts and any series that failed. */
export async function snapshotNflLadders(): Promise<{ rows: SnapshotRow[]; counts: Record<string, number>; failed: string[] }> {
  const rows: SnapshotRow[] = []; const counts: Record<string, number> = {}; const failed: string[] = [];
  for (const series of [...KALSHI_NFL_PROP_SERIES, ...KALSHI_NFL_GAME_SERIES]) {
    try {
      const ms = await fetchSeriesMarkets(series);
      counts[series] = ms.length;
      for (const m of ms) rows.push(toRow(m, series));
    } catch (err) {
      failed.push(`${series}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { rows, counts, failed };
}

/** Blob path helpers shared by the two recorders. */
export function stampParts(d = new Date()): { day: string; hhmm: string; iso: string } {
  const iso = d.toISOString();
  return { day: iso.slice(0, 10), hhmm: iso.slice(11, 13) + iso.slice(14, 16), iso };
}

/**
 * Rebuild `<prefix>/index.json` from the Blob listing of `<prefix>/snap/`. The listing is authoritative;
 * the index lets offline readers (kalshi-mm-v14 tools/props_watch/fetch.py) enumerate snapshots without
 * a Blob token. Returns the number of snapshot files indexed.
 */
export async function rebuildBlobIndex(prefix: string): Promise<number> {
  const entries: Array<{ path: string; size: number; uploadedAt: string }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 60; page++) {
    const res = await list({ prefix: `${prefix}/snap/`, limit: 1000, cursor });
    for (const b of res.blobs) entries.push({ path: b.pathname, size: b.size, uploadedAt: b.uploadedAt.toISOString() });
    if (!res.hasMore || !res.cursor) break;
    cursor = res.cursor;
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  await put(`${prefix}/index.json`, JSON.stringify({ updated: new Date().toISOString(), count: entries.length, snapshots: entries }), {
    access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
  });
  return entries.length;
}
