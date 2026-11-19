import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rename,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceProvisioning} from '../../src/core/workspaces/provision.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';

const leaseModule='../../src/core/workspaces/leases.js';
const refreshModule='../../src/core/workspaces/recovery.js';
test('one registered writer and exact exit proof are required, including after a lost owner',async t=>{
 const {createWorkspaceLeases}=await import(leaseModule);
 const f=await workspaceRuntimeFixture(t),prepared=await f.prepare();
 assert.equal((await f.submit(prepared.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspaceId=prepared.data.summary.workspaceId;
 const leases=createWorkspaceLeases({storage:f.storage,instanceId:f.instanceId,files:f.files,mutator:f.mutator,accepting:()=>true});
 const environment=leases.forConsumer('ENVIRONMENT'),other=leases.forConsumer('INTEGRATION');
 const holderId=randomUUID(),generation=randomUUID(),target={workspaceId,stateRevision:'2',holderId,generation};
 const held=await Promise.allSettled([environment.acquire(target),other.acquire({...target,holderId:randomUUID()})]);
 const fulfilled=held.filter(r=>r.status==='fulfilled');
 assert.equal(fulfilled.length,1);
 const lease=fulfilled[0]!.value,consumer=lease.holderType==='ENVIRONMENT'?environment:other;
 await assert.rejects(consumer.release(lease,{...lease,kind:'PID_ABSENT',pid:process.pid}),/RESOURCE_IDENTITY_UNKNOWN/);
 await assert.rejects(environment.acquire({...target,stateRevision:'3',holderId:randomUUID()}),/WORKSPACE_IN_USE/);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'IN_USE');
 await assert.rejects(consumer.release(lease,{...lease,kind:'EXIT',generation:randomUUID(),hostExited:true,descendantsExited:true}),/STALE_TARGET/);
 await consumer.release(lease,{...lease,kind:'EXIT',hostExited:true,descendantsExited:true});
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'READY');
});

test('refresh reports dated Git status, and a moved worktree blocks reuse without touching the files',async t=>{
 const {createWorkspaceRecovery}=await import(refreshModule);
 const f=await workspaceRuntimeFixture(t,createWorkspaceMutator(),options=>{
   const provision=createWorkspaceProvisioning(options),recovery=createWorkspaceRecovery(options);
   return{actions:{...provision.actions,...recovery.actions},async recover(){await provision.recover();await recovery.recover();}};
 });
 const prepared=await f.prepare();
 assert.equal((await f.submit(prepared.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspaceId=prepared.data.summary.workspaceId;
 const workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 const path=workspace.ownership!.root.canonicalPath;
 await writeFile(join(path,'fixture-new'),'keep this work');
 const refresh=async(expectedStateRevision:string,requestId=randomUUID())=>{
   const response=await f.send('workspace.refresh',{requestId,workspaceId,expectedStateRevision});
   await f.runtime.idle();
   return{response,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation,requestId};
 };
 const observed=await refresh(workspace.stateRevision);
 assert.equal(observed.operation?.outcome,'SUCCEEDED',JSON.stringify(observed.response));
 const detail=await f.send('workspace.get',{workspaceId});
 const current=(detail.data as {workspace:{observation:{untracked:boolean;checkedAt:string;ownership:string};stateRevision:string}}).workspace;
 assert.equal(current.observation.untracked,true);
 assert.equal(current.observation.ownership,'VERIFIED');
 assert.ok(Number.isFinite(Date.parse(current.observation.checkedAt)));
 assert.deepEqual((await refresh(workspace.stateRevision,observed.requestId)).operation,observed.operation);
 const moved=join(workspace.target.ownedRoot.canonicalPath,'moved-fixture');
 await rename(path,moved);
 const blocked=await refresh(current.stateRevision);
 assert.equal(blocked.operation?.outcome,'BLOCKED');
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'BLOCKED');
 assert.equal(await readFile(join(moved,'fixture-new'),'utf8'),'keep this work');
});
