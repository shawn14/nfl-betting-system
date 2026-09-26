/**
 * Line shopping against a sharp fair price — the betting method with the strongest public track
 * record for retail bettors. The model is not involved: the market is the forecaster, and the edge
 * is a book whose price is out of line with where the sharp market says the game is.
 *
 *   fair prob   = Pinnacle with its margin removed when Pinnacle posts this exact market; otherwise
 *                 the MEDIAN de-vigged probability of the other books at the same line (leave-one-out:
 *                 the book being priced never votes on its own fair value), with at least
 *                 MIN_CONSENSUS_BOOKS of them.
 *   EV          = fair prob x payout at the book's price - (1 - fair prob)
 *   flag        = EV >= MIN_SHOP_EV at a book that is not the fair source
 *   arbitrage   = best price on each side implies < 100% in total: both sides together lock a profit
 *
 * Only exact-line matches are compared. Moving a fair probability across half a point is unsafe
 * where results pile up on key numbers (NFL 3/7, hockey's whole goals); the market lab measured
 * that a 1-goal NHL move is worth P(exactly that score), not what a normal curve says.
 *
 * Pure functions: the cron (api/cron/odds-board-record) and the local proof (scripts/line-shop-proof.mjs)
 * run this exact code.
 */
import { devigTwoWay, expectedValue, impliedProb, kellyFraction, type DevigMethod } from './fair-value.ts';

export const LINE_SHOP_VERSION = '2026-09-26-shop1';
export const MIN_SHOP_EV = 0.015;          // pre-declared: 1.5% expected return per unit vs the sharp fair
export const MIN_CONSENSUS_BOOKS = 4;      // without Pinnacle, need 4 other books at the same line
export const SHARP_BOOKS = ['pinnacle'];   // in priority order
const MAX_OVERROUND = 1.15;                // a two-way market with more margin than this is not a real quote
const MIN_OVERROUND = 0.995;               // both sides plus money = mismatched lines or a 3-way price

export interface Quote { book: string; a: number; b: number }   // American prices, side A / side B

export interface TwoWay {
  id: string;                  // stable key, e.g. "<eventId>|spreads|-3.5"
  market: 'ml' | 'spread' | 'total' | 'prop';
  line?: number;               // side A's line (home spread, total points, prop line)
  labelA: string; labelB: string;
  method: DevigMethod;         // power for moneylines (favourite-longshot bias), multiplicative otherwise
  quotes: Quote[];
}

export interface SideShop {
  label: string;
  book: string;                // book with the best price on this side
  price: number;
  fairProb: number;            // fair prob used for THIS book (leave-one-out when consensus)
  ev: number;
  stake: number;               // quarter Kelly, capped at 2% of bankroll
}

export interface ShopResult {
  id: string; market: TwoWay['market']; line?: number;
  fairA: number | null;        // headline fair prob of side A (all books when consensus)
  fairSource: string | null;   // 'pinnacle' | 'consensus'
  books: number;
  bestA: SideShop | null; bestB: SideShop | null;
  arb: number | null;          // guaranteed return when > 0 (e.g. 0.012 = 1.2% on total stake)
  flags: SideShop[];
}

export function validQuote(q: Quote): boolean {
  if (!Number.isFinite(q.a) || !Number.isFinite(q.b) || Math.abs(q.a) < 100 || Math.abs(q.b) < 100) return false;
  const o = impliedProb(q.a) + impliedProb(q.b);
  return o >= MIN_OVERROUND && o <= MAX_OVERROUND;
}

function median(xs: number[]): number {
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Fair prob of side A for pricing `forBook` (null when there is no trustworthy fair). */
function fairFor(quotes: Quote[], method: DevigMethod, forBook?: string): { p: number; source: string } | null {
  for (const sharp of SHARP_BOOKS) {
    const q = quotes.find(x => x.book === sharp);
    if (q) return { p: devigTwoWay(q.a, q.b, method), source: sharp };
  }
  const others = quotes.filter(q => q.book !== forBook);
  if (others.length < MIN_CONSENSUS_BOOKS) return null;
  return { p: median(others.map(q => devigTwoWay(q.a, q.b, method))), source: 'consensus' };
}

export function stakeFor(p: number, price: number): number {
  return Math.min(0.02, kellyFraction(p, price) / 4);
}

export function shop(tw: TwoWay): ShopResult {
  const quotes = tw.quotes.filter(validQuote);
  // One quote per book (the API can repeat a book across regions).
  const seen = new Set<string>();
  const qs = quotes.filter(q => (seen.has(q.book) ? false : (seen.add(q.book), true)));
  const head = fairFor(qs, tw.method);
  const out: ShopResult = {
    id: tw.id, market: tw.market, line: tw.line, fairA: head?.p ?? null, fairSource: head?.source ?? null,
    books: qs.length, bestA: null, bestB: null, arb: null, flags: [],
  };
  if (!qs.length) return out;

  const price = (side: 'a' | 'b') => {
    let best: SideShop | null = null;
    for (const q of qs) {
      const f = fairFor(qs, tw.method, q.book);
      const px = q[side];
      const better = !best || impliedProb(px) < impliedProb(best.price);
      if (!better) continue;
      const pf = f ? (side === 'a' ? f.p : 1 - f.p) : NaN;
      const ev = f ? expectedValue(pf, px) : NaN;
      best = { label: side === 'a' ? tw.labelA : tw.labelB, book: q.book, price: px, fairProb: pf, ev, stake: f && ev > 0 ? stakeFor(pf, px) : 0 };
    }
    return best;
  };
  out.bestA = price('a');
  out.bestB = price('b');

  const total = impliedProb(out.bestA!.price) + impliedProb(out.bestB!.price);
  if (total < 1) out.arb = 1 / total - 1;

  // Flags: every book/side clearing the bar (not just the best), excluding the fair source itself.
  for (const q of qs) {
    const f = fairFor(qs, tw.method, q.book);
    if (!f || f.source === q.book) continue;
    for (const side of ['a', 'b'] as const) {
      const pf = side === 'a' ? f.p : 1 - f.p;
      const ev = expectedValue(pf, q[side]);
      if (ev >= MIN_SHOP_EV) out.flags.push({ label: side === 'a' ? tw.labelA : tw.labelB, book: q.book, price: q[side], fairProb: pf, ev, stake: stakeFor(pf, q[side]) });
    }
  }
  out.flags.sort((x, y) => y.ev - x.ev);
  return out;
}

// ---------------------------------------------------------------- The Odds API adapters

type Outcome = { name: string; price: number; point?: number; description?: string };
type Market = { key: string; outcomes: Outcome[] };
export type OddsApiEvent = {
  id: string; commence_time: string; home_team: string; away_team: string;
  bookmakers: { key: string; markets: Market[] }[];
};

/** Game markets (h2h, spreads, totals) of one Odds API event as exact-line two-way markets. */
export function gameMarkets(e: OddsApiEvent): TwoWay[] {
  const byId = new Map<string, TwoWay>();
  const add = (id: string, base: Omit<TwoWay, 'quotes' | 'id'>, q: Quote) => {
    if (!byId.has(id)) byId.set(id, { id, ...base, quotes: [] });
    byId.get(id)!.quotes.push(q);
  };
  for (const bk of e.bookmakers) {
    for (const m of bk.markets) {
      if (m.key === 'h2h') {
        const h = m.outcomes.find(o => o.name === e.home_team), a = m.outcomes.find(o => o.name === e.away_team);
        if (h && a && m.outcomes.length === 2) add(`${e.id}|ml`, { market: 'ml', labelA: `${e.home_team} ML`, labelB: `${e.away_team} ML`, method: 'power' }, { book: bk.key, a: h.price, b: a.price });
      } else if (m.key === 'spreads') {
        const h = m.outcomes.find(o => o.name === e.home_team), a = m.outcomes.find(o => o.name === e.away_team);
        if (h && a && h.point != null && a.point != null && h.point === -a.point) {
          const L = h.point, fmt = (x: number) => (x > 0 ? `+${x}` : `${x}`);
          add(`${e.id}|spread|${L}`, { market: 'spread', line: L, labelA: `${e.home_team} ${fmt(L)}`, labelB: `${e.away_team} ${fmt(-L)}`, method: 'multiplicative' }, { book: bk.key, a: h.price, b: a.price });
        }
      } else if (m.key === 'totals') {
        const o = m.outcomes.find(x => x.name === 'Over'), u = m.outcomes.find(x => x.name === 'Under');
        if (o && u && o.point != null && o.point === u.point) {
          add(`${e.id}|total|${o.point}`, { market: 'total', line: o.point, labelA: `Over ${o.point}`, labelB: `Under ${o.point}`, method: 'multiplicative' }, { book: bk.key, a: o.price, b: u.price });
        }
      }
    }
  }
  return [...byId.values()];
}

/** Two-sided player props (Over/Under at the same point) — used by the local proof on stored data. */
export function propMarkets(e: OddsApiEvent): TwoWay[] {
  const byId = new Map<string, TwoWay>();
  for (const bk of e.bookmakers) {
    for (const m of bk.markets) {
      const players = new Set(m.outcomes.filter(o => o.description && o.point != null).map(o => `${o.description}|${o.point}`));
      for (const key of players) {
        const [player, pt] = key.split('|');
        const o = m.outcomes.find(x => x.name === 'Over' && x.description === player && String(x.point) === pt);
        const u = m.outcomes.find(x => x.name === 'Under' && x.description === player && String(x.point) === pt);
        if (!o || !u) continue;
        const id = `${e.id}|${m.key}|${player}|${pt}`;
        if (!byId.has(id)) byId.set(id, { id, market: 'prop', line: Number(pt), labelA: `${player} o${pt} ${m.key}`, labelB: `${player} u${pt} ${m.key}`, method: 'multiplicative', quotes: [] });
        byId.get(id)!.quotes.push({ book: bk.key, a: o.price, b: u.price });
      }
    }
  }
  return [...byId.values()];
}
