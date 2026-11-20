import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {reviewIntegrationFixture} from '../fixtures/review-integration.js';
import {createReviewRuntime} from '../../src/core/review/runtime.js';
import {createReviewReader} from '../../src/core/review/read.js';
import {createWorkspaceCleanup} from '../../src/core/workspaces/remove.js';
import type {ReviewReceiptRecord} from '../../src/ports/review.js';

test('completion keeps one receipt, marks the approved context stale and previews cleanup without losing new work',async t=>{
 const {f,candidate,reviewId,integrationId,instanceId,options,call,data,workspaceId,stagePath}=await reviewIntegrationFixture(t);
 let failure:'before'|'after'|null=null;
 const storage=new Proxy(f.storage,{get(target,key){
   if(key!=='commitReviewState')return Reflect.get(target,key);
   return async(change:Parameters<NonNullable<typeof f.storage.commitReviewState>>[0])=>{
     const point=change.kind==='complete'?failure:null;
     if(point)failure=null;
     if(point==='before')throw new Error('DEADLINE_EXCEEDED');
     const result=await f.storage.commitReviewState!(change);
     if(point==='after')throw new Error('DEADLINE_EXCEEDED');
     return result;
   };
 }});
 const rt=createReviewRuntime({...options,storage,instanceId,integration:{...options.integration,workspaceGit:f.mutator},
   runCheck:async()=>assert.fail('completion must not launch any checks')});
 rt.start();
 const requestId=randomUUID(),params={integrationId,requestId,expectedStateRevision:f.store.readReviewState({kind:'review',id:reviewId}).review!.stateRevision};
 const complete=()=>call(rt,'review.complete',params);
 const revision=f.store.readFeatureState({kind:'revision',id:f.store.readReviewState({kind:'review',id:reviewId}).review!.featureRevisionId}).revision!;
 const approved=f.store.readDiscoveryMetadata({kind:'approval',id:revision.discoveryRevisionId});
 assert.ok(approved.ok&&approved.value.data);
 const checked=()=>f.store.readDiscoveryMetadata({kind:'discovery',id:approved.value.data!.discoveryId});
 failure='before';
 assert.equal(((await complete()).data as {code:string}).code,'DEADLINE_EXCEEDED');
 assert.equal(f.store.readReviewState({kind:'receipt',id:integrationId}).receipt,null);
 const previous=checked();assert.ok(previous.ok);assert.equal(previous.value.data?.state,'APPROVED');
 failure='after';
 assert.equal(((await complete()).data as {code:string}).code,'DEADLINE_EXCEEDED');
 const receipt=data(await call(rt,'review.receipt.get',{integrationId})).receipt as ReviewReceiptRecord;
 assert.equal(receipt.receiptId,requestId);
 assert.equal(receipt.resultingOid,candidate.candidateOid);
 assert.equal(receipt.contextFreshness,'STALE');
 assert.equal(receipt.publicationGrantRequired,true);
 assert.ok(receipt.documents.some(doc=>doc.path==='REVIEW.md'&&doc.blobOid));
 const current=checked();assert.ok(current.ok);assert.equal(current.value.data?.state,'STALE');
 const retry=await Promise.all([complete(),complete()]);
 assert.deepEqual(retry[0]?.data,retry[1]?.data);
 const offline=createReviewReader({storage,storeId:f.storeId,offline:true});
 assert.equal((await offline('review.receipt.get',{integrationId})).freshness,'LAST_KNOWN');
 const clean=data(await call(rt,'review.cleanup.preview',{integrationId,workspaceId}));
 assert.equal(clean.eligible,true);
 const jobs:Promise<void>[]=[],cleanup=createWorkspaceCleanup({storage,instanceId,paths:f.paths,mutator:f.mutator,files:f.files,
   accepting:()=>true,schedule:work=>{jobs.push(work());}});
 const consent=await cleanup.actions['workspace.cleanup.prepare']({workspaceId,targetRef:clean.targetRef,targetOid:clean.targetOid},f.peer);
 await writeFile(join(stagePath,'later.txt'),'new local work\n');
 await f.repositories.git(stagePath,['add','--','later.txt']);
 await f.repositories.git(stagePath,['commit','-m','new work after integration']);
 const changed=data(await call(rt,'review.cleanup.preview',{integrationId,workspaceId}));
 assert.equal(changed.eligible,false);
 assert.equal(changed.reason,'UNINTEGRATED_WORK');
 const removeId=randomUUID();
 await cleanup.actions['workspace.remove']({requestId:removeId,grantId:consent.grantId,
   expectedStateRevision:f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!.stateRevision},f.peer);
 await Promise.all(jobs);
 const refused=f.store.readFeatureState({kind:'operation',id:removeId}).operation;
 assert.equal(refused?.outcome,'BLOCKED');assert.equal(refused?.error,'UNINTEGRATED_WORK');
 assert.equal(await readFile(join(stagePath,'later.txt'),'utf8'),'new local work\n');
 assert.equal(f.store.readReviewState({kind:'receipt',id:integrationId}).receipt?.publicationGrantRequired,true);
});
