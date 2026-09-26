import { gunzipSync } from 'zlib';
import { impliedProb } from '@/lib/fair-value';
import { shop, propMarkets, type OddsApiEvent, type ShopResult, type SideShop } from '@/lib/line-shop';

/**
 * Reader side of the line-shop board. The cron (api/cron/odds-board-record) is the only writer;
 * pages read these two Blob files through the Next data cache (5 min), so traffic never reaches
 * The Odds API.
 */
const BLOB = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com/odds-board';

export interface BoardEvent {
  id: string; sport: string; commence: string; home: string; away: string;
  markets: ShopResult[];
}
export interface Board { version: string; updated: string; sports: Record<string, { fetchedAt: string; events: BoardEvent[] }> }

export interface LedgerEntry {
  key: string; sport: string; eventId: string; commence: string; matchup: string; market: string; line?: number;
  label: string; book: string; price: number; fairProb: number; ev: number; fairSource: string; flaggedAt: string;
  closeFair?: number; closeAt?: string;   // same side, same line, last run before the game
}
export interface Ledger { updated: string; entries: LedgerEntry[] }

async function get<T>(file: string): Promise<T | null> {
  try {
    const r = await fetch(`${BLOB}/${file}`, { next: { revalidate: 300 } });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

export const loadBoard = () => get<Board>('latest.json');
export const loadLedger = () => get<Ledger>('ledger.json');

/**
 * Closing line value of every ledger flag whose game has started: the sharp fair probability of the
 * same side at the same line on the last run before the game, minus the probability the price paid.
 */
export function ledgerClv(ledger: Ledger | null, now = Date.now()) {
  const closed = (ledger?.entries ?? []).filter(e => Date.parse(e.commence) <= now && e.closeFair != null);
  const clv = closed.map(e => e.closeFair! - impliedProb(e.price));
  const n = clv.length;
  const mean = n ? clv.reduce((a, b) => a + b, 0) / n : 0;
  const se = n > 1 ? Math.sqrt(clv.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) / n) : 0;
  return { flagged: ledger?.entries.length ?? 0, graded: n, clv: mean, se, pctPositive: n ? clv.filter(x => x > 0).length / n : 0 };
}

// ---------------------------------------------------------------- NFL player props (no extra credits)


const PROPS = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com/odds-props';

export interface PropFlag { eventId: string; matchup: string; commence: string; snapshotTs: string; books: number; flag: SideShop }

/**
 * Line-shop flags on NFL player props, from the props recorder's latest multi-book snapshot per
 * upcoming game (odds-props/snap, 8 US books, refreshed down to every 15 min near kickoff). Props are
 * where books disagree: replayed on stored snapshots the flags beat the close by +0.6% (z ~12),
 * while NFL sides/totals four days out rarely give a price worth taking (2025 backfill).
 * Fair = leave-one-out consensus (no Pinnacle props in the US feed).
 */
export async function loadPropFlags(now = Date.now()): Promise<{ flags: PropFlag[]; games: number; updated: string | null }> {
  try {
    const idx = await (await fetch(`${PROPS}/index.json`, { next: { revalidate: 300 } })).json();
    const latest = new Map<string, string>();
    for (const s of (idx.snapshots || []) as { path: string }[]) {
      const m = s.path.match(/-([0-9a-f]{32})\.json\.gz$/);
      if (m && (!latest.has(m[1]) || s.path > latest.get(m[1])!)) latest.set(m[1], s.path);
    }
    // Only the newest ~20 events can still be upcoming; paths sort chronologically.
    const recent = [...latest.values()].sort().slice(-20);
    const payloads = await Promise.all(recent.map(async p => {
      try {
        const r = await fetch(`${PROPS.replace(/\/odds-props$/, '')}/${p}`, { next: { revalidate: 300 } });
        return r.ok ? JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())).toString('utf8')) : null;
      } catch { return null; }
    }));
    const flags: PropFlag[] = [];
    let games = 0, updated: string | null = null;
    for (const p of payloads) {
      const e = p?.data as OddsApiEvent | undefined;
      if (!e || Date.parse(e.commence_time) <= now) continue;
      games++;
      if (!updated || p.ts > updated) updated = p.ts;
      for (const tw of propMarkets(e)) {
        const r = shop(tw);
        for (const f of r.flags) flags.push({ eventId: e.id, matchup: `${e.away_team} @ ${e.home_team}`, commence: e.commence_time, snapshotTs: p.ts, books: r.books, flag: f });
      }
    }
    flags.sort((a, b) => b.flag.ev - a.flag.ev);
    return { flags, games, updated };
  } catch {
    return { flags: [], games: 0, updated: null };
  }
}
