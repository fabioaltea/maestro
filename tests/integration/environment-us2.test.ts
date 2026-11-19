import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startSuccessor,workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceLeases} from '../../src/core/workspaces/leases.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
import {createEnvironmentJobHost} from '../../src/platform/macos/environment/job-host.js';
import {createEnvironmentInstallation} from '../../src/core/environments/prepare.js';

import {fixturePackage,fixtureRegistry} from '../fixtures/environment-boundary.js';
import {fixtureLock} from '../fixtures/environment-registry.js';
import {environmentRuntimeFixture as fixture} from '../fixtures/environment-runtime.js';

test('two real installs are independently writable and changed input blocks an old grant',async t=>{
 const f=await fixture(t),one=await f.plan(),first=await f.send('environment.prepare',{grantId:one.grantId,requestId:randomUUID()});
 assert.equal(first.result,'OK',JSON.stringify(first));await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:one.workspaceId}).environment?.state,'READY');
 const other=await fixtureRegistry(t),otherLock=fixtureLock(other);
 const two=await f.plan(undefined,otherLock);
 assert.notEqual(two.prepared.inputDigest,one.prepared.inputDigest);
 const second=await f.send('environment.prepare',{grantId:two.grantId,requestId:randomUUID()});
 assert.equal(second.result,'OK',JSON.stringify(second));await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:two.workspaceId}).environment?.state,'READY');
 const dependency=(path:string)=>join(path,'node_modules',fixturePackage,'value.txt');
 await writeFile(dependency(one.path),'edited in first');
 assert.equal(await readFile(dependency(two.path),'utf8'),'clean fixture\n');
 assert.equal(await readFile(join(two.path,'pnpm-lock.yaml'),'utf8'),otherLock);
 const stale=await f.plan();await writeFile(join(stale.path,'pnpm-lock.yaml'),'changed');
 const rejected=await f.send('environment.prepare',{grantId:stale.grantId,requestId:randomUUID()});
 if(rejected.result==='OK')await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:stale.workspaceId}).environment?.state,'STALE');
});
test('cancel a real install on loopback and release the workspace only after owned exit',async t=>{
 const f=await fixture(t,true),plan=await f.plan(),requestId=randomUUID();
 const sent=await f.send('environment.prepare',{grantId:plan.grantId,requestId});
 assert.equal(sent.result,'OK',JSON.stringify(sent));
 await Promise.race([f.g0.registry.requested,f.runtime.idle().then(()=>assert.fail('install finished before registry became active'))]);
 const job=f.store.readEnvironmentState({kind:'job',id:requestId}).job!,requests=f.g0.registry.requests();
 const retries=await Promise.all(Array.from({length:10},()=>f.send('environment.prepare',{grantId:plan.grantId,requestId})));
 assert.ok(retries.every(reply=>(reply.data as {operation?:{requestId:string}}).operation?.requestId===requestId));
 assert.equal(f.g0.registry.requests(),requests);
 const grant=await f.send('environment.prepare',{action:'cancel',intent:{jobId:job.jobId},expectedRevisions:{stateRevision:job.stateRevision}});
 assert.equal(grant.result,'OK',JSON.stringify(grant));
 const cancelled=await f.send('environment.cancel',{grantId:(grant.data as {grantId:string}).grantId,requestId:randomUUID()});
 assert.equal(cancelled.result,'OK',JSON.stringify(cancelled));
 await f.runtime.idle();
 const terminal=f.store.readEnvironmentState({kind:'job',id:job.jobId}).job!;
 assert.equal(terminal.phase,'CANCELLED');assert.equal(terminal.exitProof?.verified,true);
 assert.equal(f.store.readWorkspaceState({kind:'active-lease',id:plan.workspaceId}).lease,null);
});

test('a successor resolves the original install from sealed exit evidence without launching pnpm again',async t=>{
 const f=await fixture(t,false,host=>({...host,async install(...args){assert.ok(await host.install(...args));return null;}})),plan=await f.plan(),requestId=randomUUID();
 const result=await f.send('environment.prepare',{grantId:plan.grantId,requestId});
 assert.equal(result.result,'OK',JSON.stringify(result));
 await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'job',id:requestId}).job?.phase,'RECONCILING');
 assert.ok(f.store.readWorkspaceState({kind:'active-lease',id:plan.workspaceId}).lease);
 const requests=f.g0.registry.requests(),instanceId=startSuccessor(f);
 const workspaceLeases=createWorkspaceLeases({storage:f.storage,instanceId,files:f.files,mutator:f.mutator,accepting:()=>false});
 await workspaceLeases.recover();
 const recovery=createEnvironmentInstallation({storage:f.storage,paths:f.paths,instanceId,owned:workspaceLeases.owned,
   inspector:createEnvironmentInspector(),lease:workspaceLeases.forConsumer('ENVIRONMENT'),host:createEnvironmentJobHost(f.paths),
   accepting:()=>false,schedule:()=>assert.fail('recovery must not launch a job')});
 await recovery.recover();
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation?.outcome,'SUCCEEDED');
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:plan.workspaceId}).environment?.state,'READY');
 assert.equal(f.store.readWorkspaceState({kind:'active-lease',id:plan.workspaceId}).lease,null);
 assert.equal(f.g0.registry.requests(),requests);
});
