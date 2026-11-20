import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import {createIntegrationMutator} from '../../src/platform/macos/git/integration-mutator.js';
import {executionRuntimeFixture} from './execution-runtime.js';
import {featureDraft} from './feature-boundary.js';
import {fixtureRegistry,fixturePackage,fixtureVersion} from './environment-boundary.js';
import {fixtureLock} from './environment-registry.js';
import {startSuccessor} from './workspace-runtime.js';
import {createReviewRuntime,nativeReviewGit} from '../../src/core/review/runtime.js';
import {createWorkspaceLeases,verifyOwnedWorktree} from '../../src/core/workspaces/leases.js';
import {createEnvironmentRuntime,nativeEnvironmentServices} from '../../src/core/environments/runtime.js';
import type {DiscoveryEligibility} from '../../src/domain/discovery/approval.js';
import type {RpcResponse} from '../../src/ports/platform.js';

export async function reviewIntegrationFixture(t:TestContext){
 const commandSpecId=randomUUID(),draft=featureDraft();
 const f=await executionRuntimeFixture(t,{bundle:{...draft,acceptanceCriteria:draft.acceptanceCriteria.map(criterion=>({...criterion,verification:`command:${commandSpecId}`}))}});
 const start=await f.mutate('start',await f.prepare('start',f.startIntent));
 await f.runtime.idle();
 const workspaceId=f.startIntent.workspaceId,source=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 const stagePath=source.ownership!.root.canonicalPath,targetRef='refs/heads/selected-target';
 const base=(await f.repositories.git(stagePath,['rev-parse','HEAD'])).trim();
 await f.repositories.git(stagePath,['branch','selected-target',base]);
 const registry=await fixtureRegistry(t);
 await unlink(join(stagePath,'package-lock.json'));
 await writeFile(join(stagePath,'.gitignore'),'node_modules/\n');
 await writeFile(join(stagePath,'pnpm-lock.yaml'),fixtureLock(registry));
 await writeFile(join(stagePath,'package.json'),JSON.stringify({name:'candidate-fixture',packageManager:`pnpm@${fixtureVersion}`,
   dependencies:{[fixturePackage]:'1.0.0'},maestro:{validation:[{id:commandSpecId,entry:'review.mjs',argv:[],timeoutMs:10000}]}}));
 await writeFile(join(stagePath,'review.mjs'),"import {readFileSync} from 'node:fs'; if (!readFileSync('target-only.txt','utf8')) process.exit(1);\n");
 await writeFile(join(stagePath,'REVIEW.md'),'Synthetic integration documentation.\n');
 await writeFile(join(stagePath,'tracked.txt'),'Change detected by the sealed Discovery selector.\n');
 await f.repositories.git(stagePath,['add','--','.gitignore','approved.txt','package.json','pnpm-lock.yaml','review.mjs','REVIEW.md','tracked.txt']);
 await f.repositories.git(stagePath,['commit','-m','source candidate fixture']);
 const temp=join(f.root,'target-fixture');
 await f.repositories.git(f.repo,['worktree','add',temp,'selected-target']);
 await writeFile(join(temp,'target-only.txt'),'target only\n');
 await f.repositories.git(temp,['add','--','target-only.txt']);
 await f.repositories.git(temp,['commit','-m','target fixture divergent']);
 const targetOid=(await f.repositories.git(temp,['rev-parse','HEAD'])).trim();
 await f.repositories.git(f.repo,['worktree','remove',temp]);
 const session=f.state(start.requestId)!;
 const checkpoint=await f.mutate('checkpoint',await f.prepare('checkpoint',{sessionId:session.sessionId,expectedStateRevision:session.stateRevision},{stateRevision:session.stateRevision}));
 assert.equal(checkpoint.operation?.outcome,'SUCCEEDED');

 let crash=false;
 const native=nativeReviewGit(f.mutator,record=>verifyOwnedWorktree(f,f.storeId,record));
 const integration={files:f.files,git:createIntegrationMutator({checkpoint(point){if(crash&&point==='ref.updated')throw new Error('FIXTURE_LOST_REPLY');}})};
 const leases=createWorkspaceLeases({...f,storage:f.storage,instanceId:f.instanceId,accepting:()=>true});
 const env=createEnvironmentRuntime({storage:f.storage,instanceId:f.instanceId,compose:nativeEnvironmentServices({
   storage:f.storage,paths:f.paths,instanceId:f.instanceId,owned:leases.owned,lease:leases.forConsumer('ENVIRONMENT'),
   readValidationTree:async w=>(await native.captureCheckpoint(w)).treeDigest,
 })});
 await env.recover();
 const options={storage:f.storage,paths:f.paths,instanceId:f.instanceId,integration,readGit:native,runCheck:env.runDelegatedCheck!,
   currentEligibility:(peer:typeof f.peer,projectId:string)=>f.service.currentEligibility(peer,projectId) as Promise<DiscoveryEligibility>};
 const rt=createReviewRuntime(options);
 rt.start();
 function call(runtime:{dispatch:typeof rt.dispatch},method:string,params:Record<string,unknown>){
   return runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params},f.peer,f.store.readSnapshot()!);
 }
 function data(reply:RpcResponse){assert.equal(reply.result,'OK',JSON.stringify(reply));return reply.data as Record<string,unknown>;}
 const grant=async(action:string,intent:Record<string,unknown>,stateRevision?:string)=>String(data(await call(rt,'review.prepare',{
   action,intent,expectedRevisions:stateRevision?{stateRevision}:{},
 })).grantId);
 const reviewId=randomUUID(),snapshot=await grant('create',{featureId:f.startIntent.featureId,checkpointId:checkpoint.requestId,targetRef,targetOid});
 data(await call(rt,'review.create',{requestId:reviewId,grantId:snapshot}));
 const candidateId=randomUUID(),candidateGrant=await grant('candidate.prepare',{reviewId,expectedStateRevision:'1'},'1');
 data(await call(rt,'review.candidate.prepare',{requestId:candidateId,grantId:candidateGrant}));
 await rt.idle();
 assert.equal(f.store.readFeatureState({kind:'operation',id:candidateId}).operation?.outcome,'SUCCEEDED');
 const {candidate}=f.store.readReviewState({kind:'candidate',id:candidateId});
 assert.ok(candidate);
 const stages=f.database.prepare("SELECT purpose FROM workspaces_records WHERE workspace_id IN (?,?) ORDER BY purpose").all(candidate.guardId,candidate.stagingId);
 assert.deepEqual(stages,[{purpose:'INTEGRATION_GUARD'},{purpose:'INTEGRATION_STAGING'}]);
 assert.equal(f.store.readWorkspaceState({kind:'summary',id:candidate.guardId}).summary,null);
 const stage=f.store.readWorkspaceState({kind:'get',id:candidate.stagingId}).workspace!;
 assert.equal(stage.ownership?.branchRef,'HEAD');
 const before=await call(rt,'review.prepare',{action:'approve',intent:{reviewId,candidateId,evidenceDigest:'0'.repeat(64)},expectedRevisions:{stateRevision:'2'}});
 assert.equal((before.data as {code:string}).code,'CHECKS_NOT_RUN');
 const planId=randomUUID();
 data(await call(env,'environment.plan',{requestId:planId,workspaceId:stage.workspaceId,expectedStateRevision:stage.stateRevision}));
 await env.idle();
 const plan=f.store.readEnvironmentState({kind:'plan',id:planId}).plan!;
 const environment=f.store.readEnvironmentState({kind:'workspace',id:stage.workspaceId}).environment!;
 const install=data(await call(env,'environment.prepare',{action:'prepare',intent:{planId,planDigest:plan.digest},expectedRevisions:{stateRevision:environment.stateRevision}}));
 data(await call(env,'environment.prepare',{requestId:randomUUID(),grantId:install.grantId}));
 await env.idle();
 const validation=await grant('validate',{reviewId,commandSpecIds:[commandSpecId]},'2'),validationId=randomUUID();
 data(await call(rt,'review.validate',{requestId:validationId,grantId:validation}));
 await rt.idle();
 data(await call(rt,'review.operation.get',{requestId:validationId}));
 const reviewed=data(await call(rt,'review.get',{reviewId}));
 const proof=(reviewed.criteria as {status:string;evidence:{treeOid:string}}[])[0]!;
 assert.equal(proof.status,'PASS');assert.equal(proof.evidence.treeOid,candidate.treeOid);
 const decisionId=randomUUID(),approval=await grant('approve',{reviewId,candidateId,evidenceDigest:reviewed.evidenceDigest},'4');
 data(await call(rt,'review.approve',{requestId:decisionId,grantId:approval}));
 const forbidden=await call(rt,'review.integrate',{requestId:randomUUID(),grantId:approval});
 assert.equal((forbidden.data as {code:string}).code,'APPROVAL_REQUIRED');
 const integrationId=randomUUID(),permission=await grant('integrate',{candidateId,decisionId,expectedTargetOid:targetOid},'5');
 crash=true;
 const request={requestId:integrationId,grantId:permission};
 data(await call(rt,'review.integrate',request));
 await rt.idle();
 assert.equal(f.store.readFeatureState({kind:'operation',id:integrationId}).operation?.outcome,'UNKNOWN');
 assert.equal((await f.repositories.git(f.repo,['rev-parse',targetRef])).trim(),candidate.candidateOid);
 const instanceId=startSuccessor(f),successor=createReviewRuntime({...options,instanceId,runCheck:async()=>assert.fail('check replay')});
 await successor.recover();
 const recovered=f.store.readReviewState({kind:'integration',id:integrationId}).integration;
 assert.equal(recovered?.phase,'FINALIZED');
 assert.deepEqual(recovered?.proof,{requestId:integrationId,old:targetOid,candidate:candidate.candidateOid,guardSynced:true});
 f.store.transitionInstance(instanceId,'RUNNING');successor.start();
 const retried=await Promise.all(Array.from({length:10},()=>call(successor,'review.integrate',request)));
 for(const reply of retried){
   const operation=data(reply).operation as {requestId:string;outcome:string};
   assert.equal(operation.requestId,integrationId);assert.equal(operation.outcome,'SUCCEEDED');
 }
 const reflog=await f.repositories.git(f.repo,['reflog','show','--format=%gs',targetRef]);
 assert.equal(reflog.split('\n').filter(line=>line===`maestro-integration ${integrationId}`).length,1);
 assert.equal(f.store.readFeatureState({kind:'operation',id:integrationId}).operation?.outcome,'SUCCEEDED');
 const guard=f.store.readWorkspaceState({kind:'get',id:candidate.guardId}).workspace!;
 assert.equal((await f.repositories.git(guard.ownership!.root.canonicalPath,['status','--porcelain'])).trim(),'');
 assert.equal((await f.repositories.git(stagePath,['rev-parse','HEAD'])).trim(),candidate.sourceOid);
 assert.equal((await f.repositories.git(f.repo,['status','--porcelain'])).trim(),'');
 return{f,instanceId,integrationId,reviewId,workspaceId,candidate,stagePath,options,successor,call,data,targetRef,targetOid};
}
