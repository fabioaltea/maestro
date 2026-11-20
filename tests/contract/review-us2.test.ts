import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reviewCapabilities,validateReviewParams} from '../../src/protocol/review.js';

test('candidate and integrate validate the qualified method and never accept force or a ref path on confirm',()=>{
 const id=randomUUID();
 validateReviewParams('review.integrate',{requestId:id,grantId:id});
 for(const field of ['force','path','expectedTargetOid'])
   assert.throws(()=>validateReviewParams('review.integrate',{requestId:id,grantId:id,[field]:true}),/INVALID_REQUEST/);
 assert.throws(()=>reviewCapabilities({reviewVersion:1,reviewMethods:['review.create','review.get']},'review.integrate'),/UNSUPPORTED_VERSION/);
});

test('candidate, approval and ref change prepare close the exact review scope',()=>{
 const reviewId=randomUUID(),candidateId=randomUUID(),decisionId=randomUUID(),hash='a'.repeat(64),oid='b'.repeat(40);
 const revisions={stateRevision:'7'};
 const actions=[['candidate.prepare',{reviewId,expectedStateRevision:'7'}],['approve',{reviewId,candidateId,evidenceDigest:hash}],
   ['integrate',{candidateId,decisionId,expectedTargetOid:oid}]] as const;
 for(const [action,intent] of actions){
   const params={action,intent,expectedRevisions:revisions};
   assert.doesNotThrow(()=>validateReviewParams('review.prepare',params));
   assert.throws(()=>validateReviewParams('review.prepare',{...params,intent:{...intent,force:true}}),/INVALID_REQUEST/);
   assert.throws(()=>validateReviewParams('review.prepare',{...params,expectedRevisions:{stateRevision:'0'}}),/INVALID_REQUEST/);
 }
 assert.throws(()=>validateReviewParams('review.prepare',{action:'candidate.prepare',intent:{reviewId,expectedStateRevision:'6'},expectedRevisions:revisions}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.prepare',{action:'approve',intent:{reviewId,candidateId,evidenceDigest:oid},expectedRevisions:revisions}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.prepare',{action:'integrate',intent:{candidateId,decisionId,expectedTargetOid:'HEAD'},expectedRevisions:revisions}),/INVALID_REQUEST/);
});
