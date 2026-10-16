#!/usr/bin/env node
// One real public pregame forecast, real reserved Firestore collection, no production collection/cron/paid API.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {cert,initializeApp} from 'firebase-admin/app';
import {initializeFirestore} from 'firebase-admin/firestore';
import {MeasurementStore} from '../../src/lib/measurement/store.ts';
import {measurementReport} from '../../src/lib/measurement/report.ts';
import {json,BLOB_BASE,FILES,eventUrl} from '../../src/lib/measurement/runner.ts';
import {digest,eventState,makeCapture,validCapture} from '../../src/lib/measurement/core.ts';
import {publishedProducer,forecastCohort} from '../../src/lib/forecast-provenance.ts';
import {espnOddsUrl} from '../../src/lib/espn-prices.ts';
const raw=process.env.FIREBASE_ADMIN_CREDENTIALS;assert(raw);
const credentials=JSON.parse(raw.trim().startsWith('{')?raw:Buffer.from(raw,'base64').toString());
const db=initializeFirestore(initializeApp({credential:cert(credentials)},'provenance-proof'),{preferRest:true});
const collection=`predictionMeasurementProof_provenance_${process.pid}_${Date.now()}`;
const store=new MeasurementStore(db,collection);
const result={startedAt:new Date().toISOString(),collection,scope:'Real public forecast and reserved storage only; no deployed writer or settlement claim'};
try{
 const sourceUrl=`${BLOB_BASE}/${FILES.nfl}`,blob=await json(sourceUrl),now=Date.now();
 const entry=blob.games.find(e=>Date.parse(e.game?.gameTime)>now+5*60000&&Date.parse(e.game?.gameTime)<now+72*36e5);assert(entry,'No real eligible NFL forecast');
 const odds=await json(espnOddsUrl('nfl',String(entry.game.id)));
 const event=eventState(await json(eventUrl('nfl',String(entry.game.id))));
 const capture=makeCapture({sport:'nfl',entry,publishedAt:blob.generated,sourceUrl,sourceHash:digest(blob),rawPrices:odds.items?.find(x=>String(x.provider?.id)==='100')??odds.items?.[0]??{},event,observedAt:new Date().toISOString()});assert(capture);
 const expected=publishedProducer(entry);
 assert.equal(capture.modelVersion,expected?.modelVersion??null);assert.equal(capture.modelSourceSha,expected?.sourceSha??null);
 const first=await store.create(capture);assert(validCapture(first));assert.deepEqual(first.entry,entry);
 await store.create({...first,modelVersion:'DO NOT REWRITE',modelSourceSha:'f'.repeat(40)});
 const second=await new MeasurementStore(db,collection).get(first.id);assert.deepEqual(second,first);
 const report=await measurementReport(store);
 assert.equal(report.captures,1);assert.equal(report.model.length,first.markets.length);
 for(const row of report.model){assert.deepEqual(row.cohort,forecastCohort(entry));assert.equal(row.roi.n,0);assert.equal(row.captured,1);}
 assert.equal(report.unattributed,expected?.sourceSha?0:1);
 Object.assign(result,{checkedAt:new Date().toISOString(),ok:true,gameId:first.gameId,committedAt:first.committedAt,commence:first.commence,
   modelVersion:first.modelVersion,modelSourceSha:first.modelSourceSha,publishedProducer:expected,reportRows:report.model.length,
   unattributed:report.unattributed,sourceHash:first.sourceHash,capture:first,checks:['actual published producer retained without collector substitution','repeat write preserves original metadata','separate reader and actual measurement report preserve provenance','no settlement or winning record fabricated']});
}finally{
 for(const name of [collection,`${collection}Health`]){
  const snap=await db.collection(name).get();for(const doc of snap.docs)await doc.ref.delete();
  assert.equal((await db.collection(name).get()).size,0,'Reserved proof data must be cleaned');
 }
 result.cleaned=true;await db.terminate();
}
await fs.writeFile(new URL('../../docs/measurement/provenance/live.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,capture:undefined},null,2));
