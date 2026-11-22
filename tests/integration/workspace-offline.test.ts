import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

import {inspectWorkspace} from '../../src/core/inspect-main.js';
test('workspace metadata and original receipts are LAST_KNOWN in confined offline reads',async t=>{
 const f=await workspaceAuthoringFixture(t),approved=await f.approvedFeature(),target=f.target(approved.featureId);
 const grantId=randomUUID(),requestId=randomUUID(),nowMs=Date.now();
 const canonicalIntent=canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'WORKSPACE',action:'create',
   targetId:target.workspaceId,projectId:f.projectId,expectedRevision:'2',configRevision:'1',payload:{target,featureId:approved.featureId,
     envelopeId:approved.envelope.envelopeId,envelopeDigest:approved.envelope.digest,ownerGeneration:randomUUID(),repositoryKey:f.project.repositoryKey}});
 f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:nowMs,expiresAtMs:nowMs+300000,consumedByRequestId:null}});
 f.store.commitWorkspaceState({kind:'reserve',admission:{requestId,grantId,canonicalIntent,instanceId:f.instanceId,nowMs},contextCheckedAt:new Date().toISOString()});
 const before=await readFile(f.path),names=(await readdir(f.directory)).sort(),revision=f.store.readSnapshot()!.store.revision;
 const read=await inspectWorkspace(f.directory,'workspace.get',{workspaceId:target.workspaceId});
 assert.equal(read.result,'OK',JSON.stringify(read));assert.equal(read.freshness,'LAST_KNOWN');
 const workspace=read.data.workspace as {state:string;baseOid:string};
 assert.equal(workspace.state,'CREATING');
 assert.equal(workspace.baseOid,target.baseOid);
 assert.ok(!JSON.stringify(read.data).includes(f.repo));
 assert.ok(!JSON.stringify(read.data).includes(f.root));
 const list=await inspectWorkspace(f.directory,'workspace.list',{projectId:f.projectId,limit:1});
 assert.equal((list.data.items as unknown[]).length,1);
 const operation=await inspectWorkspace(f.directory,'workspace.operation.get',{requestId});
 assert.equal((operation.data.operation as {outcome:string}).outcome,'IN_PROGRESS');
 assert.equal(operation.requestId,requestId);
 const mutation=await inspectWorkspace(f.directory,'workspace.create',{requestId,grantId});
 assert.notEqual(mutation.result,'OK');
 assert.deepEqual(await readFile(f.path),before);
 assert.deepEqual((await readdir(f.directory)).sort(),names);
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
});
