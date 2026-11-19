import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {startSuccessor,workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {environmentBoundaryFixture,fixturePackage} from '../fixtures/environment-boundary.js';
import {createEnvironmentRuntime} from '../../src/core/environments/runtime.js';
import {createEnvironmentPlanning} from '../../src/core/environments/plan.js';
import {createWorkspaceLeases,verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
import {createEnvironmentJobHost} from '../../src/platform/macos/environment/job-host.js';
import {createEnvironmentInstallation} from '../../src/core/environments/prepare.js';

async function fixture(t:Parameters<typeof workspaceRuntimeFixture>[0],hold=false,loseExit=false){
 const g0=await environmentBoundaryFixture(t,hold),seed=await g0.workspace('seed');
 const f=await workspaceRuntimeFixture(t),owned=(workspace:Parameters<typeof verifyOwnedWorktree>[2])=>verifyOwnedWorktree(f,f.storeId,workspace);
 const leases=createWorkspaceLeases({storage:f.storage,instanceId:f.instanceId,files:f.files,mutator:f.mutator,accepting:()=>true}).forConsumer('ENVIRONMENT');
 const runtime=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:context=>{
   const options={...context,storage:f.storage,instanceId:f.instanceId,paths:f.paths,inspector:createEnvironmentInspector(),owned};
   const host=createEnvironmentJobHost(f.paths);
   const planning=createEnvironmentPlanning(options),installation=createEnvironmentInstallation({...options,lease:leases,
     host:loseExit?{...host,async install(...args){assert.ok(await host.install(...args));return null;}}:host});
   const authorize=planning.actions['environment.prepare'];
   return{...installation,actions:{...planning.actions,...installation.actions,
     'environment.prepare':(p,peer)=>p.action==='attest'?authorize(p,peer):installation.actions['environment.prepare'](p,peer)}};
 }});
 await runtime.recover();
 const send=(method:string,params:Record<string,unknown>)=>runtime.dispatch({method,params,correlationId:randomUUID(),protocolVersion:1},f.peer,f.store.readSnapshot()!);
 async function plan(){
   const ready=await f.prepare();assert.equal((await f.submit(ready.data.grantId)).operation?.outcome,'SUCCEEDED');
   const workspaceId=ready.data.summary.workspaceId,workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
   const path=workspace.ownership!.root.canonicalPath;
   const manifest=JSON.parse(await readFile(seed.manifestPath,'utf8'));delete manifest.scripts;
   await writeFile(join(path,'package.json'),JSON.stringify(manifest));await writeFile(join(path,'pnpm-lock.yaml'),await readFile(seed.lockPath));
   const started=await send('environment.plan',{requestId:randomUUID(),workspaceId,expectedStateRevision:workspace.stateRevision});
   assert.equal(started.result,'OK',JSON.stringify(started));await runtime.idle();
   const environment=f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment!;
   assert.equal(environment.state,'PLANNED');
   const prepared=f.store.readEnvironmentState({kind:'plan',id:environment.currentPlanId!}).plan!;
   const approval=await send('environment.prepare',{action:'prepare',intent:{planId:prepared.planId,planDigest:prepared.digest},
     expectedRevisions:{stateRevision:environment.stateRevision}});
   assert.equal(approval.result,'OK',JSON.stringify(approval));
   return{workspaceId,path,prepared,grantId:(approval.data as {grantId:string}).grantId};
 }
 return{...f,g0,runtime,send,plan};
}
test('two real installs are independently writable and changed input blocks an old grant',async t=>{
 const f=await fixture(t),one=await f.plan(),first=await f.send('environment.prepare',{grantId:one.grantId,requestId:randomUUID()});
 assert.equal(first.result,'OK',JSON.stringify(first));await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:one.workspaceId}).environment?.state,'READY');
 const two=await f.plan(),second=await f.send('environment.prepare',{grantId:two.grantId,requestId:randomUUID()});
 assert.equal(second.result,'OK',JSON.stringify(second));await f.runtime.idle();
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:two.workspaceId}).environment?.state,'READY');
 const dependency=(path:string)=>join(path,'node_modules',fixturePackage,'value.txt');
 await writeFile(dependency(one.path),'edited in first');
 assert.equal(await readFile(dependency(two.path),'utf8'),'clean fixture\n');
 const stale=await f.plan();await writeFile(join(stale.path,'pnpm-lock.yaml'),'changed');
 const rejected=await f.send('environment.prepare',{grantId:stale.grantId,requestId:randomUUID()});
 if(rejected.result==='OK')await f.runtime.idle();
 assert.notEqual(f.store.readEnvironmentState({kind:'workspace',id:stale.workspaceId}).environment?.state,'READY');
});
test('cancel a real install on loopback and release the workspace only after owned exit',async t=>{
 const f=await fixture(t,true),plan=await f.plan(),requestId=randomUUID();
 const sent=await f.send('environment.prepare',{grantId:plan.grantId,requestId});
 assert.equal(sent.result,'OK',JSON.stringify(sent));
 await Promise.race([f.g0.registry.requested,f.runtime.idle().then(()=>assert.fail('install finished before registry became active'))]);
 const job=f.store.readEnvironmentState({kind:'job',id:requestId}).job!;
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
 const f=await fixture(t,false,true),plan=await f.plan(),requestId=randomUUID();
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
