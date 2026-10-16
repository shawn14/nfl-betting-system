#!/usr/bin/env node
// Real deployed source artifact + explicitly diagnostic clock/outcome mutations. No service writes.
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
import {researchReport,researchDecision,RESEARCH_POLICY,registrationId,validRegistration,consistentResearchCapture} from '../../src/lib/measurement/research.ts';
import {RESEARCH_HASH,RESEARCH_FILES} from '../../src/lib/measurement/research-identity.ts';
import {digest,settle} from '../../src/lib/measurement/core.ts';
const source=JSON.parse(await fs.readFile(new URL('../../docs/measurement/source-diagnosis/deployed.json',import.meta.url)));
assert.equal(source.ok,true);assert.equal(source.region,'iad1');assert(source.checks.every(x=>x.status===200));
const raw=source.candidate;assert(raw);assert.equal(raw.markets.length,3);assert(!raw.committedAt,'Transient probe must never masquerade as a stored capture');
assert.equal(researchReport(null,[raw],[]).candidates.length,0);
const at=Date.parse(raw.capturedAt),reg={id:registrationId(),kind:'research-registration',codeHash:RESEARCH_HASH,files:RESEARCH_FILES,
 policyHash:digest({policy:RESEARCH_POLICY,codeHash:RESEARCH_HASH}),policy:RESEARCH_POLICY,sourceSha:source.sourceSha,
 registeredAt:new Date(at-2000).toISOString(),committedAt:new Date(at-1000).toISOString()};
assert(validRegistration(reg));
const c={...raw,committedAt:new Date(at+1).toISOString()};
assert(consistentResearchCapture(c));
for(const mutate of [x=>{x.markets[0].priceA=1000;},x=>{x.markets[0].marketA=.01;},x=>{x.markets[0].modelA=.99;},
 x=>{x.status.state='post';},x=>{x.publishedAt=new Date(at-24*36e5).toISOString();},x=>{x.markets[0].side='b';},
 x=>{x.rawPrices.$ref=x.rawPrices.$ref.replace(x.gameId,'000000000');},x=>{x.rawPrices.homeTeamOdds.team.$ref=x.rawPrices.awayTeamOdds.team.$ref;},
 x=>{x.entry.prediction.gameId='401000000';}]){
 const bad=structuredClone(c);mutate(bad);
 assert.equal(consistentResearchCapture(bad),false,'Derived fields/status/clocks cannot override retained source evidence');
 assert.equal(researchReport(reg,[bad],[],at+10).candidates.length,0);
}
const first=researchReport(reg,[c],[],at+10),second=researchReport(reg,[c],[],at+60000);
assert.equal(first.candidates.length,9);assert.deepEqual(first.candidates,second.candidates);
assert(first.candidates.every(x=>x.games===0&&x.status==='collecting'));
assert.equal(first.comparisons,135);assert.equal(first.autoPromotion,false);
assert.equal(researchReport({...reg,committedAt:new Date(at+2).toISOString()},[c],[],at+10).candidates.length,0);
assert.equal(researchReport(reg,[{...c,committedAt:c.commence}],[],at+10).candidates.length,0);
const old=structuredClone(c);delete old.entry.prediction.forecastProducer;
assert.equal(researchReport(reg,[old],[],at+10).candidates.length,0);
const drift=structuredClone(reg);drift.policy.costStressPerUnit=0;
assert.equal(validRegistration(drift),false);
const reorder=x=>x&&typeof x==='object'?(Array.isArray(x)?x.map(reorder):Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reorder(v)]))):x;
assert(validRegistration(reorder(reg)),'Firestore field order cannot invalidate registration');
// The real game is still upcoming. Scores below are test-only branches, NOT observed performance.
const finish=Date.parse(c.commence)+4*36e5;
for(const scores of [[21,17],[7,35],[21,21]]){
 const event={...c.status,state:'post',status:'STATUS_FINAL',completed:true,homeScore:scores[0],awayScore:scores[1]};
 const s={...settle(c,event,'diagnostic-score-replay',finish),committedAt:new Date(finish+1).toISOString()};
 const result=researchReport(reg,[c],[s],finish+2);
 assert(result.candidates.some(x=>x.games===1));assert(result.candidates.every(x=>x.status==='collecting'));
 for(const row of result.candidates){
  const m=c.markets.find(x=>x.market===row.market),d=researchDecision(c,m,row.rule);
  if(!d){assert.equal(row.games,0);continue;}
  const delta=m.market==='ml'?scores[0]-scores[1]:m.market==='spread'?scores[0]-scores[1]+m.line:scores[0]+scores[1]-m.line;
  const win=(d.side==='a')===(delta>0),payout=d.price>0?d.price/100:100/-d.price;
  assert(Math.abs(row.roi.mean-((delta===0?0:win?payout:-1)-.01))<1e-12);
 }
 assert.deepEqual(researchReport(reg,[c],[reorder(s)],finish+2).candidates,result.candidates);
 assert.deepEqual(researchReport(reorder(reg),[reorder(c)],[reorder(s)],finish+2).candidates,result.candidates,'Object order is not capture identity');
 const bad=structuredClone(s);bad.grades[0].units+=100;
 assert(researchReport(reg,[c],[bad],finish+2).candidates.every(x=>x.games===0));
 assert(researchReport(reg,[c],[s,s],finish+2).candidates.every(x=>x.games===0));
 assert(researchReport(reg,[c],[s],at+10).candidates.every(x=>x.games===0),'Future settlement cannot grade current report');
 assert(researchReport(reg,[c],[s],at+57*864e5).candidates.every(x=>x.status==='insufficient-evidence'));
}
const other=structuredClone(c);other.gameId+='0';other.id=`model-${other.sport}-${other.gameId}`;other.status.id=other.gameId;other.entry.game.id=other.gameId;
other.entry.prediction.gameId=other.gameId;
other.rawPrices.$ref=other.rawPrices.$ref.replaceAll(c.gameId,other.gameId);
other.entry.prediction.forecastProducer.sourceSha='a'.repeat(40);other.modelSourceSha='a'.repeat(40);
const separated=researchReport(reg,[c,other],[],at+10);
assert.equal(separated.candidates.length,18);assert.equal(separated.comparisons,270);
assert(researchReport(reg,[c,c],[],at+10).exclusions.duplicate_capture===1);
assert.equal(researchReport(null,Array(815).fill({id:'legacy',kind:'legacy'}),[],at+10).candidates.length,0);
console.log(JSON.stringify({ok:true,realSource:source.sourceSha,realEvent:c.gameId,realMarkets:3,candidateGroups:9,
 selected:first.candidates.reduce((n,r)=>n+r.selected,0),checks:['unknown/legacy excluded','registration precedes capture','policy/code drift rejected',
 'Firestore field order independent','separate producer cohorts','same-input repeat invariant','three score replays','tampered/duplicate/future settlement excluded',
 'stress costs independently recomputed','no interim promotion','fixed horizon insufficient sample'],
 limitation:'Clock/outcome/registration mutations are diagnostics only. No stored forward experiment or actual final settlement proven.'},null,2));
