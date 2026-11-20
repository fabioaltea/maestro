import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

test('failed review admission rolls back the request and leaves its exact grant unconsumed',async t=>{
 const f=await workspaceAuthoringFixture(t),grantId=randomUUID(),requestId=randomUUID(),now=Date.now();
 const canonicalIntent=canonicalWorkflowIntent({
   version:1,namespace:'REVIEW',action:'request-changes',storeId:f.storeId,ownerUid:f.paths.ownerUid,targetId:randomUUID(),
   projectId:f.projectId,expectedRevision:'1',configRevision:null,payload:{digest:'d'.repeat(64),feedbackArtifactId:randomUUID()},
 });
 f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+1000,consumedByRequestId:null}});
 const admission={requestId,grantId,canonicalIntent,instanceId:f.instanceId,nowMs:now};
 assert.throws(()=>f.store.commitReviewState({kind:'request-changes',admission}),/REVIEW_STALE/);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
});
