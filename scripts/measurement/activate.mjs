#!/usr/bin/env node
// Approved operator only. Default: read-only. Deploys exact GitHub main, never local files.
// API contracts: Vercel deployments/create-a-new-deployment, projects/create-one-or-more-
// environment-variables, projects/edit-an-environment-variable (POST v13, POST v10, PATCH v9).
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {publishedProducer} from '../../src/lib/forecast-provenance.ts';
import {BLOB_BASE, FILES} from '../../src/lib/measurement/runner.ts';
import {MODEL_VERSION} from '../../src/lib/model-version.ts';

const args=process.argv.slice(2), option=name=>args[args.indexOf(name)+1];
assert(args.includes('--sha') && /^[a-f0-9]{40}$/.test(option('--sha')), 'Pass --sha <full verified main SHA>');
assert(args.includes('--value') && ['0','1'].includes(option('--value')), 'Pass --value 0 or 1');
const sha=option('--sha'), value=option('--value'), apply=args.includes('--apply');
const primary=process.env.PM_PRIMARY_REPO??path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
const flag='FEATURE_MEASUREMENT_ENABLED', host='www.predictionmatrix.com';
const receiptPath=args.includes('--receipt')?path.resolve(option('--receipt')):null;
assert(!apply || receiptPath,'--apply requires --receipt <new file>');
const receipt={startedAt:new Date().toISOString(),apply,sha,value,phase:'preflight'};
async function save(phase,extra={}) {Object.assign(receipt,{phase,updatedAt:new Date().toISOString()},extra);if(apply)await fs.writeFile(receiptPath,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));}
const sh=(cmd,argv)=>execFileSync(cmd,argv,{cwd:primary,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function api(route,method='GET',body) {
 const r=await fetch(`https://api.vercel.com${route}${route.includes('?')?'&':'?'}teamId=${project.orgId}`,{
  method,headers:{Authorization:`Bearer ${auth.token}`,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
 assert(r.ok,`Vercel ${method} ${route.split('?')[0]} HTTP ${r.status}; stop and inspect, do not retry blindly`);
 return r.json();
}
const envBase=`/v10/projects/${project.projectId}/env`;
async function serving(){
 const alias=await api(`/v4/aliases/${host}`);
 const d=await api(`/v13/deployments/${alias.deploymentId??alias.deployment?.id}`);
 assert.equal(d.projectId,project.projectId);assert.equal(d.readyState,'READY');
 assert.equal(d.meta?.githubCommitSha,sha,'Serving source differs from approved SHA');return d;
}
function cleanMain(){
 assert.equal(sh('git',['branch','--show-current']),'main','Primary must remain on main');
 assert.equal(sh('git',['status','--porcelain']),'','Primary must be clean');
 assert(/github.com[:/]shawn14\/nfl-betting-system(?:\.git)?$/.test(sh('git',['remote','get-url','origin'])));
 assert.equal(sh('git',['rev-parse','HEAD']),sha);
 assert.equal(sh('git',['ls-remote','origin','refs/heads/main']).split(/\s+/)[0],sha,'Fresh GitHub main differs');
}
const flags=envs=>envs.filter(e=>e.key===flag && e.target?.includes('production'));
function validateFlag(envs){
 const found=flags(envs);assert(found.length<=1,'Ambiguous production flags');
 if(found.length){assert.deepEqual(found[0].target,['production']);assert(!found[0].gitBranch && !found[0].customEnvironmentIds?.length,'Unexpected flag scope');}
 return found[0];
}
async function producerReadiness(){
 const rows=[];
 for(const [sport,file] of Object.entries(FILES)){
  const r=await fetch(`${BLOB_BASE}/${file}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});assert(r.ok,`${sport} source HTTP ${r.status}`);
  const b=await r.json(),now=Date.now();assert(Array.isArray(b.games),`${sport}: missing games`);
  assert(b.games.every(e=>e.game?.id && Number.isFinite(Date.parse(e.game.gameTime))),`${sport}: malformed game identity/start`);
  assert.equal(new Set(b.games.map(e=>String(e.game.id))).size,b.games.length,`${sport}: duplicate game identity`);
  const candidates=b.games.filter(e=>Date.parse(e.game?.gameTime)>now+120000 && Date.parse(e.game?.gameTime)<=now+72*36e5);
  const mismatches=candidates.filter(e=>{const p=publishedProducer(e);return p?.sourceSha!==sha || p?.modelVersion!==MODEL_VERSION;}).map(e=>String(e.game.id));
  const age=now-Date.parse(b.generated), fresh=Number.isFinite(age)&&age>=0&&age<=3*36e5;
  rows.push({sport,publishedAt:b.generated,candidates:candidates.length,fresh,mismatches});
 }
 // This commissioning waits for the actual NFL writer. An empty/malformed refresh is not readiness.
 return {ready:rows.every(r=>!r.candidates || (r.fresh&&!r.mismatches.length)) && rows.find(r=>r.sport==='nfl').candidates>0,rows};
}

try {
 if(apply){await fs.mkdir(path.dirname(receiptPath),{recursive:true});await fs.writeFile(receiptPath,JSON.stringify(receipt)+'\n',{flag:'wx'});}
 cleanMain();const live=await serving();
 const initial=(await api(envBase)).envs, existing=validateFlag(initial);
 for(const name of ['CRON_SECRET','FIREBASE_ADMIN_CREDENTIALS','BLOB_READ_WRITE_TOKEN'])assert(initial.some(e=>e.key===name&&e.target?.includes('production')),`Missing ${name} reference`);
 const oldValue=existing?(await api(`${envBase}/${existing.id}`)).value:null;
 assert(oldValue===null || ['0','1'].includes(oldValue),'Unexpected existing flag value');
 const deployments=await api(`/v6/deployments?projectId=${project.projectId}&target=production&limit=20`);
 assert(!deployments.deployments.some(d=>['QUEUED','INITIALIZING','BUILDING'].includes(d.readyState??d.state)),'An active production build already exists');
 const readiness=value==='1'?await producerReadiness():null;
 const repoId=Number(sh('gh',['api','repos/shawn14/nfl-betting-system','--jq','.id']));assert(Number.isSafeInteger(repoId)&&repoId>0);
 await save('preflight',{liveDeployment:live.id,previousValue:oldValue,readiness});
 if(!apply)process.exit(0);
 assert(oldValue!==value,'Flag already has requested value; inspect prior deployment/receipt instead of repeating');
 assert(value==='0'||readiness.ready,'Prospective producer attribution/freshness is not ready');
 cleanMain();await serving();
 await save('env-write-pending');
 const body={key:flag,value,type:'plain',target:['production'],comment:'Approved prospective paper measurement; no bets or extra paid odds calls.'};
 const changed=existing?await api(`/v9/projects/${project.projectId}/env/${existing.id}`,'PATCH',body):await api(envBase,'POST',body);
 assert(!changed.failed?.length,'Environment write reported failure');
 const after=(await api(envBase)).envs, stored=validateFlag(after);assert(stored);
 assert.equal((await api(`${envBase}/${stored.id}`)).value,value);
 const metadata=envs=>envs.filter(e=>e.key!==flag).map(e=>[e.id,e.key,e.updatedAt,e.target,e.gitBranch]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
 assert.deepEqual(metadata(after),metadata(initial),'Unrelated environment changed');
 await save('env-verified');cleanMain();
 await save('deployment-request-pending');
 const created=await api('/v13/deployments?forceNew=1','POST',{name:project.projectName,project:project.projectId,target:'production',gitSource:{type:'github',repoId,ref:'main',sha}});
 assert(created.id,'Deployment response missing id');
 await save('deployment-created',{deploymentId:created.id,readyState:created.readyState??created.status});
 const deadline=Date.now()+25*60e3;let previous='';
 while(Date.now()<deadline){
  const d=await api(`/v13/deployments/${created.id}`);
  assert.equal(d.projectId,project.projectId);assert.equal(d.meta?.githubCommitSha,sha,'New deployment source mismatch');
  if(d.readyState!==previous){await save('deployment-progress',{readyState:d.readyState});previous=d.readyState;}
  assert(!['ERROR','CANCELED'].includes(d.readyState),`Deployment ${d.readyState}`);
  if(d.readyState==='READY'){
   assert.equal((await serving()).id,created.id,'READY build is not the domain owner');cleanMain();
   const r=await fetch(`https://${host}/api/measurement?activation=${created.id}`,{cache:'no-store',signal:AbortSignal.timeout(20000)});assert(r.ok,`Measurement HTTP ${r.status}`);
   const result=await r.json();assert.equal(result.state,value==='1'?'available':'disabled');
   await save('serving-verified',{measurementState:result.state,health:result.report?.health??null,captures:result.report?.captures??null});process.exit(0);
  }
  await new Promise(resolve=>setTimeout(resolve,30000));
 }
 throw new Error('Deployment wait exceeded 25 minutes; inspect existing deployment');
}catch(error){
 // Receipt records whether a write may already have happened. No automatic retry or rollback.
 console.error(error instanceof Error?error.message:String(error));process.exitCode=1;
}
