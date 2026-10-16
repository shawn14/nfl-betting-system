#!/usr/bin/env node
// Real local or exact verified preview Next server only; no mocks, no paid endpoints. Set PM_HTTP_BASE explicitly.
import assert from 'node:assert/strict';
import {verifiedHttpBase} from '../measurement/http-target.mjs';
const base=await verifiedHttpBase();
const routes=['/results','/nba/results','/nhl/results','/cbb/results','/wnba/results','/faq','/about','/ev'];
for(const path of routes){
 const r=await fetch(base+path,{signal:AbortSignal.timeout(60000)});assert.equal(r.status,200,path);
 const body=await r.text();assert(!body.includes('approximately 55%'),`${path}: invalid accuracy claim`);
 if(path==='/ev') assert(body.includes('No edge or executable profit has been demonstrated.'));
 if(path.endsWith('results')){
  assert(body.includes('Measured results'),path);assert(body.includes('Prospective collection is not enabled'),path);
  assert(body.includes('Historical results were recalculated after games'),path);
 }
 console.log(`PASS real Next response ${path}`);
}
const data=await(await fetch(base+'/api/measurement')).json();assert.equal(data.state,'disabled');assert.equal(data.report,null);
for(const path of ['/api/cron/measurement','/api/cron/odds-board-record','/api/cron/odds-props-record']){
 const r=await fetch(base+path);assert.equal(r.status,401,`${path}: unauthenticated request must not collect or spend`);
 console.log(`PASS denied unauthorized ${path}`);
}
console.log('PASS real HTTP proof: no fabricated performance, all five results routes, auth gates');
