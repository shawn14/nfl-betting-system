#!/usr/bin/env node
// Read-only proof: three public GETs; no credentials, database access, paid provider or cron.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {digest,eventState,makeCapture,validCapture} from '../../src/lib/measurement/core.ts';
import {publishedProducer} from '../../src/lib/forecast-provenance.ts';
import {espnOddsUrl} from '../../src/lib/espn-prices.ts';
const sourceUrl='https://0luulmjdaimldet9.public.blob.vercel-storage.com/prediction-matrix-data.json';
async function read(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(15000)});assert(r.ok,`Public source HTTP ${r.status}`);return r.json();}
const blob=await read(sourceUrl),now=Date.now();
const entry=blob.games.find(e=>Date.parse(e.game?.gameTime)>now+5*60000&&Date.parse(e.game?.gameTime)<now+72*36e5);assert(entry,'No eligible actual NFL forecast');
const odds=await read(espnOddsUrl('nfl',String(entry.game.id)));
const eventUrl=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${entry.game.id}`;
const rawEvent=await read(eventUrl),event=eventState(rawEvent),observedAt=new Date().toISOString();
const capture=makeCapture({sport:'nfl',entry,publishedAt:blob.generated,sourceUrl,sourceHash:digest(blob),rawPrices:odds.items?.find(x=>String(x.provider?.id)==='100')??odds.items?.[0]??{},event,observedAt});assert(capture);
const producer=publishedProducer(entry);assert.equal(capture.modelVersion,producer?.modelVersion??null);assert.equal(capture.modelSourceSha,producer?.sourceSha??null);
assert.equal(validCapture(capture),false,'Uncommitted public-read output must never become performance evidence');
const result={checkedAt:new Date().toISOString(),scope:'Read-only current public source through actual capture parser; no persistence, grades or performance claim',gameId:capture.gameId,modelVersion:capture.modelVersion,modelSourceSha:capture.modelSourceSha,committed:false,eligibleForReporting:false,sourceUrl,eventUrl,sourceHash:capture.sourceHash,capture};
await fs.writeFile(new URL('../../docs/measurement/provenance/public-read.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,capture:undefined},null,2));
