#!/usr/bin/env node
// Exercises the real, explicitly selected Next process and its public source data.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {verifiedHttpBase} from '../measurement/http-target.mjs';
const base=await verifiedHttpBase();
const get=path=>fetch(base+path,{signal:AbortSignal.timeout(60000)});
const response=await get('/api/terminal');assert.equal(response.status,200);const data=await response.json();
assert(data.games.length>0,'Current real games required');
// Regression first observed red on real API: 503 unidentified liveOdds quotes leaked across games.
assert.equal(data.games.reduce((n,g)=>n+(g.totals?.length??0),0),0,'Unidentified per-book liveOdds quotes must never reach the terminal');
const blobs=new Map();
for(const url of new Set(data.games.flatMap(g=>[g.sourceUrl,g.marketSourceUrl]))){
 const r=await fetch(url,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,url);
 const text=await r.text();blobs.set(url,{hash:createHash('sha256').update(text).digest('hex'),data:JSON.parse(text)});
}
let exports=0,quoteSides=0;
for(const game of data.games){
 const forecast=blobs.get(game.sourceUrl),board=blobs.get(game.marketSourceUrl);
 assert.equal(game.sourceHash,forecast.hash,'Source advanced during proof; do not silently compare versions');assert.equal(game.marketSourceHash,board.hash);
 const raw=forecast.data.games.find(e=>String(e.game.id)===game.gameId);assert(raw);
 assert.equal(game.forecast.homeProbability,raw.prediction.homeWinProbability);
 const params=new URLSearchParams({id:game.id,forecastHash:game.sourceHash,marketHash:game.marketSourceHash});
 const r=await get('/api/terminal/evidence?'+params);assert.equal(r.status,200,game.id);assert.match(r.headers.get('content-disposition'),/attachment/);assert.equal(r.headers.get('cache-control'),'no-store');
 const evidence=await r.json();assert.equal(evidence.game.id,game.id);assert.deepEqual(evidence.exactPublishedEntry,raw);assert.equal(evidence.forecastSource.sha256,forecast.hash);assert.equal(evidence.marketSource.sha256,board.hash);
 if(game.marketEventId){const rawBoard=board.data.sports[game.sport].events.find(e=>e.id===game.marketEventId);assert.deepEqual(evidence.exactBoardEvent,rawBoard);assert.equal(Date.parse(rawBoard.commence),Date.parse(game.commence));assert.equal(rawBoard.home,game.home);assert.equal(rawBoard.away,game.away);for(const m of game.markets){const rawMarket=rawBoard.markets.find(x=>x.id===m.id);assert(rawMarket);for(const side of ['bestA','bestB'])if(m[side]){assert.equal(m[side].price,rawMarket[side].price);assert.equal(m[side].book,rawMarket[side].book);quoteSides++;}}}
 else assert.equal(evidence.exactBoardEvent,null);
 exports++;
}
const sample=data.games[0],valid={id:sample.id,forecastHash:sample.sourceHash,marketHash:sample.marketSourceHash};
for(const [replace,status] of [[{id:'nfl:../secret'},400],[{forecastHash:''},400],[{forecastHash:'0'.repeat(64)},409],[{marketHash:'0'.repeat(64)},409]]){const r=await get('/api/terminal/evidence?'+new URLSearchParams({...valid,...replace}));assert.equal(r.status,status);}
const html=await(await get('/terminal')).text();assert(html.includes('Research terminal'));assert(html.includes('Experimental forecasts'));assert(html.includes('edge unproven'));assert(html.includes('Pregame collection is not enabled')===false,'Record tab is client-selected, not proof of enabled collection');
for(const g of data.games)assert(html.includes(`data-game-id="${g.id}"`),`Rendered game ${g.id}`);
const measurement=await(await get('/api/measurement')).json();assert.equal(measurement.state,'disabled');
const result={checkedAt:new Date().toISOString(),base,games:data.games.length,exactBoardQuoteSides:quoteSides,exports,unidentifiedTotalQuotes:0,passed:['every real API row renders','every research export retains exact raw forecast and board entry','source hashes match real public blobs','source version mismatch rejects export','invalid identities rejected','legacy unidentified prices excluded','measurement remains disabled']};
await fs.writeFile(new URL('../../docs/terminal/proof/http-check.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
