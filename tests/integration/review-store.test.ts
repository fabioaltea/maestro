import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';
import Database from 'better-sqlite3';
import {createReviewRuntime} from '../../src/core/review/runtime.js';
import type {StoragePort} from '../../src/ports/storage.js';

test('failed review admission rolls back the request and leaves its exact grant unconsumed',async t=>{
 const f=await workspaceAuthoringFixture(t),grantId=randomUUID(),requestId=randomUUID(),now=Date.now();
 const canonicalIntent=canonicalWorkflowIntent({
   version:1,namespace:'REVIEW',action:'request-changes',storeId:f.storeId,ownerUid:f.paths.ownerUid,targetId:randomUUID(),
   projectId:f.projectId,expectedRevision:'1',configRevision:null,payload:{instanceId:f.instanceId,digest:'d'.repeat(64),feedbackArtifactId:randomUUID()},
 });
 f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+1000,consumedByRequestId:null}});
 const admission={requestId,grantId,canonicalIntent,instanceId:f.instanceId,nowMs:now};
 assert.throws(()=>f.store.commitReviewState({kind:'request-changes',admission}),/REVIEW_STALE/);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
});

test('startup closes a pending snapshot intent without replaying Git or reopening terminal work',async t=>{
 const f=await workspaceAuthoringFixture(t),requestId=randomUUID(),instanceId=randomUUID(),at=new Date().toISOString();
 const db=new Database(f.paths.stateFile);
 try{
   db.prepare(`INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,
     owning_instance_id,phase,outcome,accepted_at) VALUES(?,'REVIEW','create',?,'{}',?,?,'ACCEPTED','IN_PROGRESS',?)`)
     .run(requestId,'a'.repeat(64),f.paths.ownerUid,f.instanceId,at);
   db.transaction(()=>{
     db.prepare("INSERT INTO instances VALUES(?,?,'2','RECOVERING',?,0,NULL)").run(instanceId,process.pid,at);
     db.prepare('UPDATE store SET current_instance_id=? WHERE singleton=1').run(instanceId);
   })();
 }finally{db.close();}
 const runtime=createReviewRuntime({storage:f.store as unknown as StoragePort,paths:f.paths,instanceId,currentEligibility:async()=>{throw new Error('Unexpected inspection');}});
 await runtime.recover();
 const {operation}=f.store.readFeatureState({kind:'operation',id:requestId});
 assert.equal(operation?.outcome,'INTERRUPTED');
 assert.equal(f.store.readReviewState({kind:'review',id:requestId}).review,null);
 await runtime.recover();
 assert.deepEqual(f.store.readFeatureState({kind:'operation',id:requestId}).operation,operation);
});

test('review admission rejects work from another daemon and work queued after the drain fence',async t=>{
 const f=await workspaceAuthoringFixture(t),now=Date.now();
 function grant(instanceId:string){
   const grantId=randomUUID(),requestId=randomUUID();
   const canonicalIntent=canonicalWorkflowIntent({version:1,namespace:'REVIEW',action:'request-changes',storeId:f.storeId,
     ownerUid:f.paths.ownerUid,targetId:randomUUID(),projectId:f.projectId,expectedRevision:'1',configRevision:null,
     payload:{instanceId,digest:'d'.repeat(64),feedbackArtifactId:randomUUID()}});
   f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+60000,consumedByRequestId:null}});
   return{requestId,grantId,canonicalIntent,instanceId:f.instanceId,nowMs:now};
 }
 const stale=grant(randomUUID());
 assert.throws(()=>f.store.commitReviewState({kind:'request-changes',admission:stale}),/APPROVAL_STALE/);
 const draining=grant(f.instanceId);
 f.store.transitionInstance(f.instanceId,'STOPPING');
 assert.throws(()=>f.store.commitReviewState({kind:'request-changes',admission:draining}),/STALE_TARGET/);
 for(const admission of [stale,draining]){
   assert.equal(f.store.readFeatureState({kind:'operation',id:admission.requestId}).operation,null);
   assert.equal(f.store.readFeatureState({kind:'grant',id:admission.grantId}).grant?.consumedByRequestId,null);
 }
});
