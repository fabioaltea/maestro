import test from 'node:test';
import assert from 'node:assert/strict';
import {executionRuntimeFixture,waitForExecution} from '../fixtures/execution-runtime.js';

test('an independent client can read and answer a question, with stale answers rejected',async t=>{
 const f=await executionRuntimeFixture(t,{question:true});
 const {requestId}=await f.mutate('start',await f.prepare('start',f.startIntent));
 await waitForExecution(()=>f.state(requestId)?.state==='WAITING_USER');
 const result=await f.send('get',{sessionId:requestId}),data=result.data as Record<string,unknown>;
 const [q]=(data.interactions as {interactionId:string;expectedRevision:string;textArtifactId:string}[]);
 assert.ok(q);
 const read=await f.send('artifact.get',{artifactId:q.textArtifactId});
 assert.equal(Buffer.from(String((read.data as Record<string,unknown>).base64),'base64').toString(),'Confermi il passaggio seguente?');
 const artifact=await f.uploadInput('Confermo il test locale.',f.startIntent.featureId);
 const intent={interactionId:q.interactionId,expectedRevision:q.expectedRevision,answerArtifactId:artifact};
 const first=await f.prepare('answer',intent,{stateRevision:q.expectedRevision}),later=await f.prepare('answer',intent,{stateRevision:q.expectedRevision});
 const answer=await f.mutate('answer',first);
 assert.equal(answer.operation?.outcome,'SUCCEEDED');
 await f.runtime.idle();
 assert.deepEqual(f.receivedAnswers,['Confermo il test locale.']);
 assert.equal(f.state(requestId)?.state,'READY_FOR_REVIEW');
 const stale=await f.mutate('answer',later);
 assert.equal((stale.reply.data as Record<string,unknown>).code,'PROCESS_UNKNOWN');
 assert.equal(f.counts().writes,1);
 const chunks=(await f.send('output.list',{runId:requestId})).data as {chunks:unknown[];watermark:string};
 assert.equal(chunks.chunks.length,1);assert.equal(chunks.watermark,'1');
});

test('overflow remains queryable and cancellation preserves the result after owned exit',async t=>{
 const f=await executionRuntimeFixture(t,{question:true,output:'x'.repeat(8193)});
 const {requestId}=await f.mutate('start',await f.prepare('start',f.startIntent));
 await waitForExecution(()=>f.state(requestId)?.state==='WAITING_USER');
 const revision=f.state(requestId)!.stateRevision;
 const cancelled=await f.mutate('cancel',await f.prepare('cancel',{sessionId:requestId,expectedStateRevision:revision},{stateRevision:revision}));
 assert.equal(cancelled.operation?.action,'cancel');
 await f.runtime.idle();
 assert.equal(f.state(requestId)?.state,'CANCELLED');
 assert.equal(f.run(requestId)?.proof?.verified,true);
 const output=(await f.send('output.list',{runId:requestId})).data as {truncated:boolean;chunks:unknown[]};
 assert.equal(output.truncated,true);
 assert.deepEqual(output.chunks,[]);
 assert.equal((await f.send('operation.get',{requestId:cancelled.requestId})).result,'OK');
});
