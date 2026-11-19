import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

test('workspace events correlate a bounded public reservation and backpressure leaves its original UUID readable',async t=>{
 const {decodeUiEvent}=await import(pathToFileURL(resolve('apps/desktop/src/shared/activity-contract.ts')).href) as
   {decodeUiEvent(input:unknown,storeId:string):{payload:Record<string,unknown>}};
 const f=await workspaceAuthoringFixture(t),approved=await f.approvedFeature();
 function command(){
   const target=f.target(approved.featureId),nowMs=Date.now(),grantId=randomUUID(),requestId=randomUUID();
   const canonicalIntent=canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'WORKSPACE',action:'create',
     targetId:target.workspaceId,projectId:f.projectId,expectedRevision:'2',configRevision:'1',payload:{featureId:approved.featureId,
       envelopeId:approved.envelope.envelopeId,envelopeDigest:approved.envelope.digest,ownerGeneration:randomUUID(),repositoryKey:f.project.repositoryKey,target}});
   f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:nowMs,expiresAtMs:nowMs+300000,consumedByRequestId:null}});
   return {target,requestId,submit:()=>f.store.commitWorkspaceState({kind:'reserve',
     admission:{requestId,grantId,instanceId:f.instanceId,canonicalIntent,nowMs},contextCheckedAt:new Date().toISOString()})};
 }
 const first=command(),competing=command();
 const initial=first.submit();
 const events=f.store.listEvents({limit:100}).records.filter(e=>e.operationId===first.requestId);
 assert.deepEqual(events.map(e=>e.type),['operation.accepted','workspace.changed']);
 for(const e of events){
   assert.equal(decodeUiEvent(e,f.storeId).payload.workspaceId,first.target.workspaceId);
   const raw=JSON.stringify(e);
   assert.ok(Buffer.byteLength(raw)<1024);
   assert.ok(!raw.includes(f.repo)&&!raw.includes(f.root)&&!raw.includes('canonicalIntent'));
 }
 const backlog=f.database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records:string};
 f.database.prepare("UPDATE event_outbox SET records='[{}]' WHERE singleton=1").run();
 try{
   assert.throws(competing.submit,/EVENT_BACKPRESSURE/);
   assert.equal(f.store.readFeatureState({kind:'operation',id:competing.requestId}).operation,null);
   assert.deepEqual(first.submit().operation,initial.operation);
   assert.equal(f.store.readWorkspaceState({kind:'summary',id:first.target.workspaceId}).summary?.state,'CREATING');
 }finally{f.database.prepare('UPDATE event_outbox SET records=? WHERE singleton=1').run(backlog.records);}
});
