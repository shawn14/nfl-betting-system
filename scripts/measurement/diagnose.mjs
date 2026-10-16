#!/usr/bin/env node
// One bounded read-only probe. Saves the exact response even when the source fails; never retries.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),option=n=>args[args.indexOf(n)+1];
assert(args.includes('--sport')&&['nfl','nba','nhl','cbb','wnba'].includes(option('--sport')));
assert(args.includes('--event')&&/^\d{6,12}$/.test(option('--event')));
assert(args.includes('--out')&&option('--out'),'Pass a new --out file');
const out=path.resolve(option('--out'));await fs.mkdir(path.dirname(out),{recursive:true});
const handle=await fs.open(out,'wx'); // Refuse overwrite before making any request.
let result;
try {
 if(args.includes('--local')){
  const {diagnoseSource}=await import('../../src/lib/measurement/diagnose.ts');
  result=await diagnoseSource(option('--sport'),option('--event'));
 }else{
  assert(args.includes('--sha')&&/^[a-f0-9]{40}$/.test(option('--sha')),'Verified --sha required for deployed probe');
  const sha=option('--sha'),primary=process.env.PM_PRIMARY_REPO??path.join(os.homedir(),'projects/nfl-betting-system');
  const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
  const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
  async function api(route){const r=await fetch(`https://api.vercel.com${route}?teamId=${project.orgId}`,{headers:{Authorization:`Bearer ${auth.token}`},signal:AbortSignal.timeout(20000)});assert(r.ok,`Vercel read HTTP ${r.status}`);return r.json();}
  const alias=await api('/v4/aliases/www.predictionmatrix.com');
  const live=await api(`/v13/deployments/${alias.deploymentId??alias.deployment?.id}`);
  assert.equal(live.projectId,project.projectId);assert.equal(live.readyState,'READY');assert.equal(live.meta?.githubCommitSha,sha);
  assert.equal(execFileSync('git',['ls-remote','origin','refs/heads/main'],{cwd:primary,encoding:'utf8'}).trim().split(/\s+/)[0],sha);
  const envBase=`/v10/projects/${project.projectId}/env`,envs=(await api(envBase)).envs;
  const secrets=envs.filter(e=>e.key==='CRON_SECRET'&&e.target?.includes('production'));assert.equal(secrets.length,1);
  const secret=(await api(`${envBase}/${secrets[0].id}`)).value;assert(typeof secret==='string'&&secret);
  const r=await fetch(`https://www.predictionmatrix.com/api/admin/measurement-source?sport=${option('--sport')}&event=${option('--event')}`,{
   headers:{Authorization:`Bearer ${secret}`},cache:'no-store',signal:AbortSignal.timeout(65000)});
  const body=await r.json();result={...body,httpStatus:r.status,deployment:live.id,expectedSha:sha};
  assert.equal(body.sourceSha,sha,'Diagnostic response is not from verified serving source');
 }
 await handle.writeFile(JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,candidate:result.candidate?{id:result.candidate.id,markets:result.candidate.markets}:null},null,2));
 if(!result.ok)process.exitCode=1;
}finally{await handle.close();}
