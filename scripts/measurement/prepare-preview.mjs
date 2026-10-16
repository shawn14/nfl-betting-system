#!/usr/bin/env node
// Branch-scoped public Firebase client settings only. No admin/paid secrets, deployment or permission changes.
// API contract: https://vercel.com/docs/rest-api/projects/create-one-or-more-environment-variables
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
assert.equal(branch,'codex/prediction-terminal','Only the approved review branch');
const primary=path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
const base=`https://api.vercel.com/v10/projects/${project.projectId}/env`;
async function request(url,body){const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${auth.token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});assert(r.ok,`Vercel ${body?'write':'read'} HTTP ${r.status}`);return r.json();}
const alias=await request(`https://api.vercel.com/v4/aliases/www.predictionmatrix.com?teamId=${project.orgId}`);
const live=await request(`https://api.vercel.com/v13/deployments/${alias.deploymentId??alias.deployment?.id}?teamId=${project.orgId}`);
assert.equal(live.projectId,project.projectId);assert.equal(live.readyState,'READY');
const sha=execFileSync('git',['ls-remote','origin','refs/heads/main'],{encoding:'utf8'}).trim().split(/\s+/)[0];
assert.equal(live.meta.githubCommitSha,sha,'Stop on production/source drift');
const initial=(await request(`${base}?teamId=${project.orgId}`)).envs;
const preview=initial.filter(e=>e.target?.includes('preview')&&(!e.gitBranch||e.gitBranch===branch));
assert(!preview.some(e=>['FEATURE_MEASUREMENT_ENABLED','FIREBASE_ADMIN_CREDENTIALS','NEXT_PUBLIC_ODDS_API_KEY'].includes(e.key)),'Preview cannot gain collectors or privileged credentials');
const source=await fs.readFile(new URL('../../src/lib/firebase.ts',import.meta.url),'utf8');
const keys=[...new Set(source.match(/NEXT_PUBLIC_FIREBASE_[A-Z_]+/g))];assert.equal(keys.length,6);
const plan=[];
for(const key of keys){
 const matches=initial.filter(e=>e.key===key&&e.target?.includes('production'));assert.equal(matches.length,1,`Unique production client setting ${key}`);
 const value=await request(`${base}/${matches[0].id}?teamId=${project.orgId}`);assert(typeof value.value==='string'&&value.value.trim(),`Missing public client value ${key}`);
 const existing=preview.filter(e=>e.key===key&&e.gitBranch===branch);assert(existing.length<=1);
 if(existing[0]){const old=await request(`${base}/${existing[0].id}?teamId=${project.orgId}`);assert.equal(old.value,value.value,`Existing branch value differs: ${key}`);}
 plan.push({key,value:value.value,existing:existing[0]?.id??null});
}
const apply=process.argv.includes('--apply');
console.log(JSON.stringify({apply,branch,productionSha:sha,clientSettingCount:keys.length,createKeys:plan.filter(x=>!x.existing).map(x=>x.key),unchangedKeys:plan.filter(x=>x.existing).map(x=>x.key)},null,2));
if(!apply)process.exit(0);
for(const row of plan.filter(x=>!x.existing)){
 const r=await request(`${base}?teamId=${project.orgId}`,{key:row.key,value:row.value,type:'encrypted',target:['preview'],gitBranch:branch,comment:'Public Firebase browser configuration for approved Prediction Matrix review preview.'});
 assert(!r.failed?.length,`Create failed: ${row.key}`);
}
const after=(await request(`${base}?teamId=${project.orgId}`)).envs;
const checked=[];
for(const row of plan){const matches=after.filter(e=>e.key===row.key&&e.gitBranch===branch&&e.target?.length===1&&e.target[0]==='preview');assert.equal(matches.length,1);const stored=await request(`${base}/${matches[0].id}?teamId=${project.orgId}`);assert.equal(stored.value,row.value);checked.push({key:row.key,id:matches[0].id,target:matches[0].target,gitBranch:matches[0].gitBranch,valueMatchesProduction:true});}
assert.deepEqual(after.filter(e=>e.target?.includes('production')).map(e=>[e.id,e.key,e.updatedAt]).sort(),initial.filter(e=>e.target?.includes('production')).map(e=>[e.id,e.key,e.updatedAt]).sort(),'Production env metadata changed');
const receipt={checkedAt:new Date().toISOString(),branch,productionSha:sha,onlyPublicClientSettings:true,adminCredentialsCopied:false,paidOddsKeyCopied:false,measurementEnabled:false,settings:checked};
await fs.writeFile(new URL('../../docs/preview/client-config.json',import.meta.url),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
