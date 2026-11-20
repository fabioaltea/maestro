import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {partitionReviewDiff,requireCandidateEvidence,requireCleanReviewCheckpoint,reviewCheckStatus} from '../../src/domain/review/model.js';
import type {EnvironmentJob} from '../../src/ports/environment.js';

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
 assert.throws(()=>requireCandidateEvidence([criterionId],[{...proof,treeOid:tree},{...proof,treeOid:tree,status:'BLOCKED'}],tree),/CHECKS_NOT_RUN/);
});

test('a review checkpoint must be clean and preserve its seal and plan revision',()=>{
 const baseOid='b'.repeat(40),clean={version:1,baseOid,trackedDiff:'',untracked:[]};
 const digest='a'.repeat(64),tree='c'.repeat(64),revision=randomUUID();
 const expected={digest,tree,revision},checked={digest,tree,revision};
 assert.equal(requireCleanReviewCheckpoint(clean,expected,checked),baseOid);
 for(const dirty of [{...clean,trackedDiff:'changed'},{...clean,untracked:[{path:'new.txt'}]}])
   assert.throws(()=>requireCleanReviewCheckpoint(dirty,expected,checked),/SOURCE_NOT_QUIESCENT/);
 assert.throws(()=>requireCleanReviewCheckpoint({...clean,baseOid:'invalid'},expected,checked),/ARTIFACT_CORRUPT/);
 assert.throws(()=>requireCleanReviewCheckpoint(clean,expected,{...checked,tree:'d'.repeat(64)}),/REVIEW_STALE/);
 assert.throws(()=>requireCleanReviewCheckpoint(clean,expected,{...checked,revision:randomUUID()}),/REVIEW_STALE/);
});

test('exit zero alone does not establish a complete check for the approved command and tree',()=>{
 const at='2026-11-20T12:00:00.000Z',planId=randomUUID(),commandSpecId=randomUUID(),jobId=randomUUID(),inputDigest='a'.repeat(64);
 const job:EnvironmentJob={jobId,requestId:jobId,environmentId:randomUUID(),planId,kind:'VALIDATE',commandSpecId,inputDigest,
   generation:randomUUID(),leaseId:randomUUID(),phase:'SUCCEEDED',stateRevision:'3',cancelRequestId:null,outputWatermark:'1',truncated:false,
   exitProof:{verified:true,code:0,reason:null},safeError:null,createdAt:at,completedAt:at};
 const scope={jobId,planId,commandSpecId,inputDigest,treeOid:'b'.repeat(40)};
 assert.equal(reviewCheckStatus(scope,null,scope.treeOid),'NOT_RUN');
 for(const incomplete of [{...job,truncated:true},{...job,exitProof:null},{...job,outputWatermark:'0'},
   {...job,completedAt:null},{...job,commandSpecId:randomUUID()},{...job,inputDigest:'c'.repeat(64)}])
   assert.equal(reviewCheckStatus(scope,incomplete,scope.treeOid),'BLOCKED');
 assert.equal(reviewCheckStatus(scope,job,'d'.repeat(40)),'BLOCKED');
 assert.equal(reviewCheckStatus(scope,{...job,phase:'FAILED',exitProof:{verified:true,code:1,reason:'CHECKS_FAILED'}},scope.treeOid),'FAIL');
 assert.equal(reviewCheckStatus(scope,job,scope.treeOid),'PASS');
});
