import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reviewCapabilities,validateReviewParams} from '../../src/protocol/review.js';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {LocalClient} from '../../src/client/local-client.js';
import type {ClientBackend} from '../../src/ports/platform.js';

test('completion and cleanup observations are separate and never imply authorization',()=>{
 const id=randomUUID(),complete={requestId:id,integrationId:id,expectedStateRevision:'4'};
 validateReviewParams('review.complete',complete);
 validateReviewParams('review.receipt.get',{integrationId:id});
 validateReviewParams('review.cleanup.preview',{integrationId:id,workspaceId:id});
 assert.throws(()=>validateReviewParams('review.complete',{...complete,cleanup:true}),/INVALID_REQUEST/);
 assert.throws(()=>validateReviewParams('review.cleanup.preview',{integrationId:id,workspaceId:id,force:true}),/INVALID_REQUEST/);
 assert.throws(()=>reviewCapabilities({reviewVersion:1,reviewMethods:['review.get']},'review.complete'),/UNSUPPORTED_VERSION/);
});

test('completion CLI binds the revision and request and rejects a grant or cleanup selector',async()=>{
 const requestId=randomUUID(),integrationId=randomUUID(),cli=fileURLToPath(new URL('../../src/cli/main.js',import.meta.url));
 const args=['review','complete',integrationId,`--request-id=${requestId}`,'--expected-state-revision=4','--json'];
 for(const flag of [`--grant=${randomUUID()}`,'--force'])await assert.rejects(promisify(execFile)(process.execPath,[cli,...args,flag]),error=>{
   assert.ok(error instanceof Error&&'stdout'in error&&typeof error.stdout==='string');
   assert.equal(JSON.parse(error.stdout).error.code,'INVALID_REQUEST');
   return true;
 });
});

test('headless completion reconciles by UUID without confirming again',async()=>{
 const requestId=randomUUID(),integrationId=randomUUID(),storeId=randomUUID(),instanceId=randomUUID();
 const at='2026-11-20T14:00:00.000Z',seen:unknown[]=[],intent={integrationId,expectedStateRevision:'4'};
 const backend={defaultDirectory:'/tmp/review-fixture',async review(_directory:string,method:string,params:Readonly<Record<string,unknown>>){
   seen.push({method,params});
   if(method==='review.complete')throw new Error('DEADLINE_EXCEEDED');
   return{protocolVersion:1,requestId,storeId,instanceId,result:'OK',outcome:'SUCCEEDED',freshness:'LIVE',liveness:'LIVE_VERIFIED',error:null,
     data:{operation:{namespace:'REVIEW',action:'complete',phase:'FINALIZED',outcome:'SUCCEEDED',requestId,targetId:integrationId,
       acceptedAt:at,completedAt:at,result:{receiptId:requestId,integrationId},error:null}}};
 }} as unknown as ClientBackend;
 const result=await new LocalClient(backend).runReview('review.complete',intent,{requestId});
 assert.equal(result.outcome,'SUCCEEDED');
 assert.deepEqual(seen,[{method:'review.complete',params:{...intent,requestId}},{method:'review.operation.get',params:{requestId}}]);
});
