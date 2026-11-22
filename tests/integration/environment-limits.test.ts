import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {workflowAdmission} from '../../src/core/workflow/admission.js';
import type {WorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {redactEventDraft} from '../../src/protocol/events.js';

test('Environment event admission is atomic and redacted on the bounded outbox',async t=>{
 const {decodeUiEvent}=await import(pathToFileURL(resolve('apps/desktop/src/shared/activity-contract.ts')).href);
 const f=await workspaceRuntimeFixture(t),made=await f.prepare();
 assert.equal((await f.submit(made.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspaceId=made.data.summary.workspaceId,requestId=randomUUID();
 const intent:WorkflowIntent={version:1,storeId:f.storeId,ownerUid:f.paths.ownerUid,namespace:'ENVIRONMENT',action:'plan',
   targetId:workspaceId,projectId:f.projectId,expectedRevision:'2',configRevision:'1',payload:{privatePath:f.repo}};
 const admission=workflowAdmission({requestId,intent,grantId:null,instanceId:f.instanceId,nowMs:Date.now()});
 const commit=()=>f.store.commitEnvironmentState({kind:'plan-admit',admission});
 commit();
 const events=f.store.listEvents({limit:100}).records.filter(e=>e.operationId===requestId);
 assert.deepEqual(events.map(e=>e.type),['operation.accepted','environment.changed']);
 for(const event of events){
   assert.equal(decodeUiEvent(event,f.storeId).payload.workspaceId,workspaceId);
   assert.ok(!JSON.stringify(event).includes(f.repo));
 }
 const watermark=redactEventDraft({type:'environment.output.available',operationId:requestId,payload:{
   scope:'environment',workspaceId,jobId:randomUUID(),watermark:'2',chunk:'private payload',
 }});
 assert.equal(watermark.payload.watermark,'2');assert.ok(!Object.hasOwn(watermark.payload,'chunk'));
 const backlog=f.database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records:string};
 const newRequest=randomUUID();
 f.database.prepare("UPDATE event_outbox SET records='[{}]' WHERE singleton=1").run();
 try{
   assert.throws(()=>f.store.commitEnvironmentState({kind:'plan-admit',admission:{...admission,requestId:newRequest}}),/EVENT_BACKPRESSURE/);
   assert.equal(f.store.readFeatureState({kind:'operation',id:newRequest}).operation,null);
   assert.equal(commit().inserted,false);
 }finally{f.database.prepare('UPDATE event_outbox SET records=? WHERE singleton=1').run(backlog.records);}
});
