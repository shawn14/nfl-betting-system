#!/usr/bin/env node
/**
 * Local proof of the line-shop rule (src/lib/line-shop.ts) on REAL multi-book data already stored:
 * the props recorder's raw The Odds API snapshots (odds-props/snap/..., 7-8 US books, several
 * captures per game as kickoff approaches). No API key, no credits.
 *
 *   npm run line-shop-proof
 *
 * For every snapshot: build exact-line two-way markets, price them with shop(), keep the flags.
 * Then grade each flag the way sharp bettors grade themselves — closing line value: the consensus
 * fair probability of the same side at the same line in the LAST snapshot before kickoff, minus the
 * probability implied by the price taken. Positive average CLV = the flags were beating the market.
 * (US-only books here, so fair = leave-one-out consensus; the live board adds Pinnacle.)
 */
import zlib from 'node:zlib';
import fs from 'node:fs';
import { shop, propMarkets, MIN_SHOP_EV, LINE_SHOP_VERSION } from '../src/lib/line-shop.ts';
import { impliedProb, devigTwoWay } from '../src/lib/fair-value.ts';

const BLOB = 'https://0luulmjdaimldet9.public.blob.vercel-storage.com';
const idx = await (await fetch(`${BLOB}/odds-props/index.json`, { cache: 'no-store' })).json();
const paths = idx.snapshots.map(s => s.path);
console.log(`${paths.length} stored snapshots`);

const snaps = [];
const q = [...paths];
await Promise.all(Array.from({ length: 12 }, async () => {
  while (q.length) {
    const p = q.shift();
    try {
      const buf = Buffer.from(await (await fetch(`${BLOB}/${p}`)).arrayBuffer());
      const d = JSON.parse(zlib.gunzipSync(buf).toString());
      snaps.push({ ts: d.ts, hoursToKick: d.hoursToKick, data: d.data });
    } catch (e) { console.warn(`skip ${p}: ${e.message}`); }
  }
}));

// Group by event; the closing snapshot is the last one taken before kickoff.
const byEvent = new Map();
for (const s of snaps) {
  if (!s.data?.id) continue;
  if (!byEvent.has(s.data.id)) byEvent.set(s.data.id, []);
  byEvent.get(s.data.id).push(s);
}

const mean = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
let markets = 0, withFair = 0, flags = 0, arbs = 0;
const graded = [], noClose = { lineGone: 0, sameSnap: 0 };
const byBook = {};

for (const [, list] of byEvent) {
  list.sort((a, b) => a.ts.localeCompare(b.ts));
  const pre = list.filter(s => s.hoursToKick > 0);
  if (!pre.length) continue;
  const close = pre[pre.length - 1];
  const closeMarkets = new Map(propMarkets(close.data).map(tw => [tw.id, tw]));
  for (const s of pre) {
    for (const tw of propMarkets(s.data)) {
      markets++;
      const r = shop(tw);
      if (r.fairA != null) withFair++;
      if (r.arb != null) arbs++;
      for (const f of r.flags) {
        flags++;
        if (s === close) { noClose.sameSnap++; continue; }       // no later price to grade against
        const c = closeMarkets.get(tw.id);
        const cr = c && shop(c);
        if (!cr || cr.fairA == null) { noClose.lineGone++; continue; }
        const sideA = f.label === tw.labelA;
        const closeFair = sideA ? cr.fairA : 1 - cr.fairA;
        const clv = closeFair - impliedProb(f.price);
        const hoursBefore = s.hoursToKick - close.hoursToKick;
        graded.push({ clv, ev: f.ev, book: f.book, hoursBefore, drift: closeFair - f.fairProb });
        (byBook[f.book] ??= []).push(clv);
      }
    }
  }
}

console.log(`\nrule ${LINE_SHOP_VERSION} · min EV ${MIN_SHOP_EV}`);
console.log(`events ${byEvent.size} · two-way markets priced ${markets} · with a fair price ${withFair} · arbitrage windows ${arbs}`);
console.log(`flags ${flags} · graded vs close ${graded.length} · no later snapshot ${noClose.sameSnap} · line gone at close ${noClose.lineGone}`);
if (graded.length) {
  const clv = graded.map(g => g.clv);
  console.log(`\nCLV of flagged prices: mean ${(mean(clv) * 100).toFixed(2)}% ± ${(sd(clv) / Math.sqrt(clv.length) * 100).toFixed(2)}% (SE) · positive ${(clv.filter(x => x > 0).length / clv.length * 100).toFixed(1)}%`);
  console.log(`claimed EV at flag time: mean ${(mean(graded.map(g => g.ev)) * 100).toFixed(2)}% · fair drift flag->close ${(mean(graded.map(g => g.drift)) * 100).toFixed(2)} pts`);
  for (const [lo, hi] of [[0.015, 0.03], [0.03, 0.05], [0.05, 0.1], [0.1, 9]]) {
    const b = graded.filter(g => g.ev >= lo && g.ev < hi).map(g => g.clv);
    if (b.length) console.log(`  EV ${lo}-${hi}: n ${b.length} CLV ${(mean(b) * 100).toFixed(2)}% ± ${(sd(b) / Math.sqrt(b.length) * 100).toFixed(2)}%`);
  }
  console.log('  by book:', Object.entries(byBook).map(([k, v]) => `${k} n${v.length} ${(mean(v) * 100).toFixed(2)}%`).join(' · '));
}

// Bundled into /ev: what a flag has actually been worth at the close, by EV tier.
const tier = (lo, hi) => { const b = graded.filter(g => g.ev >= lo && g.ev < hi).map(g => g.clv); return { lo, hi, n: b.length, clv: +mean(b).toFixed(4), se: +(sd(b) / Math.sqrt(Math.max(1, b.length))).toFixed(4) }; };
const proof = {
  generated: new Date().toISOString(), version: LINE_SHOP_VERSION, source: 'odds-props snapshots (US books, NFL player props)',
  events: byEvent.size, markets, flags, graded: graded.length, arbs,
  clv: +mean(graded.map(g => g.clv)).toFixed(4), clvSe: +(sd(graded.map(g => g.clv)) / Math.sqrt(graded.length)).toFixed(4),
  pctPositive: +(graded.filter(g => g.clv > 0).length / graded.length).toFixed(3), claimedEv: +mean(graded.map(g => g.ev)).toFixed(4),
  tiers: [tier(0.015, 0.03), tier(0.03, 9)],
};
fs.writeFileSync('src/data/line-shop-proof.json', JSON.stringify(proof) + '\n');
console.log('wrote src/data/line-shop-proof.json', JSON.stringify(proof.tiers));
