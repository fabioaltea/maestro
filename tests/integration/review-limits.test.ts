import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {redactEventDraft} from '../../src/protocol/events.js';

test('review outbox strips diff text, arbitrary paths and ref details',()=>{
 const reviewId=randomUUID(),operationId=randomUUID();
 const record=redactEventDraft({type:'review.changed',operationId,
   payload:{scope:'review',reviewId,state:'DRAFT',stateRevision:'1',action:'create',diff:'private',path:'/tmp/source',targetRef:'refs/heads/fixture'}});
 assert.equal(record.operationId,operationId);
 assert.deepEqual(record.payload,{scope:'review',reviewId,state:'DRAFT',stateRevision:'1',action:'create',truncated:true,redactedFields:3});
});

test('the shared budget counts review metadata and preserves bounded reads',async t=>{
 const [{default:Database},{workspaceAuthoringFixture},{canonicalWorkflowIntent}]=await Promise.all([
   import('better-sqlite3'),import('../fixtures/workspace-authoring.js'),import('../../src/domain/workflow/authorization.js'),
 ]);
 const f=await workspaceAuthoringFixture(t),db=new Database(f.paths.stateFile);
 try{
   db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'BUNDLE',1,?,?,'SEALED',?)")
     .run(randomUUID(),'a'.repeat(64),122*1024*1024,Date.now());
   const canonicalIntent=canonicalWorkflowIntent({version:1,namespace:'REVIEW',action:'create',storeId:f.storeId,ownerUid:f.paths.ownerUid,
     targetId:randomUUID(),projectId:f.projectId,expectedRevision:'1',configRevision:'1',payload:{}});
   const grantId=randomUUID(),now=Date.now();
   assert.throws(()=>f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,
     expiresAtMs:now+60000,consumedByRequestId:null}}),/RESOURCE_LIMIT/);
   assert.deepEqual(f.store.readReviewState({kind:'list',projectId:f.projectId}).reviews,[]);
   assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant,null);
 }finally{db.close();}
});
