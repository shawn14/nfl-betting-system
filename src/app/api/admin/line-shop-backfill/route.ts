import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { gzipSync } from 'zlib';

// One-time historical proof for the line shop (src/lib/line-shop.ts) on real GAME lines.
// Downloads The Odds API historical snapshots of the 2025 NFL regular season (10 books incl.
// Pinnacle, h2h/spreads/totals) and stores them raw; grading runs locally from these public files
// with the same engine (`npm run line-shop-backfill-proof`), so the API key never leaves Vercel.
//
//   per week: one EARLY snapshot (Wednesday 16:00 UTC, ~4 days before Sunday, every game that week)
//             one CLOSE snapshot 5 min before each distinct kickoff time found in the early snapshot
//   cost:     historical = 10 credits x markets (3) with <= 10 named books = 30 per snapshot
//   budget:   ~6 snapshots x 18 weeks x 30 = ~3,240; hard cap CREDIT_CAP across all invocations
//
// Resumable: state in line-shop-backfill/nfl-2025/state.json; each call works ~240 s then returns.
// Approved by Shawn 2026-09-26 as a one-time ~3,200-credit spend. Needs ?confirm=nfl-2025.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PREFIX = 'line-shop-backfill/nfl-2025';
const SPORT = 'americanfootball_nfl';
const BOOKS = ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'williamhill_us', 'betrivers', 'fanatics', 'bovada', 'betonlineag', 'lowvig'];
const MARKETS = ['h2h', 'spreads', 'totals'];
const WEEK1_WED = Date.UTC(2025, 8, 3, 16, 0, 0);   // Wed 2025-09-03 16:00 UTC; week 1 kicks off Thu 09-04
const WEEKS = 18;
const CREDIT_CAP = 3400;
const TIME_BUDGET_MS = 240_000;

interface State { credits: number; weeks: Record<string, { early?: string; closes: string[]; done: string[] }>; finished?: boolean; updated?: string }

const putOpts = { access: 'public' as const, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function loadState(): Promise<State> {
  try {
    const res = await list({ prefix: `${PREFIX}/state.json`, limit: 1 });
    const b = res.blobs.find(x => x.pathname === `${PREFIX}/state.json`);
    if (!b) return { credits: 0, weeks: {} };
    return (await (await fetch(`${b.url}?t=${Date.now()}`, { cache: 'no-store' })).json()) as State;
  } catch {
    return { credits: 0, weeks: {} };
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get('confirm') !== 'nfl-2025') {
    return NextResponse.json({ ok: false, error: 'one-time credit-spending backfill: add ?confirm=nfl-2025' }, { status: 400 });
  }
  const key = (process.env.NEXT_PUBLIC_ODDS_API_KEY || '').trim();
  if (!key) return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_ODDS_API_KEY not set' }, { status: 500 });
  const started = Date.now();
  const state = await loadState();
  if (state.finished) return NextResponse.json({ ok: true, finished: true, credits: state.credits });
  const log: string[] = [];
  let remaining: number | null = null, calls = 0;

  const snapshot = async (dateMs: number, file: string) => {
    const url = `https://api.the-odds-api.com/v4/historical/sports/${SPORT}/odds?apiKey=${key}&bookmakers=${BOOKS.join(',')}&markets=${MARKETS.join(',')}&oddsFormat=american&date=${iso(dateMs)}`;
    const r = await fetch(url, { cache: 'no-store' });
    const cost = Number(r.headers.get('x-requests-last') || 30);
    remaining = Number(r.headers.get('x-requests-remaining') || remaining || 0);
    state.credits += cost; calls++;
    if (!r.ok) throw new Error(`historical ${iso(dateMs)} ${r.status} ${(await r.text()).slice(0, 200)}`);
    const body = await r.json();
    await put(`${PREFIX}/${file}.json.gz`, gzipSync(Buffer.from(JSON.stringify({ requested: iso(dateMs), ...body }))), { ...putOpts, contentType: 'application/gzip' });
    return body as { timestamp: string; data: { id: string; commence_time: string }[] };
  };

  try {
    outer:
    for (let w = 1; w <= WEEKS; w++) {
      const wk = (state.weeks[w] ??= { closes: [], done: [] });
      const from = WEEK1_WED + (w - 1) * 7 * 864e5, to = from + 7 * 864e5;
      if (!wk.early) {
        if (state.credits + 30 > CREDIT_CAP) { log.push('credit cap'); break; }
        const body = await snapshot(from, `w${String(w).padStart(2, '0')}-early`);
        const kicks = new Set(body.data.map(e => Date.parse(e.commence_time)).filter(t => t >= from && t < to));
        wk.early = body.timestamp; wk.closes = [...kicks].sort((a, b) => a - b).map(iso);
      }
      for (const k of wk.closes) {
        if (wk.done.includes(k)) continue;
        if (Date.now() - started > TIME_BUDGET_MS) { log.push('time budget; call again to resume'); break outer; }
        if (state.credits + 30 > CREDIT_CAP) { log.push('credit cap'); break outer; }
        await snapshot(Date.parse(k) - 5 * 6e4, `w${String(w).padStart(2, '0')}-close-${k.replace(/[:]/g, '')}`);
        wk.done.push(k);
      }
      if (Date.now() - started > TIME_BUDGET_MS) { log.push('time budget; call again to resume'); break; }
    }
    state.finished = Object.keys(state.weeks).length === WEEKS && Object.values(state.weeks).every(x => x.early && x.done.length === x.closes.length);
  } catch (e) {
    log.push(e instanceof Error ? e.message : String(e));
  }
  state.updated = iso(Date.now());
  await put(`${PREFIX}/state.json`, JSON.stringify(state), { ...putOpts, contentType: 'application/json' });
  const snaps = Object.values(state.weeks).reduce((s, x) => s + (x.early ? 1 : 0) + x.done.length, 0);
  return NextResponse.json({ ok: true, finished: !!state.finished, calls, credits: state.credits, remaining, snapshots: snaps, weeks: Object.keys(state.weeks).length, log, ms: Date.now() - started });
}
