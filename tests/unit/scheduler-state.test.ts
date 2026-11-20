import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {reserveSchedulerResource,schedulerReservationTransition,validateSchedulerLimits} from '../../src/domain/scheduler/resource-admission.js';
import {canonicalWorkflowIntent,validateWorkflowGrant} from '../../src/domain/workflow/authorization.js';

test('scheduler grants bind the policy revision and replay the consumed request only',()=>{
 const requestId=randomUUID(),grantId=randomUUID(),now=1800000000000;
 const intent={version:1,storeId:randomUUID(),ownerUid:501,namespace:'SCHEDULER',action:'policy.configure',targetId:null,projectId:null,
   expectedRevision:'2',configRevision:null,payload:{global:4,install:2,validate:2}};
 const canonicalIntent=canonicalWorkflowIntent(intent);
 const grant={grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+1000,consumedByRequestId:null};
 assert.equal(validateWorkflowGrant(grant,canonicalIntent,requestId,now),'CONSUME');
 assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent({...intent,expectedRevision:'3'}),requestId,now),/APPROVAL_REQUIRED/);
 assert.throws(()=>validateWorkflowGrant(grant,canonicalIntent,requestId,now+1000),/APPROVAL_STALE/);
 const consumed={...grant,consumedByRequestId:requestId};
 assert.equal(validateWorkflowGrant(consumed,canonicalIntent,requestId,now+1001),'REPLAY');
 assert.throws(()=>validateWorkflowGrant(consumed,canonicalIntent,randomUUID(),now),/APPROVAL_REQUIRED/);
});

test('scheduler limits are bounded and a released reservation stays terminal',()=>{
 for(const limits of [{global:0,install:2,validate:2},{global:4,install:3,validate:1},{global:4,install:1,validate:1.1}])
   assert.throws(()=>validateSchedulerLimits(limits),/INVALID_REQUEST/);
 const r=reserveSchedulerResource({jobId:randomUUID(),generation:randomUUID(),projectId:randomUUID(),workspaceId:randomUUID(),type:'EXECUTION'});
 const released=schedulerReservationTransition(r,{kind:'release',proof:{jobId:r.jobId,generation:r.generation,kind:'NO_SPAWN',verified:true}});
 assert.throws(()=>schedulerReservationTransition(released,{kind:'go',generation:r.generation}),/INVALID_TRANSITION/);
});
