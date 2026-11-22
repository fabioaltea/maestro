import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createEnvironmentRuntime} from '../../src/core/environments/runtime.js';

import {createEnvironmentPlanning} from '../../src/core/environments/plan.js';
import {createEnvironmentInspector} from '../../src/platform/macos/environment/inspect.js';
async function fixture(t:Parameters<typeof workspaceRuntimeFixture>[0]){
 const f=await workspaceRuntimeFixture(t),created=await f.prepare(),workspaceId=created.data.summary.workspaceId;
 assert.equal((await f.submit(created.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!,path=workspace.ownership!.root.canonicalPath;
 const runtime=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:context=>createEnvironmentPlanning({
   ...context,storage:f.storage,instanceId:f.instanceId,paths:f.paths,inspector:createEnvironmentInspector(),
   owned:(record:typeof workspace)=>verifyOwnedWorktree(f,f.storeId,record),
 })});
 await runtime.recover();
 const send=(method:string,params:Record<string,unknown>)=>runtime.dispatch({method,params,correlationId:randomUUID(),protocolVersion:1},f.peer,f.store.readSnapshot()!);
 async function plan(requestId=randomUUID()){
   const response=await send('environment.plan',{requestId,workspaceId,expectedStateRevision:workspace.stateRevision});
   await runtime.idle();
   return{requestId,response,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation,
     state:f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment};
 }
 return{...f,path,workspaceId,runtime,send,plan};
}
test('plans pnpm from static inputs without changing the worktree and preserves original reply',async t=>{
 const f=await fixture(t),manifest=join(f.path,'package.json');
 await writeFile(manifest,JSON.stringify({name:'fixture',packageManager:'pnpm@9.4.0',dependencies:{'fixture-package':'1.0.0'}}));
 await writeFile(join(f.path,'pnpm-lock.yaml'),"lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      fixture-package:\n        specifier: 1.0.0\n        version: 1.0.0\n");
 const bytes=await readFile(manifest),names=(await readdir(f.path)).sort(),planned=await f.plan();
 assert.equal(planned.operation?.outcome,'SUCCEEDED',JSON.stringify(planned.response));
 assert.equal(planned.state?.state,'PLANNED');
 const firstRevision=f.store.readSnapshot()?.store.revision;
 assert.deepEqual((await f.plan(planned.requestId)).operation,planned.operation);
 assert.equal(f.store.readSnapshot()?.store.revision,firstRevision);
 assert.deepEqual(await readFile(manifest),bytes);
 assert.deepEqual((await readdir(f.path)).sort(),names);
});
test('ambiguous configuration is manual and stale attestation cannot be consumed',async t=>{
 const f=await fixture(t),manifest=join(f.path,'package.json');
 await writeFile(manifest,JSON.stringify({name:'fixture',packageManager:'npm@11.20.0'}));
 await writeFile(join(f.path,'package-lock.json'),'{"lockfileVersion":3}\n');
 const planned=await f.plan();
 assert.equal(planned.state?.state,'MANUAL_REQUIRED');
 const plan=f.store.readEnvironmentState({kind:'plan',id:planned.state!.currentPlanId!}).plan!;
 const approval={action:'attest',intent:{workspaceId:f.workspaceId,inputDigest:plan.inputDigest,limitations:['Installazione manuale verificata']},
   expectedRevisions:{stateRevision:planned.state!.stateRevision}};
 const prepared=await f.send('environment.prepare',approval);
 assert.equal(prepared.result,'OK',JSON.stringify(prepared));
 await writeFile(manifest,JSON.stringify({name:'changed',packageManager:'npm@11.20.0'}));
 const stale=await f.send('environment.attest',{requestId:randomUUID(),grantId:(prepared.data as {grantId:string}).grantId});
 assert.equal((stale.data as {code:string}).code,'ENVIRONMENT_STALE');
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:f.workspaceId}).environment?.state,'MANUAL_REQUIRED');
 const updated=await f.plan(),newPlan=f.store.readEnvironmentState({kind:'plan',id:updated.state!.currentPlanId!}).plan!;
 const current=await f.send('environment.prepare',{...approval,intent:{...approval.intent,inputDigest:newPlan.inputDigest},
   expectedRevisions:{stateRevision:updated.state!.stateRevision}});
 assert.equal(current.result,'OK',JSON.stringify(current));
 const manual={requestId:randomUUID(),grantId:(current.data as {grantId:string}).grantId};
 assert.equal((await f.send('environment.attest',manual)).result,'OK');
 const result=await f.send('environment.get',{workspaceId:f.workspaceId});
 assert.equal((result.data as {qualificationKind:string}).qualificationKind,'MANUAL');
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:f.workspaceId}).environment?.state,'MANUAL_VERIFIED');
 const revision=f.store.readSnapshot()?.store.revision;
 assert.equal((await f.send('environment.attest',manual)).result,'OK');
 assert.equal(f.store.readSnapshot()?.store.revision,revision);
});
