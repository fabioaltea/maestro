import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {canonicalWorkflowIntent,validateWorkflowGrant} from '../../src/domain/workflow/authorization.js';

const model='../../src/domain/workspaces/model.js';

test('workspace state gates the writer and forbids revival after removal',async()=>{
  const {transitionWorkspace,nextWorkspaceRevision,requireWorkspaceCapacity}=await import(model);
  assert.equal(transitionWorkspace('REQUESTED','begin'),'CREATING');
  assert.equal(transitionWorkspace('CREATING','ready'),'READY');
  assert.equal(transitionWorkspace('READY','acquire'),'IN_USE');
  assert.equal(transitionWorkspace('IN_USE','release'),'READY');
  assert.equal(transitionWorkspace('IN_USE','uncertain'),'RECONCILING');
  assert.equal(transitionWorkspace('READY','remove'),'REMOVING');
  assert.equal(transitionWorkspace('REMOVING','removed'),'REMOVED');
  assert.throws(()=>transitionWorkspace('REMOVED','ready'),/INVALID_TRANSITION/);
  assert.throws(()=>transitionWorkspace('IN_USE','remove'),/INVALID_TRANSITION/);
  assert.equal(nextWorkspaceRevision('1'),'2');
  assert.throws(()=>nextWorkspaceRevision('9223372036854775807'),/REVISION_CONFLICT/);
  assert.doesNotThrow(()=>requireWorkspaceCapacity(19));
  assert.throws(()=>requireWorkspaceCapacity(20),/WORKSPACE_LIMIT/);
});

test('workspace fences the expected revision and owner generation',async()=>{
  const {requireWorkspaceFence}=await import(model);
  const same={workspaceId:randomUUID(),stateRevision:'2',ownerGeneration:randomUUID()};
  assert.doesNotThrow(()=>requireWorkspaceFence(same,same));
  assert.throws(()=>requireWorkspaceFence(same,{...same,stateRevision:'3'}),/REVISION_CONFLICT/);
  assert.throws(()=>requireWorkspaceFence(same,{...same,ownerGeneration:randomUUID()}),/STALE_TARGET/);
});

test('workspace grant binds the exact scope, expires, and only replays its consumed UUID',()=>{
 const storeId=randomUUID(),targetId=randomUUID(),projectId=randomUUID(),requestId=randomUUID();
 const intent={version:1,storeId,ownerUid:501,namespace:'WORKSPACE',action:'remove',targetId,projectId,
   expectedRevision:'4',configRevision:'2',payload:{targetOid:'a'.repeat(40),ownerGeneration:randomUUID()}};
 const canonicalIntent=canonicalWorkflowIntent(intent);
 const grant={grantId:randomUUID(),canonicalIntent,createdAtMs:100,expiresAtMs:200,consumedByRequestId:null};
 assert.equal(validateWorkflowGrant(grant,canonicalIntent,requestId,150),'CONSUME');
 for(const change of [{namespace:'FEATURE'},{action:'create'},{expectedRevision:'5'},{targetId:randomUUID()}]){
   assert.throws(()=>validateWorkflowGrant(grant,canonicalWorkflowIntent({...intent,...change}),requestId,150),/APPROVAL_REQUIRED/);
 }
 assert.throws(()=>validateWorkflowGrant(grant,canonicalIntent,requestId,200),/APPROVAL_STALE/);
 const consumed={...grant,consumedByRequestId:requestId};
 assert.equal(validateWorkflowGrant(consumed,canonicalIntent,requestId,300),'REPLAY');
 assert.throws(()=>validateWorkflowGrant(consumed,canonicalIntent,randomUUID(),150),/APPROVAL_REQUIRED/);
});
