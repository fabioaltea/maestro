import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {EnvironmentManagerPin} from '../../src/ports/environment.js';

import {analyzeEnvironmentPlan,requireCurrentEnvironmentPlan} from '../../src/domain/environments/plan.js';
const pin:EnvironmentManagerPin={manager:'pnpm',version:'9.4.0',nodeVersion:'26.13.0',entryDigest:'a'.repeat(64),
 distributionDigest:'b'.repeat(64),nodeDigest:'c'.repeat(64),profileDigest:'d'.repeat(64),descendants:'DENIED',importMethod:'clone-or-copy'};

test('static environment policy recognizes the exact lock/version and rejects unsafe alternatives',()=>{
 const config=(extra:Record<string,unknown>={})=>JSON.stringify({name:'fixture',packageManager:'pnpm@9.4.0',dependencies:{example:'1.0.0'},...extra});
 const lock={path:'pnpm-lock.yaml',text:"lockfileVersion: '9.0'\n"};
 const input=[{path:'package.json',text:config()},lock];
 assert.equal(analyzeEnvironmentPlan(input,pin).disposition,'PLANNED');
 assert.equal(analyzeEnvironmentPlan([{path:'package.json',text:config({dependencies:{}})},lock],pin).disposition,'MANUAL_REQUIRED');
 assert.equal(analyzeEnvironmentPlan([...input,{path:'package-lock.json',text:'{}'}],pin).disposition,'MANUAL_REQUIRED');
 assert.equal(analyzeEnvironmentPlan([{path:'package.json',text:config({packageManager:'pnpm@10.1.0'})},lock],pin).reason,'MANAGER_MISMATCH');
 for(const file of [{path:'.pnpmfile.cjs',text:'do not execute'},{path:'.npmrc',text:null},{path:'pnpm-workspace.yaml',text:'packages: []'}]){
   assert.equal(analyzeEnvironmentPlan([...input,file],pin).reason,'CONFIG_UNSAFE');
 }
 assert.equal(analyzeEnvironmentPlan([{path:'package.json',text:config({dependencies:{example:'git+https://example.invalid/repo'}})},lock],pin).reason,'CONFIG_UNSAFE');
 assert.equal(analyzeEnvironmentPlan([{path:'package.json',text:config({scripts:{postinstall:'node unsafe.cjs'}})},lock],pin).reason,'SCRIPT_APPROVAL_REQUIRED');
});

test('manual attestation binds the exact observed digest and environment revision',()=>{
 const scope={planId:randomUUID(),workspaceGeneration:randomUUID(),inputDigest:'a'.repeat(64),stateRevision:'1'};
 requireCurrentEnvironmentPlan(scope,scope);
 assert.throws(()=>requireCurrentEnvironmentPlan(scope,{...scope,inputDigest:'b'.repeat(64)}),/ENVIRONMENT_STALE/);
 assert.throws(()=>requireCurrentEnvironmentPlan(scope,{...scope,workspaceGeneration:randomUUID()}),/STALE_TARGET/);
 assert.throws(()=>requireCurrentEnvironmentPlan(scope,{...scope,stateRevision:'2'}),/REVISION_CONFLICT/);
});
