#!/usr/bin/env node
// Read-only production evidence + Firestore server metadata, without installing a local SDK.
// Credentials remain in memory. Reads only the measurement collections and public report.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createHash,sign} from 'node:crypto';import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {validCapture} from '../../src/lib/measurement/core.ts';
import {publishedProducer} from '../../src/lib/forecast-provenance.ts';
import {MODEL_VERSION} from '../../src/lib/model-version.ts';
const args=process.argv.slice(2),option=name=>args[args.indexOf(name)+1];
assert(args.includes('--sha')&&/^[a-f0-9]{40}$/.test(option('--sha')),'--sha required');
assert(args.includes('--out')&&option('--out'),'--out required');
const sha=option('--sha'),out=path.resolve(option('--out'));
const requireEnabled=args.includes('--require-enabled');
const firstCommissioning=args.includes('--first-commissioning');
const primary=process.env.PM_PRIMARY_REPO??path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
async function get(url,token,allowMissing=false){const r=await fetch(url,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store',signal:AbortSignal.timeout(20000)});if(allowMissing&&r.status===404)return null;assert(r.ok,`Read HTTP ${r.status}: ${new URL(url).hostname}`);return r.json();}
const vercel=route=>get(`https://api.vercel.com${route}?teamId=${project.orgId}`,auth.token);
const alias=await vercel('/v4/aliases/www.predictionmatrix.com');
const live=await vercel(`/v13/deployments/${alias.deploymentId??alias.deployment?.id}`);
assert.equal(live.projectId,project.projectId);assert.equal(live.readyState,'READY');assert.equal(live.meta?.githubCommitSha,sha);
assert.equal(execFileSync('git',['ls-remote','origin','refs/heads/main'],{cwd:primary,encoding:'utf8'}).trim().split(/\s+/)[0],sha);
const envBase=`/v10/projects/${project.projectId}/env`,envs=(await vercel(envBase)).envs;
const matches=envs.filter(e=>e.key==='FIREBASE_ADMIN_CREDENTIALS'&&e.target?.includes('production'));assert.equal(matches.length,1);
const secret=await vercel(`${envBase}/${matches[0].id}`);assert(typeof secret.value==='string'&&secret.value);
const raw=secret.value.trim(),sa=JSON.parse(raw.startsWith('{')?raw:Buffer.from(raw,'base64').toString('utf8'));
assert(sa.project_id&&sa.private_key&&sa.client_email);
// Google's documented service-account JWT exchange; never print assertions or tokens.
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
const unsigned=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:sa.client_email,scope:'https://www.googleapis.com/auth/datastore',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+300})}`;
const assertion=`${unsigned}.${sign('RSA-SHA256',Buffer.from(unsigned),sa.private_key).toString('base64url')}`;
const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(20000)});
assert(tokenResponse.ok,`Google authentication HTTP ${tokenResponse.status}`);const token=(await tokenResponse.json()).access_token;assert(token);
function decode(v){
 if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;
 if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);
 if('timestampValue'in v)return v.timestampValue;if('arrayValue'in v)return (v.arrayValue.values??[]).map(decode);
 if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields??{}).map(([k,x])=>[k,decode(x)]));
 throw new Error('Unsupported Firestore value; do not silently discard evidence');
}
const body=d=>Object.fromEntries(Object.entries(d.fields??{}).map(([k,v])=>[k,decode(v)]));
const canonical=x=>x&&typeof x==='object'?(Array.isArray(x)?x.map(canonical):Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]))):x;
const hash=x=>createHash('sha256').update(JSON.stringify(canonical(x))).digest('hex');
const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/databases/(default)/documents`;
const documents=[];let cursor='';
do{
 const page=await get(`${base}/predictionMeasurementsV1?pageSize=1000${cursor?'&pageToken='+encodeURIComponent(cursor):''}`,token);
 documents.push(...(page.documents??[]));assert(documents.length<=18000,'Pilot ceiling exceeded');cursor=page.nextPageToken??'';
}while(cursor);
const healthDoc=await get(`${base}/predictionMeasurementsV1Health/latest`,token,true);
const records=documents.map(d=>({id:d.name.split('/').at(-1),createTime:d.createTime,updateTime:d.updateTime,bodyHash:hash(body(d)),record:body(d)})).sort((a,b)=>a.id.localeCompare(b.id));
const models=records.filter(d=>d.record.kind==='model');
for(const d of models){
 const c={...d.record,id:d.id,committedAt:new Date(d.createTime).toISOString()};
 assert(validCapture(c),`Invalid stored capture ${d.id}`);assert.equal(d.createTime,d.updateTime,`Evidence changed after creation ${d.id}`);
 const producer=publishedProducer(c.entry);assert(producer?.sourceSha,`Unattributed capture ${d.id}`);
  assert.equal(c.modelSourceSha,producer.sourceSha);assert.equal(c.modelVersion,producer.modelVersion);
  if(firstCommissioning){assert.equal(c.modelSourceSha,sha);assert.equal(c.collectorSha,sha);assert.equal(c.modelVersion,MODEL_VERSION);}
}
let comparison=null;
if(args.includes('--compare')){
 const prior=JSON.parse(await fs.readFile(option('--compare'),'utf8')),current=new Map(records.map(r=>[r.id,r]));
 assert.equal(prior.sha,sha,'Different serving source from baseline');
 for(const old of prior.records){const next=current.get(old.id);assert(next,`Missing evidence ${old.id}`);for(const key of ['createTime','updateTime','bodyHash'])assert.equal(next[key],old[key],`Changed ${old.id} ${key}`);}
 assert(healthDoc&&Date.parse(body(healthDoc).updated)>Date.parse(prior.health?.updated),'No later collector run than baseline');
 assert(Date.parse(healthDoc.updateTime)>Date.parse(prior.healthUpdateTime),'No later server heartbeat update');
 comparison={unchangedRecords:prior.records.length,added:records.length-prior.records.length,priorCheckedAt:prior.checkedAt};
}
const publicReport=await get(`https://www.predictionmatrix.com/api/measurement?proof=${Date.now()}`);
if(requireEnabled||comparison){
 assert(healthDoc,'No collector heartbeat');const health=body(healthDoc),age=Date.now()-Date.parse(health.updated);
 assert.equal(health.ok,true,'Collector did not succeed');assert.equal(health.dryRun,false,'Heartbeat is not a real persisted run');
 assert(Number.isFinite(age)&&age>=0&&age<45*60e3,'Collector heartbeat is stale or future dated');
}
if(requireEnabled){
 assert(models.some(d=>d.record.sport==='nfl'),'No actual NFL captures');assert.equal(publicReport.state,'available');
  const publicModels=new Map(publicReport.report.evidence.captures.map(c=>[c.id,c]));
 for(const d of models){const c=publicModels.get(d.id);assert(c,`Public report missing ${d.id}`);const {committedAt,...record}=c;assert.equal(hash(record),d.bodyHash,`Public record differs ${d.id}`);assert.equal(committedAt,new Date(d.createTime).toISOString());}
 const evidence=publicReport.report.evidence;
 const publicRecords=[...evidence.captures,...evidence.settlements,...evidence.shopCaptures,...evidence.closes,...(evidence.registrations??[])];
 const publicById=new Map(publicRecords.map(r=>[r.id,r]));
 assert.equal(publicById.size,publicRecords.length,'Duplicate public evidence id');assert.equal(publicById.size,records.length,'Public/storage record count mismatch');
 for(const d of records){const c=publicById.get(d.id);assert(c,`Public evidence missing ${d.id}`);const {committedAt,...record}=c;
  assert.equal(hash(record),d.bodyHash,`Public evidence differs ${d.id}`);assert.equal(committedAt,new Date(d.createTime).toISOString());
  assert.equal(d.createTime,d.updateTime,`Evidence changed ${d.id}`);}
 assert.equal(hash(publicReport.report.health),hash(body(healthDoc)),'Public/storage health differs');
}
const result={checkedAt:new Date().toISOString(),sha,deployment:live.id,scope:'Read-only actual production Firestore evidence/server times and public report; no crons, writes, paid requests or bets',
 requireEnabled,firstCommissioning,
 health:healthDoc?body(healthDoc):null,healthCreateTime:healthDoc?.createTime??null,healthUpdateTime:healthDoc?.updateTime??null,
 counts:Object.fromEntries([...new Set(records.map(d=>d.record.kind))].sort().map(k=>[k,records.filter(d=>d.record.kind===k).length])),comparison,records,publicReport};
await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...result,records:undefined,publicReport:undefined,publicState:publicReport.state,publicCaptures:publicReport.report?.captures??null},null,2));
