import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {redactEventDraft} from '../../src/protocol/events.js';
import type {EventDraft} from '../../src/protocol/messages.js';
test('feature metadata is correlated, bounded and accepted by the actual desktop decoder without private data',async t=>{
 const f=await createRegistryStore(t),requestId=randomUUID(),featureId=randomUUID();
 const draft={type:'feature.changed',operationId:requestId,payload:{scope:'feature',action:'create',featureId,projectId:randomUUID(),stateRevision:'1',state:'DRAFT',canonicalIntent:'PRIVATE_FEATURE_SENTINEL',title:'PRIVATE_TITLE'}} as unknown as EventDraft;
 f.store.recordEvents([draft]);const events=f.store.listEvents({limit:100}).records.filter(e=>e.operationId===requestId);assert.equal(events.length,1);
 assert.doesNotMatch(JSON.stringify(events),/PRIVATE_FEATURE_SENTINEL|PRIVATE_TITLE|canonicalIntent|title/);assert.ok(Buffer.byteLength(JSON.stringify(events[0]))<=16384);
 const ui=await import(pathToFileURL(resolve('apps/desktop/src/shared/activity-contract.ts')).href) as {decodeUiEvent(value:unknown,storeId:string):unknown};assert.deepEqual(ui.decodeUiEvent(events[0],f.storeId),events[0]);
 assert.throws(()=>redactEventDraft({...draft,payload:{...draft.payload,scope:'project'}}));
});
