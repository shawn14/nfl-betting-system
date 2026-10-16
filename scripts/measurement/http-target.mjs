// Read-only guard: local process, exact review preview, or explicitly pinned production SHA.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export async function previewDeployment() {
 const primary=path.join(os.homedir(),'projects/nfl-betting-system');
 const project=JSON.parse(await fs.readFile(path.join(primary,'.vercel/project.json'),'utf8'));
 const auth=JSON.parse(await fs.readFile(path.join(os.homedir(),'Library/Application Support/com.vercel.cli/auth.json'),'utf8'));
 const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 const branch=execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim();
 assert.equal(branch,'codex/prediction-terminal');
 const r=await fetch(`https://api.vercel.com/v6/deployments?projectId=${project.projectId}&teamId=${project.orgId}&limit=10`,{headers:{Authorization:`Bearer ${auth.token}`},signal:AbortSignal.timeout(20000)});
 assert(r.ok,`Vercel read HTTP ${r.status}`);
 const rows=(await r.json()).deployments.filter(d=>d.meta?.githubCommitSha===sha&&d.meta?.githubCommitRef===branch&&d.target!=='production');
 assert(rows.length,'No deployment for current review SHA');
 const d=rows[0];
 return {checkedAt:new Date().toISOString(),id:d.uid,url:`https://${d.url}`,state:d.readyState??d.state,target:d.target??'preview',sha,branch};
}
export async function verifiedHttpBase() {
 const base=process.env.PM_HTTP_BASE;
 if(base==='https://www.predictionmatrix.com'){
  const expected=process.env.PM_EXPECT_LIVE_SHA;
  assert(expected&&/^[a-f0-9]{40}$/.test(expected),'Production proof requires an explicit full source SHA');
  assert.equal(expected,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'Proof must run from the deployed source');
  const receipt=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./release-check.mjs',import.meta.url)),'--expect-live',expected],{encoding:'utf8',timeout:90000}));
  assert.equal(receipt.measurementState,'disabled','This proof covers disabled collection only');
  console.log(JSON.stringify({verifiedProduction:receipt}));
  return base;
 }
 if(base&&/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))return base;
 assert(base&&/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(base),'Explicit local or canonical preview URL required');
 const deployment=await previewDeployment();
 assert.equal(deployment.state,'READY');assert.equal(base,deployment.url,'Only current GitHub branch SHA preview');
 console.log(JSON.stringify({verifiedPreview:deployment}));
 return base;
}
