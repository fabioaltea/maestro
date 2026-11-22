import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import Database from 'better-sqlite3';
import {redactEventDraft} from '../../src/protocol/events.js';
import {schedulerStoreFixture} from '../fixtures/scheduler-store.js';

test('scheduler events retain operation correlation and omit tool or provider data',()=>{
 const jobId=randomUUID(),operationId=randomUUID();
 const record=redactEventDraft({type:'scheduler.changed',operationId,
   payload:{scope:'scheduler',jobId,state:'RECONCILING',stateRevision:'2',action:'enqueue',text:'synthetic credential',pid:42}});
 assert.equal(record.operationId,operationId);
 assert.deepEqual(record.payload,{scope:'scheduler',jobId,state:'RECONCILING',stateRevision:'2',action:'enqueue',truncated:true,redactedFields:2});
});

test('shared metadata quota preserves cancel and queue reads',async t=>{
 const f=await schedulerStoreFixture(t),ada=f.enqueue(f.intent());
 f.store.commitSchedulerState({kind:'enqueue',admission:ada});
 const db=new Database(f.paths.stateFile);
 try{
   db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'INPUT',1,?,?,'SEALED',?)")
     .run(randomUUID(),'a'.repeat(64),122*1024*1024,Date.now());
   assert.equal(f.store.readSchedulerState({kind:'job',id:ada.requestId}).job?.state,'QUEUED');
   const grant=f.saveGrant({...f.base,namespace:'SCHEDULER',action:'cancel',targetId:ada.requestId,projectId:f.projectId,
     expectedRevision:'1',configRevision:null,payload:{}});
   assert.equal(f.store.commitSchedulerState({kind:'cancel',admission:grant}).operation?.outcome,'SUCCEEDED');
   assert.equal(f.store.readSchedulerState({kind:'job',id:ada.requestId}).job?.state,'CANCELLED');
 }finally{db.close();}
});
