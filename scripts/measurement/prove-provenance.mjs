#!/usr/bin/env node
// Archived REAL public forecast/price inputs. Diagnostic mutations are never performance evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {makeCapture,eventState,digest} from '../../src/lib/measurement/core.ts';
const root=new URL('../../',import.meta.url);
const read=async path=>JSON.parse(await fs.readFile(new URL(path,root),'utf8'));
const blob=await read('docs/reports/2026-10-15-edge-audit/wnba.json');
const rawPrices=(await read('docs/measurement/proof/wnba-prices.json')).items[0];
const event=eventState(await read('docs/measurement/proof/wnba-event.json'));
const entry=blob.games.find(e=>String(e.game.id)===event.id);
const now=Date.parse('2026-10-16T02:00:00Z');
const capture=makeCapture({sport:'wnba',entry,publishedAt:blob.generated,sourceUrl:'captured-real-public-blob',sourceHash:digest(blob),rawPrices,event,observedAt:new Date(now).toISOString(),now});
assert(capture);
assert.equal(entry.prediction.forecastProducer,undefined,'Actual original public forecast has no producer stamp');
assert.equal(capture.modelVersion,null,'An unstamped real forecast must not inherit the collector model version');
console.log('PASS: actual unstamped forecast retains unknown producer');

const {forecastProducer,publishedProducer,forecastCohort}=await import('../../src/lib/forecast-provenance.ts');
const {modelCohortReport}=await import('../../src/lib/measurement/report.ts');
const {settle}=await import('../../src/lib/measurement/core.ts');
const {execFileSync}=await import('node:child_process');
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const earlierSha=execFileSync('git',['rev-parse','HEAD^'],{encoding:'utf8'}).trim();
let realEntries=0;const inventory=[];
for(const sport of ['nfl','nba','nhl','cbb','wnba']){
 const source=await read(`docs/terminal/proof/${sport}.json`);
 const games=source.data.games;
 for(const row of games){assert.equal(publishedProducer(row),null);realEntries++;}
 inventory.push({sport,games:games.length,publishedProducers:0});
 const route={nfl:'blob-sync-simple',nba:'nba-sync',nhl:'nhl-sync',cbb:'cbb-sync',wnba:'wnba-sync'}[sport];
 const writer=await fs.readFile(new URL(`src/app/api/cron/${route}/route.ts`,root),'utf8');
 assert(writer.includes("import { forecastProducer } from '@/lib/forecast-provenance'"));
 assert(writer.includes('forecastProducer: forecastProducer(process.env.VERCEL_GIT_COMMIT_SHA)'));
}
const saved={...capture,committedAt:new Date(now+1).toISOString()};
const legacy={...saved,modelVersion:'2026-09-11-freeze',modelSourceSha:sha,collectorSha:sha};
const legacyRows=modelCohortReport([legacy],[]).model;
assert.equal(legacyRows.length,3);assert(legacyRows.every(r=>r.cohort.modelVersion===null&&r.cohort.sourceSha===null));
// Diagnostic metadata/identity variations exercise separation; never interpreted as real captures/results.
const stamped=(name,producer)=>({...saved,id:saved.id+'-'+name,gameId:saved.gameId+'-'+name,
 entry:{...structuredClone(saved.entry),prediction:{...structuredClone(saved.entry.prediction),forecastProducer:producer}},
 modelVersion:'DO NOT TRUST COLLECTOR LABEL',modelSourceSha:null,collectorSha:sha});
const first=stamped('first',forecastProducer(sha));
const second=stamped('second',forecastProducer(earlierSha));
const changed=stamped('changed',{...forecastProducer(sha),modelVersion:'diagnostic-version-change'});
const anonymous=stamped('anonymous',forecastProducer(undefined));
const variations=[legacy,first,second,changed,anonymous];
const rows=modelCohortReport(variations,[]).model;
assert.equal(rows.length,15,'Five producer cohorts must remain separate in all three markets');
assert(rows.every(r=>r.captured===1));
assert.equal(new Set(rows.map(r=>r.cohort.key)).size,5);
assert.equal(rows.filter(r=>r.cohort.attributed).length,9);
for(const bad of [null,{},'bad',{schemaVersion:'unexpected',modelVersion:'v',sourceSha:sha},{...forecastProducer(sha),modelVersion:' v'}]){
 assert.equal(publishedProducer({prediction:{forecastProducer:bad}}),null);
}
assert.equal(forecastProducer('not-a-sha').sourceSha,null);
// Score mutations are diagnostic only: the exact production grader and report must keep grades in their source cohort.
const settlements=variations.map((c,i)=>{
 const game={...c.status,id:c.gameId,state:'post',status:'STATUS_FINAL',completed:true,homeScore:90+i,awayScore:80};
 const result=settle(c,game,'diagnostic-score-only',Date.parse(c.commence)+5*36e5);assert(result);
 return {...result,committedAt:new Date(Date.parse(c.commence)+5*36e5+1).toISOString()};
});
const scored=modelCohortReport(variations,settlements).model;
assert(scored.every(r=>r.roi.n===1),'A grade must appear only in its original producer cohort');
for(const c of variations){
 const own=modelCohortReport([c],settlements).model;
 for(const r of own)assert.deepEqual(r,scored.find(x=>x.sport===r.sport&&x.market===r.market&&x.cohort.key===r.cohort.key));
}
assert.equal(modelCohortReport([legacy],[{...settlements[0],committedAt:'invalid'}]).model[0].roi.n,0);
const result={checkedAt:new Date().toISOString(),realPublishedEntries:realEntries,inventory,
 redObserved:'Actual unstamped WNBA forecast was assigned collector version 2026-09-11-freeze; expected null',
 realRecordProof:'Original archived forecast is captured without invented producer attribution; legacy labels cannot establish attribution',
 diagnosticChecks:['five metadata cohorts stay separate across all three markets','same version/different source commit separates','different version/same source commit separates','missing producer/source remains explicit','grades remain in original cohort','invalid committed time excluded'],
 limits:'Metadata/score mutations are diagnostics only. No prospective results, deployed writer provenance or better prediction performance proven.'};
await fs.writeFile(new URL('docs/measurement/provenance/check.json',root),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
