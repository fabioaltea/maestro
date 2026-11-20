import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reviewCapabilities,validateReviewParams} from '../../src/protocol/review.js';
import {LocalClient} from '../../src/client/local-client.js';
import type {ClientBackend} from '../../src/ports/platform.js';

test('candidate and integrate validate the qualified method and never accept force or a ref path on confirm',()=>{
 const id=randomUUID();
 validateReviewParams('review.integrate',{requestId:id,grantId:id});
 for(const field of ['force','path','expectedTargetOid'])
   assert.throws(()=>validateReviewParams('review.integrate',{requestId:id,grantId:id,[field]:true}),/INVALID_REQUEST/);
 assert.throws(()=>reviewCapabilities({reviewVersion:1,reviewMethods:['review.create','review.get']},'review.integrate'),/UNSUPPORTED_VERSION/);
});

test('headless integration queries the original UUID after a lost reply',async()=>{
 const requestId=randomUUID(),grantId=randomUUID(),targetId=randomUUID(),storeId=randomUUID(),instanceId=randomUUID();
 const at='2026-11-20T11:00:00.000Z',resultingOid='c'.repeat(40),seen:unknown[]=[];
 const backend={defaultDirectory:'/tmp/review-fixture',async review(_directory:string,method:string,params:Readonly<Record<string,unknown>>){
   seen.push({method,params});
   if(method==='review.integrate')throw new Error('DEADLINE_EXCEEDED');
   return{protocolVersion:1,requestId,storeId,instanceId,result:'OK',outcome:'SUCCEEDED',freshness:'LIVE',liveness:'LIVE_VERIFIED',error:null,
     data:{operation:{namespace:'REVIEW',action:'integrate',phase:'FINALIZED',outcome:'SUCCEEDED',requestId,targetId,
       acceptedAt:at,completedAt:at,result:{integrationId:requestId,resultingOid},error:null}}};
 }} as unknown as ClientBackend;
 const result=await new LocalClient(backend).runReview('review.integrate',{grantId},{requestId});
 assert.equal(result.outcome,'SUCCEEDED');
 assert.deepEqual(seen,[{method:'review.integrate',params:{grantId,requestId}},{method:'review.operation.get',params:{requestId}}]);
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
