#!/usr/bin/env node
// Real serving API + actual Firestore server metadata. Read-only; no cron or fixture writes.
import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {researchReport,registrationId,validRegistration} from '../../src/lib/measurement/research.ts';
import {eventState} from '../../src/lib/measurement/core.ts';
import {eventUrl} from '../../src/lib/measurement/runner.ts';
const args=process.argv.slice(2),option=n=>args[args.indexOf(n)+1];
assert(args.includes('--sha')&&/^[a-f0-9]{40}$/.test(option('--sha')));
assert(args.includes('--out')&&option('--out'));
const out=path.resolve(option('--out')),raw=out+'.storage.json';
const probeArgs=[fileURLToPath(new URL('./inspect-production.mjs',import.meta.url)),'--sha',option('--sha'),'--out',raw,'--require-enabled'];
if(args.includes('--compare'))probeArgs.push('--compare',path.resolve(option('--compare'))+'.storage.json');
execFileSync(process.execPath,probeArgs,{stdio:'inherit',timeout:120000});
const actual=JSON.parse(await fs.readFile(raw,'utf8')),e=actual.publicReport.report.evidence;
const reg=e.registrations.find(r=>r.id===registrationId());assert(validRegistration(reg),'No valid actual registration');
const stored=actual.records.find(x=>x.id===reg.id);assert(stored,'Missing registration in actual Firestore');
assert.equal(stored.createTime,stored.updateTime,'Registration mutated');
assert.equal(reg.committedAt,new Date(stored.createTime).toISOString(),'Public registration lacks actual server time');
const local=researchReport(reg,e.captures,e.settlements,Date.parse(actual.publicReport.report.updated));
assert.deepEqual(actual.publicReport.report.research,local,'Serving report differs from current implementation/evidence');
const health=actual.health.research;assert.equal(health?.state,'registered');assert.equal(health.policyHash,local.policyHash);
assert(Date.now()-Date.parse(health.checkedAt)<45*60e3,'No fresh scheduled research evaluation');
assert(local.candidates.length>0&&local.candidates.some(c=>c.selected>0),'No actual eligible candidate screens');
assert.equal(health.candidateGroups,local.candidates.length,'Cycle and public candidate counts diverge');
assert.equal(health.selected,local.candidates.reduce((n,c)=>n+c.selected,0));
assert.equal(health.graded,local.candidates.reduce((n,c)=>n+c.games,0));
assert.deepEqual(health.exclusions,local.exclusions,'Cycle and public exclusions diverge');
let finalProof=null;
if(args.includes('--require-final')){
 assert(local.candidates.some(c=>c.games>0),'No actual graded forward candidate');
 const final=e.settlements.find(s=>{
  if(s.status!=='final')return false;
  const capture=e.captures.find(c=>c.id===s.captureId);if(!capture)return false;
  return researchReport(reg,[capture],[s],Date.parse(actual.publicReport.report.updated)).candidates.some(r=>r.games>0);
 });
 assert(final,'No final settlement');
 const response=await fetch(eventUrl(final.sport,final.gameId),{cache:'no-store',signal:AbortSignal.timeout(15000)});
 assert(response.ok,`Actual final source HTTP ${response.status}`);const event=eventState(await response.json());
 for(const key of ['id','commence','state','status','completed','homeId','awayId','homeScore','awayScore'])assert.equal(event[key],final.event[key],`Final source changed ${key}`);
 finalProof={captureId:final.captureId,gameId:final.gameId,sport:final.sport,event,settledAt:final.settledAt,committedAt:final.committedAt};
}
if(args.includes('--compare')){
 const before=JSON.parse(await fs.readFile(path.resolve(option('--compare')),'utf8'));
 assert.equal(before.registrationId,reg.id);assert(Date.parse(health.checkedAt)>Date.parse(before.researchCheckedAt),'Research did not execute a second cycle');
}
const result={ok:true,checkedAt:new Date().toISOString(),sha:option('--sha'),registrationId:reg.id,registrationServerTime:stored.createTime,
 researchCheckedAt:health.checkedAt,captures:e.captures.length,candidateGroups:local.candidates.length,
 selected:local.candidates.reduce((n,c)=>n+c.selected,0),graded:local.candidates.reduce((n,c)=>n+c.games,0),
 repeatedRun:!!actual.comparison,comparison:actual.comparison,finalProof,
 limitation:'Paper collection/evaluation only. No prediction edge, actual fills, profit or future settlement inferred.'};
await fs.writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result,null,2));
