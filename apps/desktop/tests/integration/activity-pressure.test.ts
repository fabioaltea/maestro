import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityStream } from '../../src/main/activity-stream.ts';
import { STREAM_LIMITS, assertBacklog } from '../../src/main/activity-pressure.ts';
import { appendActivity, emptyActivity } from '../../src/renderer/state/activity.ts';
import { streamFrames, scriptedRuntime, waitFor } from '../fixtures/stream.ts';
import type { UiEvent } from '../../src/shared/activity-contract.ts';
import type { ActivityMessage } from '../../src/shared/bridge-contract.ts';
test('declared backlog, batch and ring limits remain hard bounds',()=>{
 assert.equal(STREAM_LIMITS.backlog,262144);assert.equal(STREAM_LIMITS.ackMs,2000);assert.throws(()=>assertBacklog(262145));
 const f=streamFrames(undefined,0,1000),state=appendActivity(emptyActivity,f.events.map(e=>e.event) as UiEvent[]);
 assert.equal(state.events.length,500);assert.equal(state.omitted,500);
 const large=appendActivity(emptyActivity,f.events.slice(0,499).map(e=>({...e.event,payload:{stress:'x'.repeat(16000)}})) as UiEvent[]);
 assert.ok(large.bytes<=4*1024*1024);assert.ok(large.events.length<499);assert.ok(large.omitted>0);
});
for(const wrong of [false,true])test(`missing/wrong ACK closes only owned stream within three seconds (${wrong})`,async t=>{
 const f=streamFrames(undefined,0,500),messages:ActivityMessage[]=[],runtime=await scriptedRuntime(t,[f.started,...f.events],{interval:0});
 const stream=new ActivityStream({runtime,archive:'/unused',storeId:f.storeId,epoch:1,after:f.after,onMessage:m=>messages.push(m)});t.after(()=>stream.close());await stream.start();
 await waitFor(()=>messages.some(m=>m.kind==='activity.batch'));const start=performance.now();
 if(wrong)assert.throws(()=>stream.ack(crypto.randomUUID(),'500'));
 await waitFor(()=>messages.some(m=>m.state=== (wrong?'DISCONNECTED':'SATURATED')),3000);
 assert.ok(performance.now()-start<3000);assert.equal(stream.lastAppliedCursor,f.after);assert.ok(stream.backlogBytes<=262144);await stream.close();
});
test('duplicate ACK is idempotent even while next batch is pending',async t=>{
 const f=streamFrames(undefined,0,3),messages:ActivityMessage[]=[],runtime=await scriptedRuntime(t,[f.started,...f.events],{interval:10});
 const stream=new ActivityStream({runtime,archive:'/unused',storeId:f.storeId,epoch:1,after:f.after,onMessage:m=>messages.push(m)});t.after(()=>stream.close());await stream.start();
 await waitFor(()=>messages.filter(m=>m.kind==='activity.batch').length===1);await new Promise(r=>setTimeout(r,100));
 const batch=messages.find(m=>m.kind==='activity.batch')!,seq=(batch.events as UiEvent[]).at(-1)!.seq;
 const first=stream.ack(String(batch.batchId),seq);await waitFor(()=>messages.filter(m=>m.kind==='activity.batch').length===2);
 assert.deepEqual(stream.ack(String(batch.batchId),seq),first);await stream.close();
});
