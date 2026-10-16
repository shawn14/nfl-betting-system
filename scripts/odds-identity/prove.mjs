#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const read=async path=>JSON.parse(await fs.readFile(new URL(path,import.meta.url),'utf8'));
const providers=await Promise.all(['nfl','nhl','wnba'].map(async sport=>({sport,...await read(`../../docs/odds-identity/proof/${sport}.json`)})));
const forecasts=await Promise.all(['nfl','nba','nhl','cbb','wnba'].map(async sport=>({sport,...await read(`../../docs/terminal/proof/${sport}.json`)})));
const identity=(e,g)=>e.home_team===g.homeTeam.name&&e.away_team===g.awayTeam.name&&Date.parse(e.commence_time)===Date.parse(g.gameTime);
if(process.argv.includes('--legacy')){
 let mismatched=0,quoted=0;const examples=[];
 for(const {sport,snapshot}of providers)for(const entry of forecasts.find(s=>s.sport===sport).data.games){
  if(!entry.prediction?.liveOdds?.bookmakers?.length)continue;quoted++;
  if(!snapshot.data.some(e=>identity(e,entry.game))){mismatched++;if(examples.length<4)examples.push({sport,gameId:entry.game.id,home:entry.game.homeTeam.name,away:entry.game.awayTeam.name,time:entry.game.gameTime});}
 }
 console.log(JSON.stringify({source:'real published forecast and archived provider events',quotedGames:quoted,withoutExactProviderMatch:mismatched,examples},null,2));
 assert.equal(mismatched,0,'Legacy publications attach prices to games without exact provider identity');
 process.exit(0);
}
const {parseEventOdds,matchGameOdds,verifiedLiveOdds,ODDS_SPORT_KEYS}=await import('../../src/lib/event-odds.ts');
let events=0,quotes=0,matched=0,unmatched=0,legacyRejected=0;const details=[];
const expected=(sport,g)=>({sport,home:g.homeTeam.name,away:g.awayTeam.name,commence:g.gameTime});
for(const {sport,snapshot}of providers){
 const now=Date.parse(snapshot.ts),parsed=parseEventOdds(snapshot.data,sport,snapshot.ts);events+=parsed.size;
 for(const [id,event]of parsed){
  const raw=snapshot.data.find(e=>e.id===id);assert(raw);assert.equal(event.homeTeam,raw.home_team);assert.equal(event.awayTeam,raw.away_team);assert.equal(event.commenceTime,raw.commence_time);assert.equal(event.observedAt,snapshot.ts);
  for(const q of event.bookmakers){quotes++;const b=raw.bookmakers.find(b=>b.key===q.key),m=b.markets.find(m=>m.key==='totals');
   assert.equal(q.updatedAt,m.last_update??b.last_update);assert.equal(q.total,m.outcomes.find(o=>o.name==='Over').point);assert.equal(q.total,m.outcomes.find(o=>o.name==='Under').point);assert.equal(q.overOdds,m.outcomes.find(o=>o.name==='Over').price);assert.equal(q.underOdds,m.outcomes.find(o=>o.name==='Under').price);
  }
  assert(!('consensusOverOdds'in event));assert(!('consensusUnderOdds'in event));if(event.consensusTotal!==undefined)assert(event.bookmakers.some(q=>q.total===event.consensusTotal));
 }
 for(const entry of forecasts.find(f=>f.sport===sport).data.games){
  const id=expected(sport,entry.game),result=matchGameOdds(parsed,id,now);
  if(entry.prediction?.liveOdds){assert.equal(verifiedLiveOdds(entry.prediction.liveOdds,id,now),undefined);legacyRejected++;}
  const providerMatches=snapshot.data.filter(e=>identity(e,entry.game));
  if(providerMatches.length===1){const e=providerMatches[0];const direct=matchGameOdds(parsed,{sport,home:e.home_team,away:e.away_team,commence:e.commence_time},now);assert.equal(result?.eventId,direct?.eventId,'Equivalent real source timestamps must not create silent false negatives');}
  if(result){matched++;const exact=snapshot.data.filter(e=>identity(e,entry.game));assert.equal(exact.length,1);assert.equal(result.eventId,exact[0].id);assert.equal(verifiedLiveOdds(result,{...id,home:'Other team'},now),undefined);assert.equal(verifiedLiveOdds(result,{...id,commence:new Date(Date.parse(id.commence)+600000).toISOString()},now),undefined);assert.equal(verifiedLiveOdds(result,id,now+151*60000),undefined);}
  else unmatched++;
  details.push({sport,gameId:entry.game.id,matchedEventId:result?.eventId??null,quotes:result?.bookmakers.length??0});
 }
 const raw=snapshot.data.find(e=>e.bookmakers.some(b=>b.markets.some(m=>m.key==='totals')));assert(raw);
 const id={sport,home:raw.home_team,away:raw.away_team,commence:raw.commence_time};assert(matchGameOdds(parsed,id,now),'Actual provider event positive control');
 assert.equal(matchGameOdds(parsed,{...id,commence:new Date(id.commence)},now)?.eventId,raw.id,'NFL native Date kickoff preserves exact match');
 assert.equal(matchGameOdds(parsed,{...id,commence:new Date(NaN)},now),undefined,'Invalid native Date rejected');
 assert.equal(matchGameOdds(parsed,{...id,commence:undefined},now),undefined,'Missing kickoff rejected');
 const duplicate=structuredClone(snapshot.data);duplicate.push(structuredClone(raw));assert(!parseEventOdds(duplicate,sport,snapshot.ts).has(raw.id),'Duplicate provider ID rejected');
 const collision=structuredClone(snapshot.data);collision.push({...structuredClone(raw),id:raw.id+'-second'});assert.equal(matchGameOdds(parseEventOdds(collision,sport,snapshot.ts),id,now),undefined,'Ambiguous identity rejected');
 const partlyInvalid=structuredClone(collision);partlyInvalid.at(-1).bookmakers=[];assert.equal(matchGameOdds(parseEventOdds(partlyInvalid,sport,snapshot.ts),id,now),undefined,'Invalid prices cannot hide an ambiguous event identity');
 const missing=structuredClone(raw);for(const b of missing.bookmakers)for(const m of b.markets)if(m.key==='totals')delete m.outcomes.find(o=>o.name==='Over').price;assert.equal(parseEventOdds([missing],sport,snapshot.ts).size,0,'Missing price is never -110');
 const badLine=structuredClone(raw);for(const b of badLine.bookmakers)for(const m of b.markets)if(m.key==='totals')m.outcomes.find(o=>o.name==='Under').point+=.5;assert.equal(parseEventOdds([badLine],sport,snapshot.ts).size,0,'Different total lines cannot pair');
 const future=structuredClone(raw);for(const b of future.bookmakers)for(const m of b.markets)m.last_update=new Date(now+1).toISOString();assert.equal(parseEventOdds([future],sport,snapshot.ts).size,0,'Future source clock rejected');
 assert.equal(parseEventOdds([null,...snapshot.data],sport,snapshot.ts).size,parsed.size,'Malformed record isolation');
}
// Real formerly wrong-game counterexamples must be absent after replay through the production matcher.
for(const id of ['401892536','401892540','401918306'])assert.equal(details.find(g=>String(g.gameId)===id)?.matchedEventId,null,`Wrong-event regression ${id}`);
const routeSports={'blob-sync-simple':'nfl','nba-sync':'nba','nhl-sync':'nhl','cbb-sync':'cbb','wnba-sync':'wnba'};
for(const [route,sport]of Object.entries(routeSports)){
 const source=await fs.readFile(new URL(`../../src/app/api/cron/${route}/route.ts`,import.meta.url),'utf8');assert(source.includes('matchGameOdds(oddsApiData'));assert(source.includes(`sport: '${sport}', home: homeTeam.name, away: awayTeam.name, commence: game.gameTime`));assert(!source.includes('gameKey.includes('));assert(!source.includes('overOdds: o.overOdds || -110'));
 const reader=await fs.readFile(new URL(`../../src/app/${sport}/live/page.tsx`,import.meta.url),'utf8');assert(reader.includes('verifiedLiveOdds('),`Reader guard ${sport}`);assert(reader.includes("import { verifiedLiveOdds }"),`Reader import ${sport}`);assert(reader.includes('Quotes as of '),`Visible provider time ${sport}`);assert(!reader.includes('real-time betting lines'),`No live-price claim ${sport}`);
}
const result={checkedAt:new Date().toISOString(),source:'real archived provider responses and real published game records',providerSports:providers.map(p=>p.sport),unavailableProviderSports:['nba','cbb'],providerEvents:events,providerQuotes:quotes,forecastGamesChecked:matched+unmatched,matchedGames:matched,withheldGames:unmatched,legacyQuoteObjectsRejected:legacyRejected,writerPaths:Object.keys(routeSports),readerPaths:Object.keys(routeSports),details,passed:['every retained quote matches exact raw provider event/line/book/price/time','all five production writers use one strict matcher','all five live readers reject legacy unidentified prices','wrong-team/other-date/time-discrepancy/duplicate/stale/future/missing-price guards','no synthetic American odds or pooled lines','all three observed wrong-game regressions withheld']};
await fs.writeFile(new URL('../../docs/odds-identity/proof/check.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,details:undefined},null,2));
