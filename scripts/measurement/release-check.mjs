#!/usr/bin/env node
// READ ONLY: verifies the actual serving alias, GitHub main, required env names and measurement state.
// Never deploys, changes env, invokes a cron, retrieves a secret value, or calls a paid odds endpoint.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const primary=process.env.PM_PRIMARY_REPO??path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
async function read(url){const r=await fetch(url,{headers:{Authorization:`Bearer ${auth.token}`},signal:AbortSignal.timeout(20000)});assert(r.ok,`Vercel read HTTP ${r.status}`);return r.json();}
const remote=execFileSync('git',['remote','get-url','origin'],{cwd:primary,encoding:'utf8'}).trim();
assert(/(?:github.com[:/])shawn14\/nfl-betting-system(?:\.git)?$/.test(remote),'Unexpected GitHub repo');
const main=execFileSync('git',['ls-remote','origin','refs/heads/main'],{cwd:primary,encoding:'utf8'}).trim().split(/\s+/)[0];
const alias=await read(`https://api.vercel.com/v4/aliases/www.predictionmatrix.com?teamId=${project.orgId}`);
const deployment=await read(`https://api.vercel.com/v13/deployments/${alias.deploymentId??alias.deployment?.id}?teamId=${project.orgId}`);
assert.equal(deployment.projectId,project.projectId,'Domain belongs to a different project');
const sha=deployment.meta?.githubCommitSha;
assert(sha,'Serving deployment lacks GitHub source SHA');
assert.equal(deployment.readyState,'READY','Serving deployment is not ready');
const envs=await read(`https://api.vercel.com/v10/projects/${project.projectId}/env?teamId=${project.orgId}`);
const names=envs.envs.filter(e=>e.target?.includes('production')).map(e=>e.key);
const required=['CRON_SECRET','FIREBASE_ADMIN_CREDENTIALS','BLOB_READ_WRITE_TOKEN'];
assert(required.every(name=>names.includes(name)),'Missing required production credential reference');
const stateResponse=await fetch('https://www.predictionmatrix.com/api/measurement',{signal:AbortSignal.timeout(20000),cache:'no-store'});
let measurement={state:'not-deployed',httpStatus:stateResponse.status};
if(stateResponse.ok) measurement=await stateResponse.json();
const ix=process.argv.indexOf('--expect-live');
if(ix>=0){assert(process.argv[ix+1],'--expect-live requires a SHA');assert.equal(sha,process.argv[ix+1]);assert.equal(main,sha,'GitHub main differs from serving source');}
if(process.argv.includes('--require-enabled')){
 assert.equal(measurement.state,'available');assert.equal(measurement.report?.health?.ok,true);
 assert(Date.now()-Date.parse(measurement.report.health.updated)<45*60e3,'No fresh successful collector run');
}
console.log(JSON.stringify({checkedAt:new Date().toISOString(),repo:remote,githubMain:main,liveSha:sha,mainMatchesLive:main===sha,
 deployment:deployment.id,state:deployment.readyState,requiredEnvNames:required,flagConfigured:names.includes('FEATURE_MEASUREMENT_ENABLED'),
 measurementState:measurement.state,health:measurement.report?.health??null,captures:measurement.report?.captures??null},null,2));
