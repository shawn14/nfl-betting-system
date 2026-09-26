import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { gzipSync } from 'zlib';
import { stampParts } from '@/lib/kalshi-props';
import { shop, gameMarkets, LINE_SHOP_VERSION, type OddsApiEvent } from '@/lib/line-shop';
import type { Board, BoardEvent, Ledger, LedgerEntry } from '@/lib/odds-board';

// Line-shop board: multi-book game odds (moneyline, spread, total) for every sport we cover, priced
// against a sharp fair value (Pinnacle, else leave-one-out consensus) by src/lib/line-shop.ts.
// Single writer -> Blob -> many readers: /ev reads odds-board/latest.json; visitors never call the API.
//
// Cost model: one /odds call per sport returns the whole slate; cost = markets (3) x ceil(books/10)
// = 3 credits. /events (used to decide whether a sport is due) is free. Cadence per sport: every
// 30 min when a game starts within 6h, every 2h when the next game is 6-36h out, nothing otherwise.
// Worst case ~3 sports x 48 runs x 3 = 432 credits/day. Caps: DAILY_CREDIT_CAP and the same monthly
// floor as the props recorder (read from response headers).
//
// Also writes:
//   odds-board/snap/<day>/<HHMM>-<sport>.json.gz  raw responses (future backtests)
//   odds-board/ledger.json                         every flag ever shown, with the price, and the
//                                                  sharp fair of the same side at the same line on the
//                                                  last run before the game (closing line value)

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const PREFIX = 'odds-board';
const SPORTS: Record<string, string> = {
  nfl: 'americanfootball_nfl', nba: 'basketball_nba', wnba: 'basketball_wnba', nhl: 'icehockey_nhl', cbb: 'basketball_ncaab',
};
// <= 10 books keeps the cost at one region-equivalent. Pinnacle is the sharp reference.
const BOOKS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'fanatics', 'bovada', 'betonlineag', 'lowvig'];
const MARKETS = ['h2h', 'spreads', 'totals'];
const HORIZON_H = 36;
const DAILY_CREDIT_CAP = 1500;
const MIN_MONTHLY_REMAINING = 20000;
const LEDGER_KEEP_DAYS = 180;

interface State { day: string; creditsToday: number; lastFetch: Record<string, string>; lastRemaining?: number; updated?: string }

const putOpts = { access: 'public' as const, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await list({ prefix: path, limit: 1 });
    const b = res.blobs.find(x => x.pathname === path);
    if (!b) return fallback;
    const r = await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' });
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  return request.headers.get('authorization') === `Bearer ${secret}` || url.searchParams.get('secret') === secret;
}

export async function GET(request: Request) {
  const started = Date.now();
  // ?force=1 ignores cadence (spends credits) and needs the cron secret; normal runs are cadence-gated.
  const force = new URL(request.url).searchParams.get('force') === '1';
  if (force && !authorized(request)) return NextResponse.json({ ok: false, error: 'force needs CRON_SECRET' }, { status: 401 });
  const key = (process.env.NEXT_PUBLIC_ODDS_API_KEY || '').trim();
  if (!key) return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_ODDS_API_KEY not set' }, { status: 500 });

  const now = new Date();
  const { day, hhmm, iso } = stampParts(now);
  const state = await loadJson<State>(`${PREFIX}/state.json`, { day: '', creditsToday: 0, lastFetch: {} });
  if (state.day !== day) { state.day = day; state.creditsToday = 0; }
  const board = await loadJson<Board>(`${PREFIX}/latest.json`, { version: LINE_SHOP_VERSION, updated: iso, sports: {} });
  const ledger = await loadJson<Ledger>(`${PREFIX}/ledger.json`, { updated: iso, entries: [] });
  const log: string[] = [];
  let remaining = state.lastRemaining ?? 0, spent = 0;
  const fetched: string[] = [];

  try {
    for (const [sport, apiKey] of Object.entries(SPORTS)) {
      const evRes = await fetch(`https://api.the-odds-api.com/v4/sports/${apiKey}/events?apiKey=${key}`, { cache: 'no-store' });
      if (!evRes.ok) { log.push(`${sport} events ${evRes.status}`); continue; }
      const events: { commence_time: string }[] = await evRes.json();
      const hrs = events.map(e => (Date.parse(e.commence_time) - now.getTime()) / 3.6e6).filter(h => h > 0 && h < HORIZON_H);
      if (!hrs.length) {                             // off-season or nothing soon: drop stale games from the board
        if (board.sports[sport]) board.sports[sport].events = board.sports[sport].events.filter(e => Date.parse(e.commence) > now.getTime());
        continue;
      }
      const due = Math.min(...hrs) < 6 ? 30 : 120;
      const since = state.lastFetch[sport] ? (now.getTime() - Date.parse(state.lastFetch[sport])) / 6e4 : Infinity;
      if (!force && since < due - 2) continue;
      if (state.creditsToday + MARKETS.length > DAILY_CREDIT_CAP) { log.push('daily credit cap reached'); break; }
      if (remaining && remaining - MARKETS.length < MIN_MONTHLY_REMAINING) { log.push(`monthly floor reached (remaining ${remaining})`); break; }

      const to = new Date(now.getTime() + HORIZON_H * 3.6e6).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const url = `https://api.the-odds-api.com/v4/sports/${apiKey}/odds?apiKey=${key}&bookmakers=${BOOKS.join(',')}&markets=${MARKETS.join(',')}&oddsFormat=american&commenceTimeTo=${to}`;
      const r = await fetch(url, { cache: 'no-store' });
      const cost = Number(r.headers.get('x-requests-last') || MARKETS.length);
      remaining = Number(r.headers.get('x-requests-remaining') || remaining);
      state.creditsToday += cost; spent += cost;
      if (!r.ok) { log.push(`${sport} odds ${r.status} ${(await r.text()).slice(0, 160)}`); continue; }
      const data: OddsApiEvent[] = await r.json();
      await put(`${PREFIX}/snap/${day}/${hhmm}-${sport}.json.gz`, gzipSync(Buffer.from(JSON.stringify({ ts: iso, sport, cost, remaining, data }))),
        { ...putOpts, contentType: 'application/gzip' });

      const evs: BoardEvent[] = data
        .filter(e => Date.parse(e.commence_time) > now.getTime())
        .map(e => ({ id: e.id, sport, commence: e.commence_time, home: e.home_team, away: e.away_team, markets: gameMarkets(e).map(shop) }))
        .sort((a, b) => a.commence.localeCompare(b.commence));
      board.sports[sport] = { fetchedAt: iso, events: evs };
      state.lastFetch[sport] = iso;
      fetched.push(`${sport}:${evs.length}`);

      // Ledger: record new flags at the price shown; refresh the close for games not started yet.
      const byKey = new Map(ledger.entries.map(x => [x.key, x]));
      for (const ev of evs) {
        for (const m of ev.markets) {
          for (const f of m.flags) {
            const k = `${m.id}|${f.label}|${f.book}`;
            if (!byKey.has(k)) {
              const entry: LedgerEntry = { key: k, sport, eventId: ev.id, commence: ev.commence, matchup: `${ev.away} @ ${ev.home}`,
                market: m.market, line: m.line, label: f.label, book: f.book, price: f.price, fairProb: f.fairProb, ev: f.ev,
                fairSource: m.fairSource ?? 'consensus', flaggedAt: iso };
              ledger.entries.push(entry); byKey.set(k, entry);
            }
          }
          if (m.fairA == null) continue;
          for (const e of ledger.entries) {
            if (!e.key.startsWith(`${m.id}|`) || Date.parse(e.commence) <= now.getTime()) continue;
            const sideA = e.label === m.bestA?.label;
            e.closeFair = sideA ? m.fairA : 1 - m.fairA; e.closeAt = iso;
          }
        }
      }
    }

    const cutoff = now.getTime() - LEDGER_KEEP_DAYS * 864e5;
    ledger.entries = ledger.entries.filter(e => Date.parse(e.commence) > cutoff);
    ledger.updated = iso; board.updated = iso; board.version = LINE_SHOP_VERSION;
    state.lastRemaining = remaining; state.updated = iso;
    await put(`${PREFIX}/latest.json`, JSON.stringify(board), { ...putOpts, contentType: 'application/json' });
    await put(`${PREFIX}/ledger.json`, JSON.stringify(ledger), { ...putOpts, contentType: 'application/json' });
    await put(`${PREFIX}/state.json`, JSON.stringify(state), { ...putOpts, contentType: 'application/json' });
    const flags = Object.values(board.sports).reduce((s, x) => s + x.events.reduce((t, e) => t + e.markets.reduce((u, m) => u + m.flags.length, 0), 0), 0);
    return NextResponse.json({ ok: true, fetched, creditsSpent: spent, creditsToday: state.creditsToday, remaining, flags, ledger: ledger.entries.length, log, ms: Date.now() - started });
  } catch (error) {
    console.error('odds-board-record failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), log }, { status: 500 });
  }
}
