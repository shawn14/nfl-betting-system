import { impliedProb } from '@/lib/fair-value';
import type { ShopResult } from '@/lib/line-shop';

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
