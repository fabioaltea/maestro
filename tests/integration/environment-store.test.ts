import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {rename} from 'node:fs/promises';
import {workspaceRuntimeFixture} from '../fixtures/workspace-runtime.js';
import {publishPlanningArtifact} from '../../src/core/features/artifacts.js';
import {workflowAdmission} from '../../src/core/workflow/admission.js';
import type {WorkflowIntent} from '../../src/domain/workflow/authorization.js';
import type {EnvironmentInspection} from '../../src/ports/environment.js';

test('Environment plan reservation and sealed artifact publication use the original UUID and shared quota',async t=>{
 const f=await workspaceRuntimeFixture(t),prepared=await f.prepare();
 assert.equal((await f.submit(prepared.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspaceId=prepared.data.summary.workspaceId,workspace=f.store.readWorkspaceState({kind:'get',id:workspaceId}).workspace!;
 const requestId=randomUUID(),expectedRevision=workspace.stateRevision,instanceId=f.instanceId;
 const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'plan',storeId:f.storeId,ownerUid:f.paths.ownerUid,targetId:workspaceId,
   projectId:f.projectId,expectedRevision,configRevision:'1',payload:{}};
 const admission=workflowAdmission({requestId,intent,grantId:null,instanceId,nowMs:Date.now()});
 const metadata:EnvironmentInspection={manager:'npm',managerVersion:null,pin:null,disposition:'MANUAL_REQUIRED',reason:'MANAGER_UNSUPPORTED',
   scriptNames:[],inputs:[],inputDigest:'a'.repeat(64),registryOrigin:null};
 const artifact=await publishPlanningArtifact({storage:f.storage,storeId:f.storeId,ownerUid:f.paths.ownerUid,instanceId,targetId:workspaceId},'BUNDLE',metadata);
 const artifactPath=join(f.directory,'workflow','objects',artifact.artifactId),temporarilyMissing=join(f.directory,'missing-fixture');
 const fence={workspaceId,stateRevision:expectedRevision,ownerGeneration:workspace.ownerGeneration};
 const commit=(change:unknown)=>(f.store as unknown as {commitEnvironmentState(value:unknown):{inserted?:boolean;operation:{outcome:string};environment?:{state:string;stateRevision:string}}}).commitEnvironmentState(change);
 assert.equal(commit({kind:'plan-admit',admission}).inserted,true);
 assert.equal(commit({kind:'plan-admit',admission}).inserted,false);
 const command={kind:'plan-finish',instanceId,requestId,fence,plan:{planId:requestId,environmentId:randomUUID(),
   workspaceGeneration:workspace.ownerGeneration,workspaceRevision:expectedRevision,configRevision:'1',digest:artifact.sha256,
   inputDigest:metadata.inputDigest,artifactId:artifact.artifactId,metadata,createdAt:new Date().toISOString()}};
 await rename(artifactPath,temporarilyMissing);
 assert.throws(()=>commit(command),/ARTIFACT_CORRUPT/);
 assert.equal(f.store.readEnvironmentState({kind:'workspace',id:workspaceId}).environment,null);
 await rename(temporarilyMissing,artifactPath);
 const published=commit(command),revision=f.store.readSnapshot()!.store.revision;
 assert.equal(published.operation.outcome,'SUCCEEDED');assert.equal(published.environment?.state,'MANUAL_REQUIRED');
 assert.equal(commit({kind:'plan-admit',admission}).operation.outcome,'SUCCEEDED');
 assert.equal(f.store.readSnapshot()!.store.revision,revision);
 const db=new Database(f.path);t.after(()=>db.close());
 db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,expected_bytes,sha256,allocated_bytes,state,created_at_ms) VALUES(?,'INPUT',1,?,?,'ORPHAN',?)")
   .run(randomUUID(),'a'.repeat(64),120*1024*1024,Date.now());
 assert.throws(()=>commit({kind:'plan-admit',admission:{...admission,requestId:randomUUID()}}),/RESOURCE_LIMIT/);
 assert.ok(f.store.readEnvironmentState({kind:'plan',id:requestId}).plan);
 assert.equal(commit({kind:'plan-admit',admission}).operation.outcome,'SUCCEEDED');
});
