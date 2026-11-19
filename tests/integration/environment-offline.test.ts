import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {workflowAdmission} from '../../src/core/workflow/admission.js';
import type {WorkflowIntent} from '../../src/domain/workflow/authorization.js';

import {inspectEnvironment} from '../../src/core/inspect-main.js';
test('Environment offline listing and original operation are historical and immutably read',async t=>{
 const f=await workspaceRuntimeFixture(t),prepared=await f.prepare(),workspaceId=prepared.data.summary.workspaceId;
 assert.equal((await f.submit(prepared.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!,requestId=randomUUID();
 const intent:WorkflowIntent={version:1,storeId:f.storeId,ownerUid:f.paths.ownerUid,namespace:'ENVIRONMENT',action:'plan',
   targetId:workspaceId,projectId:workspace.projectId,expectedRevision:workspace.stateRevision,configRevision:'1',payload:{}};
 f.store.commitEnvironmentState({kind:'plan-admit',admission:workflowAdmission({requestId,intent,grantId:null,instanceId:f.instanceId,nowMs:Date.now()})});
 const before=await readFile(f.path),names=(await readdir(f.directory)).sort(),revision=f.store.readSnapshot()!.store.revision;
 const current=await inspectEnvironment(f.directory,'environment.get',{workspaceId});
 assert.equal(current.freshness,'LAST_KNOWN');
 assert.equal((current.data.environment as {state:string}).state,'UNCONFIGURED');
 assert.equal(current.data.currentness,'UNKNOWN');
 const op=await inspectEnvironment(f.directory,'environment.operation.get',{requestId});
 assert.equal(op.requestId,requestId);assert.equal((op.data.operation as {outcome:string}).outcome,'IN_PROGRESS');
 const result=await inspectEnvironment(f.directory,'environment.plan',{workspaceId,requestId:randomUUID(),expectedStateRevision:workspace.stateRevision});
 assert.equal(result.error?.code,'DAEMON_UNAVAILABLE');
 assert.deepEqual(await readFile(f.path),before);assert.deepEqual((await readdir(f.directory)).sort(),names);
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
});
