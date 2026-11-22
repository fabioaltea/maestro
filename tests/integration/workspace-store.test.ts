import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rename} from 'node:fs/promises';
import {join} from 'node:path';
import {canonicalWorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {workspaceAuthoringFixture} from '../fixtures/workspace-authoring.js';

test('workspace reservation verifies the sealed bundle, debits quota, and deduplicates a lost reply',async t=>{
 const f=await workspaceAuthoringFixture(t),feature=await f.approvedFeature();
 const input=()=>{
   const target=f.target(feature.featureId),grantId=randomUUID(),nowMs=Date.now();
   const canonicalIntent=canonicalWorkflowIntent({version:1,storeId:f.storeId,ownerUid:process.getuid!(),namespace:'WORKSPACE',action:'create',
     targetId:target.workspaceId,projectId:f.projectId,expectedRevision:'2',configRevision:'1',payload:{featureId:feature.featureId,
       envelopeId:feature.envelope.envelopeId,envelopeDigest:feature.envelope.digest,ownerGeneration:randomUUID(),repositoryKey:f.project.repositoryKey,target}});
   f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:nowMs,expiresAtMs:nowMs+300000,consumedByRequestId:null}});
   const admission={requestId:randomUUID(),grantId,instanceId:f.instanceId,canonicalIntent,nowMs};
   return {target,admission,commit:()=>f.store.commitWorkspaceState({kind:'reserve',admission,contextCheckedAt:new Date().toISOString()})};
 };
 const first=input();
 const file=join(f.directory,'workflow','objects',feature.artifactId),backup=join(f.directory,'owned-fixture-backup');
 await rename(file,backup);
 try{assert.throws(first.commit,/ARTIFACT_CORRUPT/);}
 finally{await rename(backup,file);}
 assert.equal(f.store.readFeatureState({kind:'operation',id:first.admission.requestId}).operation,null);
 const injected=randomUUID();
 f.database.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'INPUT',1,?,?,'ORPHAN',?)")
   .run(injected,'c'.repeat(64),120*1024*1024,Date.now());
 assert.throws(first.commit,/RESOURCE_LIMIT/);
 assert.equal(f.store.readWorkspaceState({kind:'get',id:first.target.workspaceId}).workspace,null);
 f.database.prepare("UPDATE workflow_artifacts SET state='DISCARDED',allocated_bytes=0 WHERE artifact_id=?").run(injected);
 assert.throws(()=>{first.commit();throw new Error('LOST_REPLY');},/LOST_REPLY/);
 const recorded=f.store.readFeatureState({kind:'operation',id:first.admission.requestId}).operation;
 assert.equal(recorded?.namespace,'WORKSPACE');
 const revision=f.store.readSnapshot()!.store.revision;
 const replay=first.commit();
 assert.equal(replay.inserted,false);
 assert.deepEqual(replay.operation,recorded);
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
 assert.equal(replay.workspace?.state,'CREATING');
 const competing=input();
 assert.throws(competing.commit,/WORKSPACE_IN_USE/);
 assert.equal(f.store.readFeatureState({kind:'grant',id:competing.admission.grantId}).grant?.consumedByRequestId,null);
});
