import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalWorkflowIntent,validateWorkflowGrant} from '../../src/domain/workflow/authorization.js';

const stateModule='../../src/domain/environments/state.js';
test('environment state distinguishes qualified, manual and stale evidence',async()=>{
 const {transitionEnvironment}=await import(stateModule);
 assert.equal(transitionEnvironment('UNCONFIGURED','plan'),'PLANNED');
 assert.equal(transitionEnvironment('UNCONFIGURED','manual'),'MANUAL_REQUIRED');
 assert.equal(transitionEnvironment('MANUAL_REQUIRED','attest'),'MANUAL_VERIFIED');
 assert.throws(()=>transitionEnvironment('MANUAL_VERIFIED','prepared'),/INVALID_TRANSITION/);
 assert.equal(transitionEnvironment('PLANNED','prepare'),'PREPARING');
 assert.equal(transitionEnvironment('PREPARING','prepared'),'READY');
 assert.equal(transitionEnvironment('READY','stale'),'STALE');
 assert.equal(transitionEnvironment('PREPARING','uncertain'),'RECONCILING');
 assert.throws(()=>transitionEnvironment('RECONCILING','prepare'),/INVALID_TRANSITION/);
});

test('environment fences workspace generation and state revision, with fixed bounded jobs',async()=>{
 const {requireEnvironmentFence,requireEnvironmentLimits}=await import(stateModule);
 const scope={workspaceId:randomUUID(),workspaceGeneration:randomUUID(),stateRevision:'1'};
 requireEnvironmentFence(scope,scope);
 assert.throws(()=>requireEnvironmentFence(scope,{...scope,workspaceGeneration:randomUUID()}),/STALE_TARGET/);
 assert.throws(()=>requireEnvironmentFence(scope,{...scope,stateRevision:'2'}),/REVISION_CONFLICT/);
 const limits={inputBytes:1048576,inputFiles:200,jobMs:300000,workspaceBytes:10737418240,totalBytes:21474836480,freeBytes:2147483648,activeJobs:0};
 requireEnvironmentLimits(limits);
 for(const extra of [{inputFiles:201},{inputBytes:1048577},{jobMs:300001},{workspaceBytes:10737418241},
   {totalBytes:21474836481},{freeBytes:2147483647},{activeJobs:1}]){
   assert.throws(()=>requireEnvironmentLimits({...limits,...extra}),/RESOURCE_LIMIT|DISK_BUDGET|BUSY/);
 }
});

test('environment grants bind scope, input and revision and admit only exact replay after expiry',()=>{
 const id=()=>randomUUID(),requestId=id(),storeId=id(),workspaceId=id();
 const intent={version:1,namespace:'ENVIRONMENT',action:'prepare',storeId,ownerUid:42,targetId:workspaceId,projectId:id(),
   expectedRevision:'2',configRevision:'1',payload:{planId:id(),inputDigest:'a'.repeat(64),generation:id()}};
 const canonicalIntent=canonicalWorkflowIntent(intent);
 const grant={grantId:id(),createdAtMs:100,expiresAtMs:200,canonicalIntent,consumedByRequestId:null};
 assert.equal(validateWorkflowGrant(grant,canonicalIntent,requestId,150),'CONSUME');
 assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent({...intent,expectedRevision:'3'}),requestId,150),/APPROVAL_REQUIRED/);
 assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent({...intent,namespace:'WORKSPACE'}),requestId,150),/APPROVAL_REQUIRED/);
 assert.throws(()=>validateWorkflowGrant(grant,canonicalIntent,requestId,200),/APPROVAL_STALE/);
 assert.equal(validateWorkflowGrant({...grant,consumedByRequestId:requestId},canonicalIntent,requestId,201),'REPLAY');
 assert.throws(()=>validateWorkflowGrant({...grant,consumedByRequestId:requestId},canonicalIntent,id(),201),/APPROVAL_REQUIRED/);
});
