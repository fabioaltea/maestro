import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rename,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {createWorkspaceProvisioning} from '../../src/core/workspaces/provision.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';
import {createWorkspaceLeases} from '../../src/core/workspaces/leases.js';
import {createWorkspaceRecovery} from '../../src/core/workspaces/recovery.js';
import type {WorkspaceReleaseProof} from '../../src/ports/workspace.js';

test('one registered writer and exact exit proof are required, including after a lost owner',async t=>{
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
 await assert.rejects(consumer.release(lease,{...lease,kind:'PID_ABSENT',pid:process.pid} as unknown as WorkspaceReleaseProof),/RESOURCE_IDENTITY_UNKNOWN/);
 await assert.rejects(environment.acquire({...target,stateRevision:'3',holderId:randomUUID()}),/WORKSPACE_IN_USE/);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'IN_USE');
 await assert.rejects(consumer.release(lease,{...lease,kind:'EXIT',generation:randomUUID(),hostExited:true,descendantsExited:true}),/STALE_TARGET/);
 const instanceId=randomUUID(),ticketId=randomUUID(),startId=randomUUID(),at=new Date().toISOString();
 f.store.reconcileInstanceAbsent(f.instanceId,'1');
 f.store.acceptOperation({requestId:startId,action:'start',payloadHash:'a'.repeat(64),ownerUid:f.paths.ownerUid,targetInstanceId:null,acceptedAt:at});
 f.store.issueTicket({requestId:startId,ticketId,instanceId,generation:'2'});
 f.store.claimTicket(ticketId,'2',process.pid);
 f.store.recordInstance({instanceId,generation:'2',pid:process.pid,lifecycle:'RECOVERING',startedAt:at,shutdownPrepared:false,lastError:null});
 const recovered=createWorkspaceLeases({storage:f.storage,instanceId,files:f.files,mutator:f.mutator,accepting:()=>true});
 await recovered.recover();
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'RECONCILING');
 assert.deepEqual(f.store.readWorkspaceState({kind:'active-lease',id:workspaceId}).lease,lease);
 f.store.transitionInstance(instanceId,'RUNNING');
 const successor=recovered.forConsumer(lease.holderType);
 await assert.rejects(successor.acquire({...target,stateRevision:'4',holderId:randomUUID()}),/WORKSPACE_IN_USE/);
 await assert.rejects(consumer.release(lease,{...lease,kind:'EXIT',hostExited:true,descendantsExited:true}),/STALE_TARGET/);
 await successor.release(lease,{...lease,kind:'EXIT',hostExited:true,descendantsExited:true});
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'READY');
});

test('refresh reports dated Git status, and a moved worktree blocks reuse without touching the files',async t=>{
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
 assert.equal(observed.operation?.outcome,'SUCCEEDED',JSON.stringify(observed.operation));
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

test('refresh reconciles a fully recorded worktree after a lost READY commit without repeating Git',async t=>{
 const native=createWorkspaceMutator();
 let added=0,failReady=true;
 const f=await workspaceRuntimeFixture(t,{...native,async addWorktree(target,deadline){added++;return native.addWorktree(target,deadline);}},
   options=>{
     const provision=createWorkspaceProvisioning(options),recovery=createWorkspaceRecovery(options);
     return{actions:{...provision.actions,...recovery.actions},async recover(){await provision.recover();await recovery.recover();}};
   },
   change=>{if(change.kind==='provision-ready'&&failReady){failReady=false;throw new Error('PERSISTENCE_UNAVAILABLE');}});
 const prepared=await f.prepare(),first=await f.submit(prepared.data.grantId);
 assert.equal(first.operation?.outcome,'UNKNOWN');
 const workspaceId=prepared.data.summary.workspaceId,prior=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 assert.equal(prior.state,'RECONCILING');assert.ok(prior.markerDigest);
 const refreshId=randomUUID(),result=await f.send('workspace.refresh',{requestId:refreshId,workspaceId,expectedStateRevision:prior.stateRevision});
 assert.equal(result.result,'OK',JSON.stringify(result));
 await f.runtime.idle();
 const original=f.store.readFeatureState({kind:'operation',id:first.requestId}).operation;
 assert.equal(original?.outcome,'SUCCEEDED',JSON.stringify(f.store.readFeatureState({kind:'operation',id:refreshId}).operation));
 assert.equal(f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace?.state,'READY');
 assert.equal(added,1);
});
