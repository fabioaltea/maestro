import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {LocalClient} from '../../src/client/local-client.js';
import {createClientBackend} from '../../src/bootstrap.js';
import {createWorkspaceRuntime} from '../../src/core/workspaces/runtime.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {AuthenticatedPeer} from '../../src/ports/platform.js';

test('workspace routes advertise only composed capabilities with historical reads after stop',async t=>{
 const f=await createCliHarness(t),started=await f.call('start');
 assert.equal(started.code,0,started.stdout);
 const status=JSON.parse((await f.call('status')).stdout) as {data:{capabilities:{workspaceVersion:number;workspaceMethods:string[]}}};
 assert.equal(status.data.capabilities.workspaceVersion,1);
 assert.ok(status.data.capabilities.workspaceMethods.includes('workspace.list'));
 assert.ok(!status.data.capabilities.workspaceMethods.includes('workspace.lease.acquire'));
 const client=new LocalClient(createClientBackend()),projectId=randomUUID();
 const live=await client.runWorkspace('workspace.list',{projectId},{stateDirectory:f.archive});
 assert.equal(live.freshness,'LIVE');assert.deepEqual(live.data.items,[]);
 assert.equal((await f.call('stop')).code,0);
 const offline=await client.runWorkspace('workspace.list',{projectId},{stateDirectory:f.archive});
 assert.equal(offline.freshness,'LAST_KNOWN');assert.deepEqual(offline.data.items,[]);
});

test('workspace runtime fences actions before recovery and drains accepted work independently from the caller',async t=>{
 const f=await createRegistryStore(t),peer:AuthenticatedPeer={role:'client',identity:'fixture',credentialId:'fixture'};
 let complete!:()=>void;
 const hold=new Promise<void>(resolve=>{complete=resolve;});
 const runtime=createWorkspaceRuntime(f.store as unknown as StoragePort,context=>({
   actions:{'workspace.refresh':async p=>{
     assert.equal(context.accepting(),true);context.schedule(()=>hold);
     return{accepted:true,requestId:p.requestId,workspaceId:p.workspaceId};
   }},
   async recover(){},
 }));
 const params={requestId:randomUUID(),workspaceId:randomUUID(),expectedStateRevision:'1'};
 const send=()=>runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:'workspace.refresh',params},peer,f.store.readSnapshot()!);
 assert.equal((await send()).result,'BLOCKED');
 await runtime.recover();
 assert.equal((await send()).result,'OK');
 await assert.rejects(runtime.stop(makeDeadline(systemClock,3)),/RESOURCE_IDENTITY_UNKNOWN/);
 assert.equal((await send()).result,'BLOCKED');
 complete();await runtime.idle();await runtime.stop(makeDeadline(systemClock,1000));
});
