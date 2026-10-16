#!/usr/bin/env node
// Real public data + real Firestore create/read/concurrency/cleanup. Never runs a production cron.
// Credentials supplied through the established Vercel environment by run-proof.mjs; never on disk.
import assert from 'node:assert/strict';
import { cert,initializeApp } from 'firebase-admin/app';
import { initializeFirestore } from 'firebase-admin/firestore';
import { MeasurementStore } from '../../src/lib/measurement/store.ts';
import { collect, json, BLOB_BASE, FILES, eventUrl } from '../../src/lib/measurement/runner.ts';
import { digest,eventState,makeCapture,settle,validCapture } from '../../src/lib/measurement/core.ts';
import { espnOddsUrl } from '../../src/lib/espn-prices.ts';
import fs from 'node:fs/promises';
const raw=process.env.FIREBASE_ADMIN_CREDENTIALS;
assert(raw,'FIREBASE_ADMIN_CREDENTIALS required through existing Vercel path');
const credentials=JSON.parse(raw.trim().startsWith('{')?raw:Buffer.from(raw,'base64').toString());
const db=initializeFirestore(initializeApp({credential:cert(credentials)},'measurement-proof'),{preferRest:true});
const collection=`predictionMeasurementProof_${process.pid}_${Date.now()}`;
assert(collection.startsWith('predictionMeasurementProof_'));
const store=new MeasurementStore(db,collection), results={collection,started:new Date().toISOString(),checks:[]};
try {
  console.log('Proof: read public forecasts and current prices');
  const first=await collect(store,true);
  results.candidates=first.observations;
  assert(first.captures.length>0,'No real eligible pregame forecast: rerun in the final 72 hours before a supported game');
  const c=first.captures[0];
  console.log('Proof: persist concurrent immutable capture',c.sport,c.gameId);
  const [a,b]=await Promise.all([store.create(c),store.create(c)]);
  assert.deepEqual(a.entry,c.entry,'Saved forecast must exactly match the real published forecast');
  assert.deepEqual(a,b,'Concurrent writes must return the same first persisted forecast');
  assert(validCapture(a),'Firestore server creation timestamp must precede deadline');
  const before=digest(a);
  await store.create({...a,provider:'MUTATION SHOULD NOT LAND',prices:{totalLine:999,overPrice:999},entry:{prediction:{}}});
  assert.equal(digest(await store.get(a.id)),before,'Repeat runs must not rewrite forecast, bookmaker or price');
  results.checks.push('real pregame source / fresh event status / quoted prices captured','Firestore concurrent create retains one immutable first record','repeat write leaves forecast and prices byte-identical');
  console.log('Proof: second collection');
  const second=await collect(store,true);
  assert(!second.captures.some(x=>x.id===a.id),'Run two must read run one’s persisted capture');
  assert.equal(digest(await store.get(a.id)),before);
  results.checks.push('second real collection reads first persisted capture');
  const late={...c,id:`${c.id}-late`,deadline:new Date(Date.now()-60000).toISOString()};
  assert.equal(validCapture(await store.create(late)),false);
  assert.equal(settle(a,{...a.status,state:'in',completed:false},'proof'),null);
  results.checks.push('late server commit excluded','in-progress status cannot settle');
  const repeat=(await store.list('model')).filter(x=>x.id===a.id);
  assert.equal(repeat.length,1);
  results.capture={...a,rawPrices:a.rawPrices,entry:a.entry};
  // Read authoritative final scores for a real completed game. Replay tests are explicitly NOT prospective records.
  const audit=JSON.parse(await fs.readFile(new URL('../../docs/reports/2026-10-15-edge-audit/nfl.json',import.meta.url)));
  const finished=audit.backtest.results.filter(x=>x.modelVersion==='2026-09-11-freeze').at(-1);
  results.finalEvent=eventState(await json(eventUrl('nfl',finished.gameId)));
  assert(results.finalEvent.completed && results.finalEvent.state==='post');
  await fs.mkdir(new URL('../../docs/measurement/proof/',import.meta.url),{recursive:true});
  await fs.writeFile(new URL('../../docs/measurement/proof/live.json',import.meta.url),JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify({ok:true,checks:results.checks,capture:{sport:a.sport,gameId:a.gameId,committedAt:a.committedAt,commence:a.commence,provider:a.provider,markets:a.markets.length},collection},null,2));
} finally {
  // Only this run's reserved namespace; never delete or change active measurement/customer collections.
  console.log('Proof: clean reserved test collections',collection);
  for (const name of [collection,`${collection}Health`]) {
    const snap=await db.collection(name).get();
    for (const doc of snap.docs) await doc.ref.delete();
  }
  await db.terminate();
}
