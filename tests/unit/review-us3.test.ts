import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';

const domain='../../src/domain/review/completion.js';
test('receipt finalization depends on the attributed result and current documentation',async()=>{
 const {reviewCompletion,reviewCleanupCheck}=await import(domain),now=1800000000000;
 const old='a'.repeat(40),source='b'.repeat(40),candidate='c'.repeat(40),documentationDigest='d'.repeat(64);
 const record={integrationId:randomUUID(),reviewId:randomUUID(),workspaceId:randomUUID(),projectId:randomUUID(),
   sourceOid:source,targetRef:'refs/heads/review-target',expectedTargetOid:old,candidateOid:candidate,documentationDigest};
 const proof={old,candidate,guardSynced:true};
 const good=reviewCompletion(record,{observedTargetOid:candidate,proof,documentationDigest,contextImpact:'UNCHANGED'});
 assert.equal(good.contextFreshness,'LAST_KNOWN');
 const changed=reviewCompletion(record,{observedTargetOid:candidate,proof,documentationDigest:'e'.repeat(64),contextImpact:'UNCHANGED'});
 assert.equal(changed.contextFreshness,'STALE');
 assert.throws(()=>reviewCompletion(record,{observedTargetOid:source,proof,documentationDigest,contextImpact:'UNKNOWN'}),/INTEGRATION_UNKNOWN/);
 assert.equal(good.publicationGrantRequired,true);
 const clean={tracked:false,untracked:false,ignored:false,conflicts:false};
 const cleanup={checkedAt:now,expiresAt:now+1000,headOid:source,observedTargetOid:candidate,state:'READY',holder:false,effect:false,
   integrated:true,status:clean};
 assert.equal(reviewCleanupCheck(good,cleanup,now).cleanupGrantRequired,true);
 assert.throws(()=>reviewCleanupCheck(good,cleanup,now+1000),/APPROVAL_STALE/);
 assert.throws(()=>reviewCleanupCheck(good,{...cleanup,headOid:'f'.repeat(40)},now),/UNINTEGRATED_WORK/);
 assert.throws(()=>reviewCleanupCheck(good,{...cleanup,status:{...clean,untracked:true}},now),/UNINTEGRATED_WORK/);
});
