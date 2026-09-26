#!/usr/bin/env node
// Local proof of the live EV rule: real upcoming games from the live blobs, real current prices
// from ESPN, the real evaluateGame() the /ev page uses. No mocks. Prints every market and flags.
//   npm run ev-board            (Node 22.18+; imports src/lib/*.ts directly)
import { evaluateGame } from '../src/lib/ev-model.ts';
import { parseEspnPrices, espnOddsUrl } from '../src/lib/espn-prices.ts';

const BASE = process.env.PM_BASE || 'https://www.predictionmatrix.com';
const BLOBS = { nfl: 'prediction-matrix-data.json', wnba: 'wnba-prediction-data.json' };
const pct = x => `${(x * 100).toFixed(1)}%`;
const am = x => (x > 0 ? `+${x}` : `${x}`);
let games = 0, priced = 0, flags = 0;
for (const [sport, file] of Object.entries(BLOBS)) {
  const blob = await (await fetch(`${BASE}/${file}`, { cache: 'no-store' })).json();
  const upcoming = (blob.games || []).filter(g => g.game.status !== 'final' && new Date(g.game.gameTime) > new Date());
  console.log(`\n== ${sport.toUpperCase()} ${upcoming.length} upcoming`);
  for (const { game, prediction } of upcoming) {
    games++;
    const res = await fetch(espnOddsUrl(sport, game.id));
    const px = res.ok ? parseEspnPrices((await res.json()).items?.[0]) : null;
    const h = game.homeTeam.abbreviation, a = game.awayTeam.abbreviation;
    if (!px) { console.log(`${a}@${h}  no prices`); continue; }
    priced++;
    const ev = evaluateGame(sport, h, a, prediction, px.current);
    console.log(`${a}@${h} ${game.gameTime.slice(0, 16)} (${px.provider})`);
    for (const m of ev.markets) {
      const s = m.sides.map(x => `${x.label} ${am(x.price)} fair ${pct(x.fairProb)} model ${pct(x.modelProb)} p ${pct(x.prob)} EV ${pct(x.ev)}`).join(' | ');
      console.log(`   ${m.market.padEnd(6)} w${m.weight} vig ${pct(m.vig)}  ${s}${m.best ? `  ==> BET ${m.best.label} ${am(m.best.price)} EV ${pct(m.best.ev)} stake ${pct(m.best.kelly)}` : ''}`);
      if (m.best) flags++;
    }
  }
}
console.log(`\ngames ${games} · priced ${priced} · +EV flags ${flags}`);
if (games && !priced) { console.error('FAIL: no prices for any upcoming game'); process.exit(1); }
