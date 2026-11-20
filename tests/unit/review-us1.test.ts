import assert from 'node:assert/strict';
import test from 'node:test';
import {partitionReviewDiff,requireCandidateEvidence} from '../../src/domain/review/model.js';

test('review admits the complete bounded diff and evidence for the current tree only',()=>{
 assert.equal(partitionReviewDiff(new Uint8Array(2097152),100).length,8);
 assert.throws(()=>partitionReviewDiff(new Uint8Array(2097153),100),/REVIEW_SCOPE_LIMIT/);
 assert.throws(()=>partitionReviewDiff(new Uint8Array(1),101),/REVIEW_SCOPE_LIMIT/);
 const tree='a'.repeat(40),old='b'.repeat(40),criterionId='required-check';
 const proof={criterionId,treeOid:old,jobId:'fixture',status:'PASS' as const};
 assert.throws(()=>requireCandidateEvidence([criterionId],[proof],tree),/CHECKS_NOT_RUN/);
 assert.throws(()=>requireCandidateEvidence([criterionId],[{...proof,treeOid:tree,jobId:null}],tree),/CHECKS_NOT_RUN/);
 assert.throws(()=>requireCandidateEvidence([criterionId],[{...proof,treeOid:tree,status:'FAIL'}],tree),/CHECKS_FAILED/);
 assert.doesNotThrow(()=>requireCandidateEvidence([criterionId],[{...proof,treeOid:tree}],tree));
});
