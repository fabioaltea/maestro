import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {redactEventDraft} from '../../src/protocol/events.js';
import {createProfileRuntime} from '../../src/core/profiles/runtime.js';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';
import type {StoragePort} from '../../src/ports/storage.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';

test('profile event carries only bounded correlation metadata',()=>{
 const entityId=randomUUID(),operationId=randomUUID();
 const draft=redactEventDraft({type:'profile.changed',operationId,payload:{
   scope:'profile',entityId,action:'skill.import',revisionId:randomUUID(),stateRevision:'1',code:'PROFILE_STALE',
   path:'/private/fixture',content:'secret fixture',credentials:['never'],
 }});
 assert.equal(draft.payload.entityId,entityId);assert.equal(draft.operationId,operationId);
 assert.equal(draft.payload.redactedFields,3);assert.equal(draft.payload.truncated,true);
 assert.ok(!JSON.stringify(draft).includes('secret fixture'));
});
test('profile runtime keeps historical methods and bounds outstanding live calls',async t=>{
 const f=await createRegistryStore(t),paths=(await createPlatformPaths().resolveArchive(f.directory,'write'))!;
 let finish!:()=>void;
 const work=new Promise<void>(resolve=>{finish=resolve;});
 const runtime=createProfileRuntime({storage:f.store as unknown as StoragePort,paths,instanceId:f.instanceId,
   compose:()=>({'profile.capabilities':async()=>{await work;return{};}})});
 const run=()=>runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method:'profile.capabilities',params:{}},
   {role:'client',identity:'fixture',credentialId:'fixture'},f.store.readSnapshot()!);
 assert.equal((await run()).result,'BLOCKED');
 assert.ok(!runtime.methods.includes('profile.create'));
 runtime.start();
 const pending=Array.from({length:8},run);
 assert.equal((await run()).result,'BUSY');
 await assert.rejects(runtime.stop(makeDeadline(systemClock,5)),/DEADLINE_EXCEEDED/);
 finish();
 assert.ok((await Promise.all(pending)).every(result=>result.result==='OK'));
});
