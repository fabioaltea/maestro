import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {redactEventDraft} from '../../src/protocol/events.js';

test('execution events retain correlation and redact process or interaction data',()=>{
 const runId=randomUUID(),sessionId=randomUUID(),instanceId=randomUUID();
 const event=redactEventDraft({type:'execution.output.available',instanceId,operationId:runId,
   payload:{scope:'execution',runId,sessionId,watermark:'2',text:'secret synthetic value',challenge:randomUUID(),pid:42}});
 assert.equal(event.operationId,runId);
 assert.deepEqual(event.payload,{scope:'execution',runId,sessionId,watermark:'2',truncated:true,redactedFields:3});
 assert.throws(()=>redactEventDraft({type:'execution.output.available',instanceId,operationId:runId,
   payload:{scope:'execution',runId,sessionId}}),/INVALID_REQUEST/);
});

test('quota leaves room for cancellation and reconciliation while reads remain available',async t=>{
 const [{default:Database},{executionRuntimeFixture,waitForExecution}]=await Promise.all([
   import('better-sqlite3'),import('../fixtures/execution-runtime.js'),
 ]);
 const f=await executionRuntimeFixture(t,{question:true});
 const {requestId}=await f.mutate('start',await f.prepare('start',f.startIntent));
 await waitForExecution(()=>f.state(requestId)?.state==='WAITING_USER');
 const database=new Database(f.paths.stateFile);
 const synthetic=randomUUID();
 try{
   // Weight a fixture row to reach the reserve without a 120 MiB volume campaign.
   database.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'INPUT',1,?, ?, 'SEALED',?)")
     .run(synthetic,'a'.repeat(64),122*1024*1024,Date.now());
   assert.equal((await f.send('get',{sessionId:requestId})).result,'OK');
   const revision=f.state(requestId)!.stateRevision;
   const paused={sessionId:requestId,expectedStateRevision:revision};
   const rejected=await f.send('prepare',{action:'pause',intent:paused,expectedRevisions:{stateRevision:revision}});
   assert.equal((rejected.data as {code:string}).code,'RESOURCE_LIMIT');
   const cancel=await f.prepare('cancel',paused,{stateRevision:revision});
   assert.equal((await f.mutate('cancel',cancel)).operation?.action,'cancel');
   await f.runtime.idle();
   assert.equal(f.state(requestId)?.state,'CANCELLED');
   assert.equal((await f.send('reconcile',{sessionId:requestId,requestId:randomUUID()})).result,'OK');
 }finally{
 }
});
