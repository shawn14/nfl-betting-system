#!/usr/bin/env node
/**
 * Game-line proof of the line-shop rule: 2025 NFL regular season, real historical prices from
 * 10 books incl. Pinnacle (fetched once by api/admin/line-shop-backfill into public Blob).
 *
 *   npm run line-shop-backfill-proof
 *
 * For each week: price every game in the EARLY snapshot (Wednesday, ~4 days out) with shop();
 * grade each flag against the CLOSE snapshot taken 5 minutes before that game's kickoff: the fair
 * probability of the same side at the same line (Pinnacle de-vigged when it has the line) minus the
 * probability implied by the flagged price. Same code as the live board; nothing tuned here.
 * Writes the summary into src/data/line-shop-proof.json under "gameLines".
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { shop, gameMarkets, LINE_SHOP_VERSION } from '../src/lib/line-shop.ts';
import { impliedProb } from '../src/lib/fair-value.ts';

const BASE = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com/line-shop-backfill/nfl-2025';
const state = await (await fetch(`${BASE}/state.json`, { cache: 'no-store' })).json();
const get = async file => JSON.parse(zlib.gunzipSync(Buffer.from(await (await fetch(`${BASE}/${file}.json.gz`)).arrayBuffer())).toString());

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const se = a => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / Math.max(1, a.length - 1) / Math.max(1, a.length));
const graded = [];
let games = 0, markets = 0, flags = 0, noClose = 0, arbs = 0;

for (const [w, wk] of Object.entries(state.weeks)) {
  if (!wk.early) continue;
  const W = String(w).padStart(2, '0');
  const early = await get(`w${W}-early`);
  const closes = new Map();
  for (const k of wk.done) closes.set(k, (await get(`w${W}-close-${k.replace(/[:]/g, '')}`)).data);
  for (const e of early.data) {
    const k = new Date(Date.parse(e.commence_time)).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const closeData = closes.get(k);
    if (!closeData) continue;                     // game outside this week's graded window
    games++;
    const ce = closeData.find(x => x.id === e.id);
    const closeById = new Map(ce ? gameMarkets(ce).map(tw => [tw.id, shop(tw)]) : []);
    for (const tw of gameMarkets(e)) {
      markets++;
      const r = shop(tw);
      if (r.arb != null) arbs++;
      for (const f of r.flags) {
        flags++;
        const c = closeById.get(tw.id);
        if (!c || c.fairA == null) { noClose++; continue; }
        const closeFair = f.label === tw.labelA ? c.fairA : 1 - c.fairA;
        graded.push({ week: +w, market: tw.market, book: f.book, ev: f.ev, src: r.fairSource, closeSrc: c.fairSource, clv: closeFair - impliedProb(f.price) });
      }
    }
  }
}

const sum = rows => ({ n: rows.length, clv: +mean(rows.map(g => g.clv)).toFixed(4), se: +se(rows.map(g => g.clv)).toFixed(4), pctPositive: +(rows.filter(g => g.clv > 0).length / Math.max(1, rows.length)).toFixed(3) });
const pctS = x => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
console.log(`rule ${LINE_SHOP_VERSION} · 2025 NFL weeks ${Object.keys(state.weeks).length} · credits ${state.credits}`);
console.log(`games graded ${games} · markets priced ${markets} · early arbitrage windows ${arbs} · flags ${flags} · graded ${graded.length} · line gone at close ${noClose}`);
const all = sum(graded);
console.log(`\nALL flags: n ${all.n} CLV ${pctS(all.clv)} ± ${(all.se * 100).toFixed(2)}% · positive ${(all.pctPositive * 100).toFixed(1)}% · claimed EV ${pctS(mean(graded.map(g => g.ev)))}`);
const tiers = [[0.015, 0.03], [0.03, 9]].map(([lo, hi]) => ({ lo, hi, ...sum(graded.filter(g => g.ev >= lo && g.ev < hi)) }));
for (const t of tiers) console.log(`  EV ${t.lo}-${t.hi}: n ${t.n} CLV ${pctS(t.clv)} ± ${(t.se * 100).toFixed(2)}% (${(t.pctPositive * 100).toFixed(0)}% +)`);
const by = key => Object.fromEntries([...new Set(graded.map(g => g[key]))].map(k => [k, sum(graded.filter(g => g[key] === k))]));
for (const key of ['market', 'src', 'book']) console.log(`  by ${key}:`, Object.entries(by(key)).map(([k, v]) => `${k} n${v.n} ${pctS(v.clv)}±${(v.se * 100).toFixed(2)}`).join(' · '));

const file = 'src/data/line-shop-proof.json';
const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
proof.gameLines = { generated: new Date().toISOString(), season: '2025 NFL', weeks: Object.keys(state.weeks).length, games, flags, ...all,
  claimedEv: +mean(graded.map(g => g.ev)).toFixed(4), tiers, byMarket: by('market'), bySource: by('src') };
fs.writeFileSync(file, JSON.stringify(proof) + '\n');
console.log(`\nwrote ${file} (gameLines)`);
