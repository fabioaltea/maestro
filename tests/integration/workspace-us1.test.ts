import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';
import {createWorkspaceRuntime} from '../../src/core/workspaces/runtime.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';
import type {StoragePort} from '../../src/ports/storage.js';

const provisionModule='../../src/core/workspaces/provision.js';
const filesModule='../../src/platform/macos/git/workspace-files.js';

export async function workspaceRuntimeFixture(t:Parameters<typeof workspaceAuthoringFixture>[0]){
 const f=await workspaceAuthoringFixture(t);
 const {createOwnedWorkspaceFiles}=await import(filesModule);
 const {createWorkspaceProvisioning}=await import(provisionModule);
 const storage=f.store as unknown as StoragePort;
 const files=createOwnedWorkspaceFiles(f.root);
 const runtime=createWorkspaceRuntime(storage,context=>createWorkspaceProvisioning({...context,storage,paths:f.paths,instanceId:f.instanceId,
   mutator:createWorkspaceMutator(),files,currentEligibility:(peer:typeof f.peer,id:string)=>f.service.currentEligibility(peer,id)}));
 await runtime.recover();
 function send(method:string,params:Record<string,unknown>){
   return runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params},f.peer,f.store.readSnapshot()!);
 }
 async function prepare(){
   const feature=await f.approvedFeature();
   const response=await send('workspace.prepare',{featureId:feature.featureId,envelopeId:feature.envelope.envelopeId});
   assert.equal(response.result,'OK',JSON.stringify(response));
   return{feature,data:response.data as {grantId:string;summary:{workspaceId:string;baseOid:string;branchRef:string}}};
 }
 async function submit(grantId:string,requestId=randomUUID()){
   const r=await send('workspace.create',{grantId,requestId});
   await runtime.idle();
   return{r,requestId,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation};
 }
 return{...f,files,runtime,send,prepare,submit};
}

test('two feature workspaces branch from the current approved base, with reply loss safe and checkout preserved',async t=>{
 const f=await workspaceRuntimeFixture(t);
 const initial=await readFile(join(f.repo,'tracked.txt'),'utf8');
 await writeFile(join(f.repo,'untracked.txt'),'my local file');
 const first=await f.prepare(),wrong=await f.send('workspace.remove',{grantId:first.data.grantId,requestId:randomUUID(),expectedStateRevision:'1'});
 assert.notEqual(wrong.result,'OK');
 const one=await f.submit(first.data.grantId);
 assert.equal(one.operation?.outcome,'SUCCEEDED',JSON.stringify(one.r));
 const revision=f.store.readSnapshot()!.store.revision;
 assert.deepEqual((await f.submit(first.data.grantId,one.requestId)).operation,one.operation);
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
 const second=await f.prepare(),two=await f.submit(second.data.grantId);
 assert.equal(two.operation?.outcome,'SUCCEEDED',JSON.stringify(two.r));
 for(const receipt of [first,second]){
   const workspace=f.store.readWorkspaceState({kind:'get',id:receipt.data.summary.workspaceId}).workspace!;
   assert.equal(workspace.state,'READY');assert.equal(workspace.ownership?.headOid,f.baseOid);assert.ok(workspace.markerDigest);
   assert.equal((await f.repositories.git(f.repo,['rev-parse',receipt.data.summary.branchRef])).trim(),f.baseOid);
 }
 assert.equal(await readFile(join(f.repo,'tracked.txt'),'utf8'),initial);
 assert.equal(await readFile(join(f.repo,'untracked.txt'),'utf8'),'my local file');
});

test('moving the configured base after prepare leaves both generated ref and path absent',async t=>{
 const f=await workspaceRuntimeFixture(t),approved=await f.prepare();
 await f.repositories.git(f.repo,['commit','--allow-empty','-m','base moved']);
 const result=await f.submit(approved.data.grantId);
 assert.notEqual(result.operation?.outcome,'SUCCEEDED');
 assert.equal(await f.repositories.git(f.repo,['show-ref','--exists',approved.data.summary.branchRef],2),'');
 assert.equal((await f.send('workspace.get',{workspaceId:approved.data.summary.workspaceId})).result,'OK');
});
