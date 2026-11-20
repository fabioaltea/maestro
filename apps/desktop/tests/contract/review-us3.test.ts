import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCliArgs,decodeResult} from '../../src/main/core-cli.ts';
import {ArchiveContext} from '../../src/main/archive-context.ts';
import {ArchiveReader} from '../../src/main/read-handlers.ts';
import {validateRequest} from '../../src/shared/validation.ts';
import {validateReviewData} from '../../src/shared/review-contract.ts';

test('Desktop completion uses a closed confirmation scoped to an integration and revision',()=>{
 const params={action:'complete',projectId:randomUUID(),reviewId:randomUUID(),integrationId:randomUUID(),stateRevision:'4'};
 const request={bridgeVersion:1,callId:randomUUID(),selectionEpoch:1,params};
 validateRequest('prepareReviewAction',request);
 assert.throws(()=>validateRequest('prepareReviewAction',{...request,params:{...params,grantId:randomUUID()}}));
 const command={namespace:'review' as const,action:'complete',requestId:randomUUID(),archive:'/tmp/archive',
   params:{integrationId:params.integrationId,expectedStateRevision:'4'}};
 assert.deepEqual(buildCliArgs(command).slice(4),[`--request-id=${command.requestId}`,'--expected-state-revision=4','--',params.integrationId]);
 assert.throws(()=>buildCliArgs({...command,params:{...command.params,force:true}}));
});

test('stored receipts bind the integration and only live cleanup observations can permit a separate grant',()=>{
 const params={integrationId:randomUUID(),workspaceId:randomUUID()},candidate='b'.repeat(40),targetRef='refs/heads/main';
 const receipt={...params,receiptId:randomUUID(),reviewId:randomUUID(),projectId:randomUUID(),featureRevisionId:randomUUID(),
   sourceOid:candidate,targetRef,expectedTargetOid:'a'.repeat(40),candidateOid:candidate,resultingOid:candidate,treeOid:'c'.repeat(40),
   evidenceDigest:'d'.repeat(64),documentationDigest:'e'.repeat(64),documentCount:1,documents:[{path:'docs/review.md',blobOid:'f'.repeat(40)}],
   documentsTruncated:false,contextFreshness:'STALE',publicationGrantRequired:true};
 const stored={freshness:'LAST_KNOWN',receipt};
 assert.deepEqual(validateReviewData('receipt',stored,params),stored);
 assert.throws(()=>validateReviewData('receipt',{...stored,receipt:{...receipt,integrationId:randomUUID()}},params));
 assert.throws(()=>validateReviewData('receipt',{...stored,receipt:{...receipt,publicationGrantRequired:false}},params));
 const cleanup={...params,freshness:'CURRENT',targetRef,targetOid:candidate,checkedAt:'2026-11-20T14:00:00.000Z',
   eligible:true,reason:null,cleanupGrantRequired:true};
 assert.deepEqual(validateReviewData('cleanup.preview',cleanup,params),cleanup);
 assert.throws(()=>validateReviewData('cleanup.preview',{...cleanup,freshness:'LAST_KNOWN'},params));
 assert.throws(()=>validateReviewData('cleanup.preview',{...cleanup,workspaceId:randomUUID()},params));
 const result={protocolVersion:1,requestId:null,storeId:randomUUID(),instanceId:null,result:'OK',outcome:null,
   freshness:'LAST_KNOWN',liveness:'ABSENT_VERIFIED',data:cleanup,error:null};
 assert.throws(()=>decodeResult(JSON.stringify(result),{namespace:'review',action:'cleanup.preview',archive:'/tmp/archive',params}));
});

test('a receipt returned after changing archives is discarded',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'maestro-review-bridge-'));
 try{
   const context=new ArchiveContext(),first=await context.select(join(dir,'first'));
   const integrationId=randomUUID();
   const reply=Promise.withResolvers<never>();
   const reader=new ArchiveReader(context,{async call(command){
     assert.deepEqual(command,{namespace:'review',action:'receipt',archive:first.path,params:{integrationId},scope:'view'});
     return reply.promise;
   },close(){}});
   const pending=reader.read('getReviewReceipt',{integrationId});
   await context.select(join(dir,'second'));
   reply.resolve({storeId:null} as never);
   await assert.rejects(pending,/STALE_CONTEXT/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
