import { NextResponse } from 'next/server';
import { put, list } from '@vercel/blob';
import { gzipSync } from 'zlib';
import { stampParts, rebuildBlobIndex } from '@/lib/kalshi-props';

// Props watch, sportsbook side. Runs every 15 minutes; for each upcoming NFL event decides whether
// it is due (cadence tightens toward kickoff) and, if so, fetches the player-prop markets that map
// onto Kalshi ladders from The Odds API (7-8 US books) and stores the raw response gzipped under
// odds-props/snap/<day>/<HHMM>-<eventId>.json.gz. Credit budget is enforced from the response
// headers: a fixed per-day cap and a hard floor on monthly credits remaining.
//
// Cost model (verified 2026-09-11): 1 credit per market per event per region. 20 markets → 20 credits
// per event fetch, ~320 for a 16-game sweep. `?force=1` fetches every upcoming event regardless of cadence.

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PREFIX = 'odds-props';
const SPORT = 'americanfootball_nfl';
const MARKETS = [
  // two-sided main lines
  'player_pass_yds', 'player_pass_tds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_interceptions',
  'player_rush_yds', 'player_rush_attempts', 'player_receptions', 'player_reception_yds', 'player_anytime_td', 'player_rush_reception_yds',
  // one-sided alternate ladders — land exactly on Kalshi's N+ rungs
  'player_rush_yds_alternate', 'player_reception_yds_alternate', 'player_receptions_alternate', 'player_pass_yds_alternate',
  'player_pass_attempts_alternate', 'player_pass_completions_alternate', 'player_pass_tds_alternate', 'player_rush_attempts_alternate',
  // one-of-many: first touchdown scorer (Kalshi KXNFLFIRSTTD)
  'player_1st_td',
];
const DAILY_CREDIT_CAP = 8000;          // hard stop per UTC day
const MIN_MONTHLY_REMAINING = 20000;    // never spend the last 20k of the month's quota
const LOOKAHEAD_DAYS = 7;

function cadenceMinutes(hoursToKick: number): number {
  if (hoursToKick > 24) return 480;   // 3x/day far out
  if (hoursToKick > 6) return 180;
  if (hoursToKick > 1.5) return 30;
  return 15;                           // every run inside 90 minutes
}

interface State { day: string; creditsToday: number; lastFetch: Record<string, string>; lastRemaining?: number; updated?: string }

async function loadState(): Promise<State> {
  try {
    const res = await list({ prefix: `${PREFIX}/state.json`, limit: 1 });
    const b = res.blobs[0];
    if (!b) throw new Error('no state yet');
    const r = await fetch(b.url, { cache: 'no-store' });
    return (await r.json()) as State;
  } catch {
    return { day: '', creditsToday: 0, lastFetch: {} };
  }
}

const putOpts = { access: 'public' as const, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 };

export async function GET(request: Request) {
  const started = Date.now();
  const force = new URL(request.url).searchParams.get('force') === '1';
  const key = (process.env.NEXT_PUBLIC_ODDS_API_KEY || '').trim();
  if (!key) return NextResponse.json({ ok: false, error: 'NEXT_PUBLIC_ODDS_API_KEY not set' }, { status: 500 });
  const now = new Date(); const { day, hhmm, iso } = stampParts(now);
  const state = await loadState();
  if (state.day !== day) { state.day = day; state.creditsToday = 0; }
  const log: string[] = [];
  try {
    const evRes = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT}/events?apiKey=${key}`, { cache: 'no-store' });
    if (!evRes.ok) throw new Error(`events ${evRes.status}`);
    const events: Array<{ id: string; commence_time: string; home_team: string; away_team: string }> = await evRes.json();
    let remaining = Number(evRes.headers.get('x-requests-remaining') || state.lastRemaining || 0);
    const upcoming = events.filter(e => {
      const h = (new Date(e.commence_time).getTime() - now.getTime()) / 3.6e6;
      return h > -0.25 && h < LOOKAHEAD_DAYS * 24;
    });
    let fetched = 0, skipped = 0, spent = 0;
    for (const e of upcoming) {
      const hoursToKick = (new Date(e.commence_time).getTime() - now.getTime()) / 3.6e6;
      const due = cadenceMinutes(hoursToKick);
      const last = state.lastFetch[e.id] ? (now.getTime() - new Date(state.lastFetch[e.id]).getTime()) / 6e4 : Infinity;
      if (!force && last < due) { skipped++; continue; }
      if (state.creditsToday + MARKETS.length > DAILY_CREDIT_CAP) { log.push('daily credit cap reached'); break; }
      if (remaining && remaining - MARKETS.length < MIN_MONTHLY_REMAINING) { log.push(`monthly floor reached (remaining ${remaining})`); break; }
      const url = `https://api.the-odds-api.com/v4/sports/${SPORT}/events/${e.id}/odds?apiKey=${key}&regions=us&markets=${MARKETS.join(',')}&oddsFormat=american`;
      const r = await fetch(url, { cache: 'no-store' });
      const cost = Number(r.headers.get('x-requests-last') || MARKETS.length);
      remaining = Number(r.headers.get('x-requests-remaining') || remaining);
      if (!r.ok) { log.push(`event ${e.id} ${r.status}`); continue; }
      const data = await r.json();
      const payload = { ts: iso, source: 'the-odds-api v4', event: e, hoursToKick: Math.round(hoursToKick * 100) / 100, cost, remaining, markets: MARKETS, data };
      const gz = gzipSync(Buffer.from(JSON.stringify(payload)));
      await put(`${PREFIX}/snap/${day}/${hhmm}-${e.id}.json.gz`, gz, { ...putOpts, contentType: 'application/gzip' });
      state.lastFetch[e.id] = iso; state.creditsToday += cost; spent += cost; fetched++;
    }
    for (const id of Object.keys(state.lastFetch)) if (!upcoming.some(e => e.id === id)) delete state.lastFetch[id];
    state.lastRemaining = remaining; state.updated = iso;
    await put(`${PREFIX}/state.json`, JSON.stringify(state), { ...putOpts, contentType: 'application/json' });
    const indexed = await rebuildBlobIndex(PREFIX); // always: readers enumerate snapshots from this file
    return NextResponse.json({ ok: true, upcoming: upcoming.length, fetched, skipped, creditsSpent: spent, creditsToday: state.creditsToday, remaining, indexed, log, ms: Date.now() - started });
  } catch (error) {
    console.error('odds-props-record failed:', error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error), log }, { status: 500 });
  }
}
