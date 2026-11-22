import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {schedulerStoreFixture} from '../fixtures/scheduler-store.js';


test('queue admission is atomic, retains the original receipt and leaves the delegate grant intact',async t=>{
 const f=await schedulerStoreFixture(t);
 const missing=f.enqueue(randomUUID());
 assert.throws(()=>f.store.commitSchedulerState({kind:'enqueue',admission:missing}),/APPROVAL_STALE/);
 assert.equal(f.store.readFeatureState({kind:'operation',id:missing.requestId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:missing.grantId}).grant?.consumedByRequestId,null);
 const id=f.intent(),a=f.enqueue(id);
 const accepted=f.store.commitSchedulerState({kind:'enqueue',admission:a});
 assert.equal(accepted.operation?.outcome,'SUCCEEDED');
 assert.equal(f.store.readFeatureState({kind:'grant',id}).grant?.consumedByRequestId,null);
 assert.deepEqual(f.store.commitSchedulerState({kind:'enqueue',admission:a}).operation,accepted.operation);
 assert.throws(()=>f.store.commitSchedulerState({kind:'enqueue',admission:f.enqueue(id)}),/IDEMPOTENCY_CONFLICT/);
 assert.equal(f.store.readSchedulerState({kind:'queue',projectId:f.projectId}).jobs?.length,1);
});

test('policy updates use CAS and retain historic operation outcomes',async t=>{
 const f=await schedulerStoreFixture(t);
 const prepare=()=>f.saveGrant({...f.base,namespace:'SCHEDULER',action:'policy.configure',targetId:null,projectId:null,
   expectedRevision:'1',configRevision:null,payload:{limits:{global:3,install:2,validate:1}}});
 const a=prepare(),other=prepare();
 assert.equal(f.store.commitSchedulerState({kind:'policy.configure',admission:a}).operation?.result?.policyRevision,'2');
 assert.throws(()=>f.store.commitSchedulerState({kind:'policy.configure',admission:other}),/APPROVAL_STALE/);
 assert.equal(f.store.readSchedulerState({kind:'policy'}).policy?.revision,'2');
});
