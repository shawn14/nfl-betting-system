#!/usr/bin/env node
/**
 * Market history — every final game with its OPEN and CLOSE prices, for all five sports, straight
 * from ESPN (free). This is the raw material for `npm run market-lab`: thousands of games per sport
 * instead of the few hundred graded rows our own blobs hold.
 *
 *   npm run market-history              # all sports, incremental
 *   npm run market-history -- nba cbb   # some sports
 *
 * ESPN keeps book prices back to the 2023-24 season (NBA/NHL/CBB/WNBA) and the 2024 NFL season;
 * earlier events return an odds item without open/close blocks (probed 2026-09-25).
 *
 * Cache: data/market-history/<sport>.json (commit it)
 *   dates:  { "YYYYMMDD": true }            scoreboard days already scanned (only days >= 2 days old)
 *   games:  { id: [date, seasonType, neutral, homeId, awayId, homeAbbr, awayAbbr, homeScore, awayScore] }
 *   prices: { id: [provider, open8, close8] | null }
 *           open8/close8 = [mlHome, mlAway, spreadLine(home), spreadHomePrice, spreadAwayPrice, totalLine, overPrice, underPrice]
 *           missing values are null. Prices are stored raw; sanity filtering happens in the lab.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseEspnPrices, espnOddsUrl } from '../src/lib/espn-prices.ts';

const SITE = {
  nfl: 'football/nfl', nba: 'basketball/nba', nhl: 'hockey/nhl',
  cbb: 'basketball/mens-college-basketball', wnba: 'basketball/wnba',
};
// First day with book prices on ESPN, per sport.
const START = { nfl: '20240901', nba: '20231001', nhl: '20231001', cbb: '20231101', wnba: '20240501' };
// Off-season months (no games worth a scoreboard call). 1-based months.
const IN_SEASON = {
  nfl: m => m >= 9 || m <= 2, nba: m => m >= 10 || m <= 6, nhl: m => m >= 10 || m <= 6,
  cbb: m => m >= 11 || m <= 4, wnba: m => m >= 5 && m <= 10,
};
const EXTRA = { cbb: '&groups=50&limit=500' };

const args = process.argv.slice(2).filter(a => SITE[a]);
const SPORTS = args.length ? args : Object.keys(SITE);
const DIR = path.join(process.cwd(), 'data/market-history');

async function getJson(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(text);           // ESPN's edge sometimes answers an HTML block page
    } catch (e) {
      if (i === 3) throw e;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
}

async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); }));
}

function days(from, to) {
  const out = [];
  const d = new Date(Date.UTC(+from.slice(0, 4), +from.slice(4, 6) - 1, +from.slice(6, 8)));
  const end = new Date(Date.UTC(+to.slice(0, 4), +to.slice(4, 6) - 1, +to.slice(6, 8)));
  for (; d <= end; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10).replace(/-/g, ''));
  return out;
}

const snap8 = s => [s.mlHome, s.mlAway, s.spreadLine, s.spreadHomePrice, s.spreadAwayPrice, s.totalLine, s.overPrice, s.underPrice].map(v => v ?? null);

async function crawl(sport) {
  const file = path.join(DIR, `${sport}.json`);
  const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { dates: {}, games: {}, prices: {} };
  const settled = new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const todo = days(START[sport], settled).filter(d => !db.dates[d] && IN_SEASON[sport](+d.slice(4, 6)));

  let newGames = 0, failedDays = 0;
  await pool(todo, 6, async d => {
    try {
      const sb = await getJson(`https://site.api.espn.com/apis/site/v2/sports/${SITE[sport]}/scoreboard?dates=${d}${EXTRA[sport] ?? '&limit=200'}`);
      for (const e of sb?.events ?? []) {
        const c = e.competitions?.[0];
        if (!c?.status?.type?.completed) continue;
        const home = c.competitors?.find(x => x.homeAway === 'home');
        const away = c.competitors?.find(x => x.homeAway === 'away');
        if (!home || !away) continue;
        const hs = Number(home.score), as = Number(away.score);
        if (!Number.isFinite(hs) || !Number.isFinite(as)) continue;
        if (!db.games[e.id]) newGames++;
        db.games[e.id] = [e.date, e.season?.type ?? null, c.neutralSite ? 1 : 0, home.team?.id, away.team?.id,
          home.team?.abbreviation, away.team?.abbreviation, hs, as];
      }
      db.dates[d] = true;
    } catch (err) {
      failedDays++;
      console.warn(`  ${sport} ${d}: ${err.message} (will retry next run)`);
    }
  });

  const need = Object.keys(db.games).filter(id => !(id in db.prices));
  let priced = 0, none = 0, failed = 0;
  await pool(need, 8, async id => {
    try {
      const json = await getJson(espnOddsUrl(sport, id));
      const p = parseEspnPrices(json?.items?.[0]);
      db.prices[id] = p ? [p.provider, snap8(p.open), snap8(p.close)] : null;
      p ? priced++ : none++;
    } catch {
      failed++;                         // left uncached: retried next run
    }
  });

  fs.mkdirSync(DIR, { recursive: true });
  const sortKeys = o => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]));
  fs.writeFileSync(file, JSON.stringify({ dates: sortKeys(db.dates), games: sortKeys(db.games), prices: sortKeys(db.prices) }) + '\n');
  const total = Object.keys(db.games).length;
  const withClose = Object.values(db.prices).filter(p => p && p[2].some(v => v !== null)).length;
  console.log(`${sport}: scanned ${todo.length - failedDays} days (+${newGames} games), prices +${priced} (none ${none}, failed ${failed}) · total ${total} games, ${withClose} with a close`);
}

for (const s of SPORTS) await crawl(s);
