import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {redactEventDraft} from '../../src/protocol/events.js';
import type {StoragePort} from '../../src/ports/storage.js';
import {createReviewReader} from '../../src/core/review/read.js';
import {startSuccessor} from '../fixtures/workspace-runtime.js';

test('review outbox strips diff text, arbitrary paths and ref details',()=>{
 const reviewId=randomUUID(),operationId=randomUUID();
 const record=redactEventDraft({type:'review.changed',operationId,
   payload:{scope:'review',reviewId,state:'DRAFT',stateRevision:'1',action:'create',diff:'private',path:'/tmp/source',targetRef:'refs/heads/fixture'}});
 assert.equal(record.operationId,operationId);
 assert.deepEqual(record.payload,{scope:'review',reviewId,state:'DRAFT',stateRevision:'1',action:'create',truncated:true,redactedFields:3});
 const output=redactEventDraft({type:'review.output.available',operationId,payload:{scope:'review',reviewId,
   stateRevision:'1',watermark:'2',base64:'private'}});
 assert.deepEqual(output.payload,{scope:'review',reviewId,stateRevision:'1',watermark:'2',truncated:true,redactedFields:1});
 assert.throws(()=>redactEventDraft({...output,payload:{...output.payload,watermark:'secret'}}),/INVALID_REQUEST/);
});

test('the shared reserve preserves review reads, artifact cancellation and recovery at the ordinary quota',async t=>{
 const [{default:Database},{workspaceAuthoringFixture},{canonicalWorkflowIntent}]=await Promise.all([
   import('better-sqlite3'),import('../fixtures/workspace-authoring.js'),import('../../src/domain/workflow/authorization.js'),
 ]);
 const f=await workspaceAuthoringFixture(t),db=new Database(f.paths.stateFile);
 const approved=await f.approvedFeature();
 const artifactId=await f.uploadInput('Feedback da annullare.',approved.featureId);
 const pendingId=randomUUID();
 try{
   db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'BUNDLE',1,?,?,'SEALED',?)")
     .run(randomUUID(),'a'.repeat(64),122*1024*1024,Date.now());
   const canonicalIntent=canonicalWorkflowIntent({version:1,namespace:'REVIEW',action:'create',storeId:f.storeId,ownerUid:f.paths.ownerUid,
     targetId:randomUUID(),projectId:f.projectId,expectedRevision:'1',configRevision:'1',payload:{}});
   const grantId=randomUUID(),now=Date.now();
   db.prepare(`INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,
     owning_instance_id,phase,outcome,accepted_at) VALUES(?,'REVIEW','create',?,?,?,?,'ACCEPTED','IN_PROGRESS',?)`)
     .run(pendingId,'b'.repeat(64),canonicalIntent,f.paths.ownerUid,f.instanceId,new Date(now).toISOString());
   assert.throws(()=>f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,
     expiresAtMs:now+60000,consumedByRequestId:null}}),/RESOURCE_LIMIT/);
   assert.deepEqual(f.store.readReviewState({kind:'list',projectId:f.projectId}).reviews,[]);
   assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant,null);
   const read=createReviewReader({storage:f.store as unknown as StoragePort,storeId:f.storeId,offline:false});
   const query=()=>read('review.operation.get',{requestId:pendingId});
   assert.equal(((await query()).operation as {outcome:string}).outcome,'IN_PROGRESS');
   const discard=await f.send('feature.artifact.discard',{requestId:randomUUID(),uploadId:artifactId});
   assert.equal(discard.result,'OK',JSON.stringify(discard));
   assert.equal(f.store.readFeatureState({kind:'artifact',id:artifactId}).artifact?.state,'DISCARDED');
   const successor=startSuccessor(f);
   f.store.commitReviewState({kind:'recover-snapshot',instanceId:successor,requestId:pendingId});
   assert.equal(((await query()).operation as {outcome:string}).outcome,'INTERRUPTED');
 }finally{db.close();}
});
