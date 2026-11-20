import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {startSuccessor} from '../fixtures/workspace-runtime.js';
import {schedulerStoreFixture} from '../fixtures/scheduler-store.js';

test('a successor retains the prior debit and fences release by job and generation',async t=>{
 const f=await schedulerStoreFixture(t),a=f.enqueue(f.intent()),b=f.enqueue(f.intent('ENVIRONMENT','prepare'));
 for(const admission of [a,b])f.store.commitSchedulerState({kind:'enqueue',admission});
 const generation=randomUUID(),resource={jobId:a.requestId,generation,projectId:f.projectId,workspaceId:f.workspaceId,type:'EXECUTION' as const};
 const result=f.store.commitSchedulerState({kind:'reserve',instanceId:f.instanceId,resource,expectedRevision:'1',at:new Date().toISOString()});
 assert.equal(result.job?.state,'RESERVED');
 const next=startSuccessor(f);
 f.store.commitSchedulerState({kind:'recover',instanceId:next});
 assert.equal(f.store.readSchedulerState({kind:'job',id:a.requestId}).job?.state,'RECONCILING');
 assert.throws(()=>f.store.commitSchedulerState({kind:'reserve',instanceId:next,
   resource:{...resource,jobId:b.requestId,generation:randomUUID(),type:'INSTALL'},expectedRevision:'1',at:new Date().toISOString()}),/WORKSPACE_IN_USE/);
 assert.throws(()=>f.store.commitSchedulerState({kind:'reservation',instanceId:next,jobId:a.requestId,generation,
   event:{kind:'go',generation}}),/STALE_TARGET/);
 const released=f.store.commitSchedulerState({kind:'reservation',instanceId:next,jobId:a.requestId,generation,
   event:{kind:'release',proof:{kind:'NO_SPAWN',verified:true,generation,jobId:a.requestId}}});
 assert.equal(released.reservation?.state,'RELEASED');assert.equal(released.job?.state,'WAITING_USER');
});

test('a qualified fixture dispatches only after reservation and durable GO',async t=>{
 const [{createSchedulerRuntime},{schedulerBoundaryFixture},{makeDeadline,systemClock},{setTimeout:wait}]=await Promise.all([
   import('../../src/core/scheduler/runtime.js'),import('../fixtures/scheduler-boundary.js'),
   import('../../src/ports/clock.js'),import('node:timers/promises'),
 ]);
 const f=await schedulerStoreFixture(t),a=f.enqueue(f.intent()),native=schedulerBoundaryFixture();
 f.store.commitSchedulerState({kind:'enqueue',admission:a});
 let effects=0;
 const runtime=createSchedulerRuntime({storage:f.storage,paths:f.paths,instanceId:f.instanceId,executor:{
   async open(job,reservation){
     assert.equal(f.store.readSchedulerState({kind:'job',id:job.jobId}).job?.state,'RESERVED');
     return{async go(){
       assert.equal(f.store.readSchedulerState({kind:'job',id:job.jobId}).job?.state,'RUNNING');
       await native.spawnLocal();effects++;
       return{proof:{jobId:job.jobId,generation:reservation.generation,kind:'EXIT',verified:true},success:true};
     },stop(){}};
   },
 }});
 t.after(()=>runtime.stop(makeDeadline(systemClock,1500)));
 await runtime.recover();
 for(let i=0;i<200&&f.store.readSchedulerState({kind:'job',id:a.requestId}).job?.state!=='SUCCEEDED';i++)await wait(15);
 assert.equal(f.store.readSchedulerState({kind:'job',id:a.requestId}).job?.state,'SUCCEEDED');
 assert.equal(effects,1);assert.deepEqual(f.store.readSchedulerState({kind:'reservations'}).reservations,[]);
});
