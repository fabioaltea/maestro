import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {executionRuntimeFixture} from '../fixtures/execution-runtime.js';
import {verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createReviewRuntime,nativeReviewGit} from '../../src/core/review/runtime.js';
import type {DiscoveryEligibility} from '../../src/domain/discovery/approval.js';
import {makeDeadline,systemClock} from '../../src/ports/clock.js';

test('a reviewed clean checkpoint yields a sealed exact diff, and a late edit invalidates a second grant',async t=>{
 const f=await executionRuntimeFixture(t);
 const run=await f.mutate('start',await f.prepare('start',f.startIntent));
 await f.runtime.idle();
 assert.equal(f.state(run.requestId)?.state,'READY_FOR_REVIEW');
 const workspace=f.store.readWorkspaceState({kind:'get',id:f.startIntent.workspaceId}).workspace!;
 const path=workspace.ownership!.root.canonicalPath,targetRef='refs/heads/review-target';
 const targetOid=(await f.repositories.git(path,['rev-parse','HEAD'])).trim();
 await f.repositories.git(path,['branch','review-target',targetOid]);
 await f.repositories.git(path,['add','--','approved.txt','package.json','package-lock.json']);
 await f.repositories.git(path,['commit','-m','fixture review snapshot']);
 const revision=f.state(run.requestId)!.stateRevision;
 const checkpoint=await f.mutate('checkpoint',await f.prepare('checkpoint',{sessionId:run.requestId,expectedStateRevision:revision},{stateRevision:revision}));
 assert.equal(checkpoint.operation?.outcome,'SUCCEEDED');
 const native=nativeReviewGit(f.mutator,record=>verifyOwnedWorktree(f,f.storeId,record));
 let pause:ReturnType<typeof Promise.withResolvers<void>>|undefined;
 const entered=Promise.withResolvers<void>();
 let comparisons=0;
 const rt=createReviewRuntime({storage:f.storage,paths:f.paths,instanceId:f.instanceId,
   currentEligibility:(peer,projectId)=>f.service.currentEligibility(peer,projectId) as Promise<DiscoveryEligibility>,
   readGit:{...native,async captureCheckpoint(record){
     comparisons++;
     if(pause){entered.resolve();await pause.promise;}
     return native.captureCheckpoint(record);
   }},
 });
 rt.start();
 const call=(name:string,params:Record<string,unknown>)=>rt.dispatch({protocolVersion:1,method:`review.${name}`,params,correlationId:randomUUID()},
   f.peer,f.store.readSnapshot()!);
 const input={action:'create',intent:{featureId:f.startIntent.featureId,checkpointId:checkpoint.requestId,targetRef,targetOid},expectedRevisions:{}};
 const first=await call('prepare',input),second=await call('prepare',input);
 assert.equal(first.result,'OK',JSON.stringify(first));assert.equal(second.result,'OK',JSON.stringify(second));
 const requestId=randomUUID(),params={requestId,grantId:(first.data as {grantId:string}).grantId};
 const previousComparisons=comparisons;
 const [created,concurrent]=await Promise.all([call('create',params),call('create',params)]);
 assert.equal(created.result,'OK',JSON.stringify(created));
 assert.deepEqual(concurrent.data,created.data);
 assert.equal(comparisons-previousComparisons,1);
 const original=await call('create',params);
 assert.deepEqual(original.data,created.data);
 const {review}=f.store.readReviewState({kind:'review',id:requestId});
 assert.equal(review?.fileCount,3);
 assert.ok(review?.parts[0]);
 const events=f.store.listEvents({limit:1000}).records.filter(event=>event.operationId===requestId);
 const changes=events.filter(event=>event.type.startsWith('review.'));
 assert.deepEqual(changes.map(event=>event.type),['review.changed','review.output.available']);
 assert.equal(changes[0]?.payload.reviewId,requestId);
 assert.equal(changes[1]?.payload.watermark,String(review.parts.length));
 assert.ok(changes.every(event=>event.instanceId===f.instanceId&&!JSON.stringify(event).includes(targetRef)));
 const artifact=await call('artifact.get',{artifactId:review.parts[0].artifactId});
 const diff=Buffer.from((artifact.data as {base64:string}).base64,'base64').toString();
 assert.match(diff,/diff --git a\/approved.txt b\/approved.txt/);
 const fencedGrant=await call('prepare',input);
 assert.equal(fencedGrant.result,'OK');
 await writeFile(join(path,'approved.txt'),'late local edit');
 const stale=await call('create',{requestId:randomUUID(),grantId:(second.data as {grantId:string}).grantId});
 assert.equal((stale.data as {code:string}).code,'REVIEW_STALE');
 assert.equal((await call('get',{reviewId:requestId})).result,'OK');
 const feedbackArtifactId=await f.uploadInput('Aggiungere una verifica.',f.startIntent.featureId);
 const feedback=await call('prepare',{action:'request-changes',intent:{reviewId:requestId,feedbackArtifactId},expectedRevisions:{stateRevision:'1'}});
 assert.equal(feedback.result,'OK',JSON.stringify(feedback));
 const feedbackId=randomUUID(),grantId=(feedback.data as {grantId:string}).grantId;
 const backlog=f.database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records:string};
 f.database.prepare("UPDATE event_outbox SET records='[{}]' WHERE singleton=1").run();
 try{
   const blocked=await call('request-changes',{requestId:feedbackId,grantId});
   assert.equal((blocked.data as {code:string}).code,'EVENT_BACKPRESSURE');
   assert.equal((await call('operation.get',{requestId})).result,'OK');
   assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
 }finally{f.database.prepare('UPDATE event_outbox SET records=? WHERE singleton=1').run(backlog.records);}
 await unlink(join(f.paths.directory,'workflow','objects',feedbackArtifactId));
 const result=await call('request-changes',{requestId:feedbackId,grantId});
 assert.equal((result.data as {code:string}).code,'ARTIFACT_CORRUPT');
 assert.equal(f.store.readFeatureState({kind:'operation',id:feedbackId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
 await f.repositories.git(path,['checkout','--','approved.txt']);
 pause=Promise.withResolvers<void>();
 const fencedId=randomUUID(),fenced=call('create',{requestId:fencedId,grantId:(fencedGrant.data as {grantId:string}).grantId});
 await Promise.race([entered.promise,fenced.then(result=>assert.fail(JSON.stringify(result)))]);
 const stopped=rt.stop(makeDeadline(systemClock,10000));
 pause.resolve();
 assert.equal(((await fenced).data as {code:string}).code,'BLOCKED');
 await stopped;
 assert.equal(f.store.readFeatureState({kind:'operation',id:fencedId}).operation,null);
 assert.deepEqual((await call('operation.get',{requestId})).data,{...(created.data as Record<string,unknown>),freshness:'CURRENT'});
});
