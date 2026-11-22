import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {createEnvironmentRuntime} from '../../src/core/environments/runtime.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import {createClientBackend} from '../../src/bootstrap.js';
import {LocalClient} from '../../src/client/local-client.js';
import type {StoragePort} from '../../src/ports/storage.js';

test('daemon advertises existing environment methods only and preserves read-only fallback',async t=>{
 const f=await createCliHarness(t),started=await f.call('start');
 assert.equal(started.code,0,started.stdout);
 const state=JSON.parse((await f.call('status')).stdout);
 assert.equal(state.data.capabilities.environmentVersion,1);
 assert.ok(state.data.capabilities.environmentMethods.includes('environment.list'));
 for(const method of ['environment.prepare','environment.cancel','environment.validate','environment.reconcile'])
   assert.ok(state.data.capabilities.environmentMethods.includes(method));
 const readOnly=createEnvironmentRuntime({storage:{} as StoragePort,instanceId:randomUUID()});
 assert.ok(readOnly.methods.includes('environment.job.get'));
 assert.ok(!readOnly.methods.includes('environment.validate'));
 const client=new LocalClient(createClientBackend()),args={projectId:randomUUID()},options={stateDirectory:f.archive};
 assert.deepEqual((await client.runEnvironment('environment.list',args,options)).data.items,[]);
 assert.equal((await f.call('stop')).code,0);
 assert.equal((await client.runEnvironment('environment.list',args,options)).freshness,'LAST_KNOWN');
});
test('runtime fences new requests and preserves accepted job identity across bounded drain',async t=>{
 const fixture=await createRegistryStore(t);
 let finish!:()=>void,stopped=false;
 const waiting=new Promise<void>(resolve=>{finish=resolve;});
 const runtime=createEnvironmentRuntime({storage:fixture.store as unknown as StoragePort,instanceId:fixture.instanceId,
   compose:context=>({actions:{'environment.plan':async()=>{context.schedule(()=>waiting);return{accepted:true};}},
     stop(){stopped=true;}})});
 const peer={identity:'fixture',role:'client' as const,credentialId:'fixture'};
 const call=()=>runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:'environment.plan',
   params:{requestId:randomUUID(),workspaceId:randomUUID(),expectedStateRevision:'1'}},peer,fixture.store.readSnapshot()!);
 assert.equal((await call()).result,'BLOCKED');
 await runtime.recover();assert.equal((await call()).result,'OK');
 await assert.rejects(runtime.stop(makeDeadline(systemClock,2)),/JOB_RECONCILING/);
 assert.equal(stopped,true);assert.equal((await call()).result,'BLOCKED');
 finish();await runtime.idle();
});
