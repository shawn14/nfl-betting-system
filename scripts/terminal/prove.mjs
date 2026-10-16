#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {normalizeTerminal,isFresh,marketGap,bestShoppingEv} from '../../src/lib/terminal/core.ts';
import {loadTerminalSources} from '../../src/lib/terminal/data.ts';
const proof=new URL('../../docs/terminal/proof/',import.meta.url);
const live=process.argv.includes('--live');
let sources,board;
if(live)({sources,board}=await loadTerminalSources());
else{
 const read=async sport=>{const p=JSON.parse(await fs.readFile(new URL(`${sport}.json`,proof)));return {...p,sport,hash:createHash('sha256').update(JSON.stringify(p.data)).digest('hex')};};
 sources=await Promise.all(['nfl','nba','nhl','cbb','wnba'].map(read));board=await read('board');
}
assert(sources.every(s=>s.data),JSON.stringify(sources.map(s=>({sport:s.sport,error:s.error}))));assert(board.data,board.error);
const now=live?Date.now():Math.max(...sources.map(s=>Date.parse(s.fetchedAt)),Date.parse(board.fetchedAt));
const data=normalizeTerminal(sources,board,now);assert(data.games.length>0);
let prices=0,matched=0,conflicts=0;
const name=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
for(const g of data.games){
 const raw=sources.find(s=>s.sport===g.sport).data.games.find(e=>String(e.game.id)===g.gameId);
 assert.equal(g.forecast.homeProbability,raw.prediction.homeWinProbability);assert.equal(g.forecast.total,raw.prediction.predictedTotal);
 assert.equal(g.forecast.homeScore,raw.prediction.predictedHomeScore);assert.equal(g.forecast.awayScore,raw.prediction.predictedAwayScore);
 assert(Date.parse(g.commence)>now);assert.equal(raw.game.status,'scheduled');
 assert.equal(g.totals.length,0,'Legacy liveOdds prices lack provider event identity and must be withheld');
 for(const market of g.markets) for(const q of [market.bestA,market.bestB].filter(Boolean)){const source=board.data.sports[g.sport].events.find(e=>e.id===g.marketEventId).markets.find(m=>m.id===market.id);assert([source.bestA,source.bestB].some(b=>b&&b.book===q.book&&b.label===q.label&&b.price===q.price));prices++;}
 if(g.marketEventId){matched++;const rows=board.data.sports[g.sport].events.filter(e=>name(e.home)===name(g.home)&&name(e.away)===name(g.away)&&Date.parse(e.commence)===Date.parse(g.commence));assert.equal(rows.length,1);assert.equal(rows[0].id,g.marketEventId);}
 if(g.signalDisagreement){conflicts++;assert.notEqual(Math.sign(g.forecast.homeScore-g.forecast.awayScore),Math.sign(g.forecast.homeProbability-.5));}
 const later=Date.parse(g.commence)+1;assert.equal(isFresh(g.publishedAt,g.commence,later,true),false);assert.equal(marketGap(g,later),null);assert.equal(bestShoppingEv(g,later),null);
}
assert.equal(new Set(data.games.map(g=>g.id)).size,data.games.length);assert(Buffer.byteLength(JSON.stringify(data))<600*1024,'Bounded browser projection');
const g=data.games.find(x=>x.marketEventId);assert(g,'Need real exact-match event for join regressions');
const original=sources.find(s=>s.sport===g.sport),raw=original.data.games.find(e=>String(e.game.id)===g.gameId);
const changed=structuredClone(sources);changed.find(s=>s.sport===g.sport).data.games.push(structuredClone(raw));
assert(!normalizeTerminal(changed,board,now).games.some(x=>x.id===g.id),'Ambiguous duplicate forecast must be excluded');
const moved=structuredClone(board);moved.data.sports[g.sport].events.find(e=>e.id===g.marketEventId).commence=new Date(Date.parse(g.commence)+600000).toISOString();
assert.equal(normalizeTerminal(sources,moved,now).games.find(x=>x.id===g.id).marketEventId,null,'Different start clock must not silently join');
const nulls=structuredClone(sources),nullBoard=structuredClone(board);
nulls.find(s=>s.sport===g.sport).data.games.push(null);nullBoard.data.sports[g.sport].events.push(null);nullBoard.data.sports[g.sport].events.find(e=>e?.id===g.marketEventId).markets.push(null);
assert.equal(normalizeTerminal(nulls,nullBoard,now).games.length,data.games.length,'Malformed records must not take all sports offline');
const future=structuredClone(sources);future.find(s=>s.sport===g.sport).data.generated=new Date(now+60000).toISOString();
assert(!normalizeTerminal(future,board,now).games.some(x=>x.sport===g.sport),'Future publication clock must fail');
const invalidPrice=structuredClone(board);const bad=invalidPrice.data.sports[g.sport].events.find(e=>e.id===g.marketEventId).markets[0];bad.bestA.price=65;
assert.equal(normalizeTerminal(sources,invalidPrice,now).games.find(x=>x.id===g.id).markets[0].bestA,null,'Invalid American prices excluded');
assert(!isFresh(new Date(now+1).toISOString(),g.commence,now));assert(!isFresh('bad',g.commence,now));
const empty=normalizeTerminal(sources.map(s=>s.sport===g.sport?{...s,data:null,error:'Provider unavailable'}:s),board,now);
assert(empty.sources.find(s=>s.sport===g.sport).error);assert(!empty.games.some(x=>x.sport===g.sport));
const result={checkedAt:new Date().toISOString(),mode:live?'real live sources':'captured real source replay',games:data.games.length,exactBookQuotes:prices,exactJoinedGames:matched,signalDisagreements:conflicts,projectionBytes:Buffer.byteLength(JSON.stringify(data)),excluded:data.counts,sourceChecks:sources.map(s=>({sport:s.sport,generated:s.data.generated,hash:s.hash})),passed:['all displayed forecasts and exact-event board quote sides match raw source','unidentified legacy per-book totals excluded','exact identity and start time joins','duplicate/future/invalid-price guards','expired prices cannot rank as current value','bounded browser payload','unavailable sources stay unavailable']};
console.log(JSON.stringify(result,null,2));
if(live)await fs.writeFile(new URL('live-check.json',proof),JSON.stringify(result,null,2)+'\n');
