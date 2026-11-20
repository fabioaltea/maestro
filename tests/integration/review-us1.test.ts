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
import type {ReviewChange,ReviewRecovery} from '../../src/ports/review.js';
import {featureDraft} from '../fixtures/feature-boundary.js';
import {fixtureLock} from '../fixtures/environment-registry.js';
import {fixtureRegistry,fixturePackage,fixtureVersion} from '../fixtures/environment-boundary.js';
import {createEnvironmentRuntime,nativeEnvironmentServices} from '../../src/core/environments/runtime.js';
import {createWorkspaceLeases} from '../../src/core/workspaces/leases.js';
import {startSuccessor} from '../fixtures/workspace-runtime.js';

test('a reviewed clean checkpoint yields a sealed exact diff, and a late edit invalidates a second grant',async t=>{
 const commandSpecId=randomUUID(),verification=`command:${commandSpecId}`,draft=featureDraft();
 const f=await executionRuntimeFixture(t,{bundle:{...draft,acceptanceCriteria:draft.acceptanceCriteria.map(criterion=>({...criterion,verification}))}});
 const run=await f.mutate('start',await f.prepare('start',f.startIntent));
 await f.runtime.idle();
 assert.equal(f.state(run.requestId)?.state,'READY_FOR_REVIEW');
 const workspace=f.store.readWorkspaceState({kind:'get',id:f.startIntent.workspaceId}).workspace!;
 const path=workspace.ownership!.root.canonicalPath,targetRef='refs/heads/review-target';
 const targetOid=(await f.repositories.git(path,['rev-parse','HEAD'])).trim();
 await f.repositories.git(path,['branch','review-target',targetOid]);
 const registry=await fixtureRegistry(t);
 await unlink(join(path,'package-lock.json'));
 await writeFile(join(path,'.gitignore'),'node_modules/\n');
 await writeFile(join(path,'pnpm-lock.yaml'),fixtureLock(registry));
 await writeFile(join(path,'package.json'),JSON.stringify({name:'review-fixture',packageManager:`pnpm@${fixtureVersion}`,
   dependencies:{[fixturePackage]:'1.0.0'},maestro:{validation:[{id:commandSpecId,entry:'review.mjs',argv:[],timeoutMs:10000}]}}));
 await writeFile(join(path,'review.mjs'),"import {readFileSync} from 'node:fs'; if (!readFileSync('approved.txt','utf8')) process.exit(1);\n");
 await f.repositories.git(path,['add','--','.gitignore','approved.txt','package.json','pnpm-lock.yaml','review.mjs']);
 await f.repositories.git(path,['commit','-m','fixture review snapshot']);
 const revision=f.state(run.requestId)!.stateRevision;
 const checkpoint=await f.mutate('checkpoint',await f.prepare('checkpoint',{sessionId:run.requestId,expectedStateRevision:revision},{stateRevision:revision}));
 assert.equal(checkpoint.operation?.outcome,'SUCCEEDED');
 const native=nativeReviewGit(f.mutator,record=>verifyOwnedWorktree(f,f.storeId,record));
 const workspaceLeases=createWorkspaceLeases({...f,storage:f.storage,instanceId:f.instanceId,accepting:()=>true});
 const environments=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:nativeEnvironmentServices({
   storage:f.storage,paths:f.paths,instanceId:f.instanceId,owned:workspaceLeases.owned,lease:workspaceLeases.forConsumer('ENVIRONMENT'),
   readValidationTree:async record=>(await native.captureCheckpoint(record)).treeDigest,
 })});
 await environments.recover();
 let pause:ReturnType<typeof Promise.withResolvers<void>>|undefined;
 const entered=Promise.withResolvers<void>();
 let comparisons=0;
 let fault:'before'|'after'|'after-validation'|null=null;
 const reviewStorage=new Proxy(f.storage,{get(target,key){
   if(key!=='commitReviewState')return Reflect.get(target,key);
   return async(change:ReviewChange|ReviewRecovery)=>{
     const point=change.kind==='create'&&fault!=='after-validation'?fault:change.kind==='validate-admit'&&fault==='after-validation'?fault:null;
     if(point)fault=null;
     if(point==='before')throw new Error('DEADLINE_EXCEEDED');
     const result=await f.storage.commitReviewState!(change);
     if(point==='after'||point==='after-validation')throw new Error('DEADLINE_EXCEEDED');
     return result;
   };
 }});
 const rt=createReviewRuntime({storage:reviewStorage,paths:f.paths,instanceId:f.instanceId,
   currentEligibility:(peer,projectId)=>f.service.currentEligibility(peer,projectId) as Promise<DiscoveryEligibility>,
   readGit:{...native,async captureCheckpoint(record){
     comparisons++;
     if(pause){entered.resolve();await pause.promise;}
     return native.captureCheckpoint(record);
   }},runCheck:environments.runDelegatedCheck!,
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
 assert.equal(review?.fileCount,5);
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
 const failureGrant=await call('prepare',input),retryId=randomUUID();
 assert.equal(failureGrant.result,'OK');
 const retry={requestId:retryId,grantId:(failureGrant.data as {grantId:string}).grantId};
 const reservedBefore=f.store.readFeatureState({kind:'budget'}).budget!;
 fault='before';
 assert.equal(((await call('create',retry)).data as {code:string}).code,'DEADLINE_EXCEEDED');
 assert.equal(f.store.readFeatureState({kind:'operation',id:retryId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:retry.grantId}).grant?.consumedByRequestId,null);
 assert.equal(f.store.readFeatureState({kind:'budget'}).budget?.allocatedBytes,reservedBefore.allocatedBytes);
 fault='after';
 assert.equal(((await call('create',retry)).data as {code:string}).code,'DEADLINE_EXCEEDED');
 const committed=await call('operation.get',{requestId:retryId});
 assert.equal(committed.result,'OK');
 assert.equal((await call('create',retry)).result,'OK');
 const detail=await call('get',{reviewId:retryId});
 assert.equal(detail.result,'OK');
 assert.deepEqual((detail.data as {criteria:unknown}).criteria,[{
   criterionId:'AC1',storyId:'US1',text:'Status is visible offline',verification,required:true,status:'NOT_RUN',
 }]);
 const fencedGrant=await call('prepare',input);
 assert.equal(fencedGrant.result,'OK');
 pause=Promise.withResolvers<void>();
 const fencedId=randomUUID(),fenced=call('create',{requestId:fencedId,grantId:(fencedGrant.data as {grantId:string}).grantId});
 await Promise.race([entered.promise,fenced.then(result=>assert.fail(JSON.stringify(result)))]);
 const stopped=rt.stop(makeDeadline(systemClock,10000));
 pause.resolve();
 assert.equal(((await fenced).data as {code:string}).code,'BLOCKED');
 await stopped;
 assert.equal(f.store.readFeatureState({kind:'operation',id:fencedId}).operation,null);
 assert.deepEqual((await call('operation.get',{requestId})).data,{...(created.data as Record<string,unknown>),freshness:'CURRENT'});
 pause=undefined;
 rt.start();
 const env=(name:string,params:Record<string,unknown>)=>environments.dispatch({protocolVersion:1,method:`environment.${name}`,params,correlationId:randomUUID()},
   f.peer,f.store.readSnapshot()!);
 const workspaceId=workspace.workspaceId,currentWorkspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 const planId=randomUUID(),planned=await env('plan',{requestId:planId,workspaceId,expectedStateRevision:currentWorkspace.stateRevision});
 assert.equal(planned.result,'OK',JSON.stringify(planned));
 await environments.idle();
 const environment=f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment!;
 const plan=f.store.readEnvironmentState({kind:'plan',id:planId}).plan!;
 const installation=await env('prepare',{action:'prepare',intent:{planId,planDigest:plan.digest},expectedRevisions:{stateRevision:environment.stateRevision}});
 assert.equal(installation.result,'OK',JSON.stringify(installation));
 const install=await env('prepare',{requestId:randomUUID(),grantId:(installation.data as {grantId:string}).grantId});
 assert.equal(install.result,'OK',JSON.stringify(install));
 await environments.idle();
 const validation={action:'validate',intent:{reviewId:requestId,commandSpecIds:[commandSpecId]},expectedRevisions:{stateRevision:'1'}};
 const check=await call('prepare',validation);
 assert.equal(check.result,'OK',JSON.stringify(check));
 const checkId=randomUUID(),checkGrant=(check.data as {grantId:string}).grantId;
 const [submitted,duplicate]=await Promise.all([call('validate',{requestId:checkId,grantId:checkGrant}),
   call('validate',{requestId:checkId,grantId:checkGrant})]);
 assert.equal(submitted.result,'OK',JSON.stringify(submitted));
 assert.deepEqual(duplicate.data,submitted.data);
 await rt.idle();
 const validated=await call('operation.get',{requestId:checkId});
 assert.equal(validated.result,'OK',JSON.stringify(validated));
 const proof=(await call('get',{reviewId:requestId})).data as {criteria:{status:string;evidence:{treeOid:string;jobId:string;outputId:string}}[]};
 assert.equal(proof.criteria[0]?.status,'PASS');
 assert.equal(proof.criteria[0]?.evidence.treeOid,review.sourceTreeOid);
 const spec=f.store.readEnvironmentState({kind:'job',id:proof.criteria[0]!.evidence.jobId}).job;
 assert.equal(spec?.commandSpecId,commandSpecId);
 assert.equal((await call('artifact.get',{artifactId:proof.criteria[0]!.evidence.outputId})).result,'OK');
 const comment='Aggiungere una prova sul risultato.';
 const changeArtifactId=await f.uploadInput(comment,f.startIntent.featureId);
 const correction=await call('prepare',{action:'request-changes',intent:{reviewId:retryId,feedbackArtifactId:changeArtifactId},expectedRevisions:{stateRevision:'1'}});
 assert.equal(correction.result,'OK',JSON.stringify(correction));
 const reviewDecisionId=randomUUID(),decisionGrant=(correction.data as {grantId:string}).grantId;
 assert.equal((await call('request-changes',{requestId:reviewDecisionId,grantId:decisionGrant})).result,'OK');
 assert.deepEqual(f.receivedFeedback,[]);
 const unapproved=await f.mutate('start',decisionGrant);
 assert.equal((unapproved.reply.data as {code:string}).code,'APPROVAL_REQUIRED');
 const approved=await f.prepare('start',{...f.startIntent,reviewDecisionId});
 const corrected=await f.mutate('start',approved);
 await f.runtime.idle();
 assert.equal(f.state(corrected.requestId)?.state,'READY_FOR_REVIEW');
 assert.deepEqual(f.receivedFeedback,[comment]);
 const again=await call('prepare',{...validation,expectedRevisions:{stateRevision:'3'}});
 assert.equal(again.result,'OK',JSON.stringify(again));
 await writeFile(join(path,'approved.txt'),'late local edit');
 const stale=await call('create',{requestId:randomUUID(),grantId:(second.data as {grantId:string}).grantId});
 assert.equal((stale.data as {code:string}).code,'REVIEW_STALE');
 const staleCheck=await call('validate',{requestId:randomUUID(),grantId:(again.data as {grantId:string}).grantId});
 assert.equal((staleCheck.data as {code:string}).code,'REVIEW_STALE');
 assert.equal((await call('get',{reviewId:requestId})).result,'OK');
 const feedbackArtifactId=await f.uploadInput('Aggiungere una verifica.',f.startIntent.featureId);
 const feedback=await call('prepare',{action:'request-changes',intent:{reviewId:requestId,feedbackArtifactId},expectedRevisions:{stateRevision:'3'}});
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
 const interruptedId=randomUUID();
 fault='after-validation';
 const uncertain=await call('validate',{requestId:interruptedId,grantId:(again.data as {grantId:string}).grantId});
 assert.equal((uncertain.data as {code:string}).code,'DEADLINE_EXCEEDED');
 const pending=f.store.readFeatureState({kind:'operation',id:interruptedId}).operation!;
 assert.equal(pending.phase,'WORKING');
 const pendingJob=(pending.result?.jobIds as string[])[0]!;
 assert.equal(f.store.readEnvironmentState({kind:'job',id:pendingJob}).job,null);
 const successor=startSuccessor(f),recovery=createReviewRuntime({storage:reviewStorage,paths:f.paths,instanceId:successor,
   currentEligibility:(peer,projectId)=>f.service.currentEligibility(peer,projectId) as Promise<DiscoveryEligibility>,
   readGit:native,runCheck:async()=>assert.fail('recovery must not re-run a check')});
 await recovery.recover();
 const settled=f.store.readFeatureState({kind:'operation',id:interruptedId}).operation!;
 assert.equal(settled.outcome,'BLOCKED');
 assert.equal(settled.error,'CHECKS_NOT_RUN');
 assert.equal(f.store.readEnvironmentState({kind:'job',id:pendingJob}).job,null);
});
