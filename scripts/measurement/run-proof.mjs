#!/usr/bin/env node
// Local operator wrapper. Pull one existing encrypted env var into memory; never log its value.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const primary=process.env.PM_PRIMARY_REPO??path.join(os.homedir(),'projects/nfl-betting-system');
const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
const base=`https://api.vercel.com/v10/projects/${project.projectId}`;
async function read(url){const r=await fetch(url,{headers:{Authorization:`Bearer ${auth.token}`}});if(!r.ok)throw new Error(`Vercel read ${r.status}`);return r.json();}
const envs=await read(`${base}/env?teamId=${project.orgId}`);
const env=envs.envs.find(x=>x.key==='FIREBASE_ADMIN_CREDENTIALS' && x.target?.includes('production'));
if(!env)throw new Error('Verified project has no production Firebase credential');
const secret=await read(`${base}/env/${env.id}?teamId=${project.orgId}`);
if(!secret.value || secret.type==='sensitive')throw new Error('Existing credential unavailable for local proof');
const child=spawnSync(process.execPath,['--no-warnings',new URL(process.argv.includes('--provenance')?'./prove-provenance-live.mjs':'./prove-live.mjs',import.meta.url).pathname],{
  stdio:'inherit',env:{...process.env,FIREBASE_ADMIN_CREDENTIALS:secret.value}});
process.exitCode=child.status??1;
