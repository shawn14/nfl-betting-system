#!/usr/bin/env node
// Run only the local Next app. Collection is disabled; no paid cron is invoked.
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
const primary=path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
async function read(url){const r=await fetch(url,{headers:{Authorization:`Bearer ${auth.token}`}});if(!r.ok)throw new Error(`Vercel ${r.status}`);return r.json();}
const base=`https://api.vercel.com/v10/projects/${project.projectId}/env`;
const all=await read(`${base}?teamId=${project.orgId}`);
const env={...process.env,FEATURE_MEASUREMENT_ENABLED:'0',NEXT_TELEMETRY_DISABLED:'1'};
for(const row of all.envs.filter(x=>x.target?.includes('production')&&(x.key.startsWith('NEXT_PUBLIC_FIREBASE_')||x.key==='BLOB_READ_WRITE_TOKEN'))){
 const value=await read(`${base}/${row.id}?teamId=${project.orgId}`);env[row.key]=value.value;
}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3307'],{stdio:'inherit',env});
process.on('SIGTERM',()=>child.kill('SIGTERM'));process.on('SIGINT',()=>child.kill('SIGINT'));
child.on('exit',code=>{process.exitCode=code??1;});
