import test from 'node:test';
import assert from 'node:assert/strict';
import { ActivityStream, StreamFrames } from '../../src/main/activity-stream.ts';
import { ReplaySequence, gapBounds } from '../../src/main/activity-recovery.ts';
import { appendActivity, emptyActivity } from '../../src/renderer/state/activity.ts';
import { streamFrames, scriptedRuntime, waitFor } from '../fixtures/stream.ts';
import type { ActivityMessage } from '../../src/shared/bridge-contract.ts';
import { decodeUiEvent } from '../../src/shared/activity-contract.ts';
test('replay ignores identical duplicates, rejects conflict, holes, wrong store and invalid gap bounds',()=>{
 const f=streamFrames();const replay=new ReplaySequence('0');
 assert.equal(replay.accept('1',f.events[0]!.event.eventId),true);assert.equal(replay.accept('1',f.events[0]!.event.eventId),false);
 assert.throws(()=>replay.accept('1',crypto.randomUUID()));assert.throws(()=>replay.accept('3',crypto.randomUUID()));
 const parser=new StreamFrames(f.storeId,f.after);parser.decode(f.started);assert.equal(parser.decode(f.events[0]).kind,'event');assert.equal(parser.decode(f.events[0]).kind,'duplicate');
 assert.throws(()=>gapBounds({storeId:f.storeId,firstAvailable:'0',highWater:'10'},f.storeId));
 assert.throws(()=>gapBounds({storeId:crypto.randomUUID(),firstAvailable:'9',highWater:'10'},f.storeId));
 const event=decodeUiEvent(f.events[0]!.event,f.storeId),state=appendActivity(emptyActivity,[event]);
 assert.equal(appendActivity(state,[event]).events.length,1);
 assert.throws(()=>appendActivity(state,[{...event,storeId:crypto.randomUUID(),seq:'2'}]));
});
for(const callbackFails of [false,true])test(`stream subprocess loss/callback failure keeps unacknowledged checkpoint (${callbackFails})`,async t=>{
 const f=streamFrames(),messages:ActivityMessage[]=[];const runtime=await scriptedRuntime(t,[f.started,...f.events],{exit:true});
 const stream=new ActivityStream({runtime,archive:'/unused',storeId:f.storeId,epoch:1,after:f.after,onMessage:m=>{messages.push(m);if(callbackFails&&m.kind==='activity.batch')throw new Error('private callback error');}});
 t.after(()=>stream.close());await stream.start();await waitFor(()=>messages.some(m=>m.kind==='activity.state'&&m.state==='DISCONNECTED'));
 assert.equal(stream.lastAppliedCursor,f.after);assert.doesNotMatch(JSON.stringify(messages),/private callback error/);
});
test('expired replay reports verified bounds and never substitutes high water for applied cursor',async t=>{
 const f=streamFrames(),messages:ActivityMessage[]=[];const runtime=await scriptedRuntime(t,[{protocolVersion:1,result:'BLOCKED',error:{code:'CURSOR_EXPIRED'},data:{storeId:f.storeId,firstAvailable:'9',highWater:'10',nextAction:'reread-status'}}]);
 const stream=new ActivityStream({runtime,archive:'/unused',storeId:f.storeId,epoch:1,after:f.after,onMessage:m=>messages.push(m)});t.after(()=>stream.close());
 await assert.rejects(stream.start(),/CURSOR_EXPIRED/);assert.equal(stream.lastAppliedCursor,f.after);
 assert.ok(messages.some(m=>m.state==='GAP'&&m.firstAvailable==='9'&&m.highWater==='10'));
});
