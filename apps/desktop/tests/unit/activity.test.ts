import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendActivity, emptyActivity } from '../../src/renderer/state/activity.ts';
import type { UiEvent } from '../../src/shared/activity-contract.ts';
test('activity keeps a bounded FIFO and rejects gaps without advancing applied sequence', () => {
  const storeId = randomUUID();
  const events = Array.from({length:1000},(_,i):UiEvent=>({protocolVersion:1,storeId,eventId:randomUUID(),seq:String(i+1),occurredAt:'2026-11-15T00:00:00Z',instanceId:null,operationId:null,type:'lifecycle.changed',payload:{from:'STARTING',to:'RUNNING'}}));
  const state = appendActivity(emptyActivity, events);
  assert.equal(state.events.length,500); assert.equal(state.omitted,500); assert.ok(state.bytes<=4*1024*1024); assert.equal(state.appliedSeq,'1000');
  assert.throws(()=>appendActivity(state,[{...events[0]!,seq:'1002'}]));
  assert.equal(state.appliedSeq,'1000');
  assert.throws(()=>appendActivity(state,[{...events[0]!,storeId:randomUUID(),seq:'1001'}]));
  assert.equal(appendActivity(state,[events[999]!]).events.length,500);
});
