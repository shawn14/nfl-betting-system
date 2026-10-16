#!/usr/bin/env node
// Drives the production measurement module and real captured payloads. No predictor/price mocks.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const audit = new URL('docs/reports/2026-10-15-edge-audit/', root);
const nfl = JSON.parse(await fs.readFile(new URL('nfl.json', audit)));
const frozen = nfl.backtest.results.filter(r => r.modelVersion === '2026-09-11-freeze');
assert.equal(frozen.length, 77);
assert.equal(frozen.filter(r => r.capturedAt && Date.parse(r.capturedAt) < Date.parse(r.gameTime)).length, 0);
console.log('RED reproduced: all 77 frozen NFL results lack a pregame capture; legacy rows must be excluded.');
const m = await import('../../src/lib/measurement/core.ts');
assert.equal(m.MEASUREMENT_VERSION, '2026-10-16-v1');
console.log('Measurement contract loaded.');
const {newShopCaptures,makeClose,shopReport}=await import('../../src/lib/measurement/shop.ts');
const proof=new URL('docs/measurement/proof/',root);
const read=async file=>JSON.parse(await fs.readFile(new URL(file,proof)));
const wnba=JSON.parse(await fs.readFile(new URL('wnba.json',audit)));
const rawOdds=(await read('wnba-prices.json')).items[0], event=m.eventState(await read('wnba-event.json'));
const at=Date.parse('2026-10-16T02:00:00Z');
const input={sport:'wnba',entry:wnba.games.find(x=>String(x.game.id)===event.id),publishedAt:wnba.generated,
 sourceUrl:'captured-public-blob',sourceHash:m.digest(wnba),rawPrices:rawOdds,event,observedAt:new Date(at).toISOString(),now:at};
const c=m.makeCapture(input);assert(c);assert.equal(c.markets.length,3);assert.deepEqual(c.entry,input.entry);
const saved={...c,committedAt:new Date(at+1).toISOString()};assert(m.validCapture(saved));
assert.equal(m.makeCapture({...input,now:Date.parse(c.commence)}),null);
assert.equal(m.makeCapture({...input,event:{...event,state:'in'}}),null);
assert.equal(m.makeCapture({...input,publishedAt:new Date(at+1).toISOString()}),null);
assert.equal(m.makeCapture({...input,publishedAt:new Date(at-4*36e5).toISOString()}),null);
assert.equal(m.makeCapture({...input,event:{...event,homeId:'wrong'}}),null);
assert.equal(m.makeCapture({...input,rawPrices:{}}),null);
const noTotals=structuredClone(rawOdds);delete noTotals.current;
const partial=m.makeCapture({...input,rawPrices:noTotals});assert(partial);assert.deepEqual(partial.missingMarkets,['total']);
assert.equal(m.validCapture({...saved,committedAt:saved.commence}),false);
assert.equal(m.settle(saved,event,'captured-event',Date.parse(saved.commence)+1),null);
// Score-replay stress cases exercise the exact candidate grader. Synthetic mutations are test-only,
// never prospective evidence. Real published forecast/price fields above remain unmodified.
const final={...event,state:'post',status:'STATUS_FINAL',completed:true,homeScore:90,awayScore:80};
const grades=m.settle(saved,final,'score-replay-only',Date.parse(saved.commence)+5*36e5);
assert(grades);assert.equal(grades.grades.find(g=>g.market==='ml').result,'win');
assert.equal(grades.grades.find(g=>g.market==='total').result,'win');
assert.equal(grades.grades.find(g=>g.market==='spread').result,'loss');
assert(Math.abs(grades.grades.find(g=>g.market==='ml').units-100/142)<1e-10);
const originalHash=grades.captureHash;
input.entry.prediction.predictedTotal=1; // upstream object cannot mutate the saved immutable JSON copy
assert.equal(m.settle(saved,final,'score-replay-only',Date.parse(saved.commence)+5*36e5).captureHash,originalHash);
const tied=m.settle(saved,{...final,homeScore:80,awayScore:80},'tie-replay',Date.parse(saved.commence)+5*36e5);
assert.equal(tied.grades.find(g=>g.market==='ml').result,'push');
assert.equal(tied.grades.find(g=>g.market==='ml').modelLogLoss,undefined);
assert.equal(m.settle(saved,{...final,completed:false,state:'in'},'in-progress',Date.parse(saved.commence)+1),null);
assert.equal(m.settle(saved,{...final,commence:new Date(Date.parse(saved.commence)+864e5).toISOString()},'reschedule',Date.parse(saved.commence)+1).status,'void');
const a=await read('shop-entry.json'),b=await read('shop-2237.json');let captures=[],closes=[];
for(const e of a.data){
 for(const raw of newShopCaptures(e,'nhl',a.ts,false,Date.parse(a.ts))){
  const c={...raw,committedAt:new Date(Date.parse(a.ts)+1).toISOString()};captures.push(c);
  assert.equal(makeClose(c,e,a.ts,false,Date.parse(a.ts)),null,'Same observation cannot close itself');
  const next=b.data.find(x=>x.id===e.id);if(!next)continue;
  const close=makeClose(c,next,b.ts,false,Date.parse(b.ts));
  if(close){closes.push({...close,committedAt:new Date(Date.parse(b.ts)+1).toISOString()});
   assert.equal(makeClose(c,{...next,commence_time:new Date(Date.parse(next.commence_time)+60000).toISOString()},b.ts,false,Date.parse(b.ts)),null);
   const stale=structuredClone(next);for(const bk of stale.bookmakers)for(const mk of bk.markets)mk.last_update=a.ts;
   assert.equal(makeClose(c,stale,b.ts,false,Date.parse(b.ts)),null,'Stale quote cannot become a close');
   assert.equal(makeClose(c,next,b.ts,false,Date.parse(c.commence)+1),null,'No post-kickoff closing writes');
  }
 }
}
assert.equal(captures.length,2);assert.equal(closes.length,2);
const shopResult=shopReport(captures,closes,Date.parse(b.ts)+2*36e5);
assert.equal(shopResult.n,2);assert.equal(shopResult.games,2);assert(shopResult.mean<0,'Real replay must preserve losing CLV too');
assert.equal(shopReport(captures,closes.map(x=>({...x,observedAt:a.ts})),Date.parse(b.ts)+2*36e5).n,0);
assert.equal(m.clustered(Array.from({length:100},()=>({game:'one-game',value:.01}))).se,null);
console.log(JSON.stringify({ok:true,realForecastMarkets:c.markets.length,realShopReplay:{flags:captures.length,closes:closes.length,games:shopResult.games,clv:shopResult.mean},timingAndIdentityGuards:true,priceAndGradingBoundaryChecks:true,note:'Clock/score replays are diagnostics only, not prospective performance.'},null,2));

// Independent-refuter regression: two unique books repeated twice must not satisfy a four-book consensus.
for (const c of captures) {
 const next=structuredClone(b.data.find(e=>e.id===c.eventId));
 if(!next)continue;
 next.bookmakers=next.bookmakers.filter(b=>b.key!==c.book && b.key!=='pinnacle').slice(0,2);
 const onlyTwo=makeClose(c,next,b.ts,false,Date.parse(b.ts));assert.equal(onlyTwo,null);
 next.bookmakers=[...next.bookmakers,...structuredClone(next.bookmakers)];
 assert.equal(makeClose(c,next,b.ts,false,Date.parse(b.ts)),null,'Duplicate books cannot certify consensus');
}
console.log('PASS independent refuter regression: duplicate books do not increase consensus count');
