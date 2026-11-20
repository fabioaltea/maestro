import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import type {ExecutionProviderConfig} from '../../src/ports/execution.js';

test('execution configuration consumes an exact grant atomically and preserves the original reply',async t=>{
 const f=await workspaceAuthoringFixture(t),requestId=randomUUID(),grantId=randomUUID();
 const provider:ExecutionProviderConfig={providerId:'codex',binaryRef:randomUUID(),authProfileRef:randomUUID(),
   modelId:'fixture',configRevision:'1',capabilityDigest:null,status:'UNQUALIFIED',error:null};
 const canonicalIntent=canonicalWorkflowIntent({version:1,namespace:'EXECUTION',storeId:f.storeId,ownerUid:f.paths.ownerUid,
   action:'provider.configure',targetId:null,projectId:null,expectedRevision:null,configRevision:null,
   payload:{providerId:provider.providerId,binaryHandle:provider.binaryRef,authProfileRef:provider.authProfileRef,modelId:provider.modelId}});
 const now=Date.now();
 f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+60000,consumedByRequestId:null}});
 const admission={requestId,grantId,canonicalIntent,instanceId:f.instanceId,nowMs:now};
 assert.throws(()=>f.store.commitExecutionState({kind:'configure',admission,provider:{...provider,modelId:'different'}}),/INVALID_REQUEST/);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
 const first=f.store.commitExecutionState({kind:'configure',admission,provider});
 assert.equal(first.inserted,true);assert.equal(first.operation.outcome,'SUCCEEDED');
 assert.deepEqual(f.store.readExecutionState({kind:'provider',id:'codex'}).provider,provider);
 const retry=f.store.commitExecutionState({kind:'configure',admission,provider});
 assert.equal(retry.inserted,false);
 assert.deepEqual(retry.operation,first.operation);
});

test('a missing output artifact preserves its watermark and leaves the run queryable',async t=>{
 const {executionRuntimeFixture,waitForExecution}=await import('../fixtures/execution-runtime.js');
 const f=await executionRuntimeFixture(t,{question:true});
 const started=await f.mutate('start',await f.prepare('start',f.startIntent));
 await waitForExecution(()=>f.state(started.requestId)?.state==='WAITING_USER');
 const run=f.run(started.requestId)!;
 assert.throws(()=>f.store.commitExecutionState({kind:'output',runId:run.runId,instanceId:f.instanceId,generation:run.generation,artifactId:randomUUID()}),
   /ARTIFACT_CORRUPT/);
 assert.equal(f.run(run.runId)?.outputWatermark,run.outputWatermark);
 assert.equal((await f.send('output.list',{runId:run.runId})).result,'OK');
});
