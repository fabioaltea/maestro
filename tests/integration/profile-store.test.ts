import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRegistryStore} from '../fixtures/registry-store.js';
import {workflowAdmission} from '../../src/core/workflow/admission.js';
import {canonicalWorkflowIntent,type WorkflowIntent} from '../../src/domain/workflow/authorization.js';
import {publishPlanningArtifact} from '../../src/core/features/artifacts.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {ProfileWrite} from '../../src/ports/profile.js';

test('profile writer atomically rejects missing artifacts and replays the exact durable request',async t=>{
 const f=await createRegistryStore(t),requestId=randomUUID(),artifactId=randomUUID(),grantId=randomUUID(),now=Date.now();
 const intent:WorkflowIntent={version:1,namespace:'PROFILE',action:'create',storeId:f.storeId,ownerUid:process.getuid!(),
   targetId:requestId,projectId:null,expectedRevision:null,configRevision:null,payload:{bundleArtifactId:artifactId}};
 const admission=workflowAdmission({requestId,grantId,intent,instanceId:f.instanceId,nowMs:now});
 f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent:canonicalWorkflowIntent(intent),createdAtMs:now,expiresAtMs:now+30000,consumedByRequestId:null}});
 const at=new Date(now).toISOString();
 const command:ProfileWrite={kind:'record',admission,
   record:{entityId:requestId,kind:'PROFILE',scope:'GLOBAL',projectId:null,ownerProfileId:null,alias:'fixture',state:'ENABLED',stateRevision:'1',revisionId:requestId,updatedAt:at},
   revision:{revisionId:requestId,entityId:requestId,previousId:null,digest:'a'.repeat(64),byteLength:1,artifactId,document:{},createdAt:at}};
 assert.throws(()=>f.store.commitProfileState(command),/ARTIFACT_CORRUPT/);
 assert.equal(f.store.readFeatureState({kind:'operation',id:requestId}).operation,null);
 assert.equal(f.store.readFeatureState({kind:'grant',id:grantId}).grant?.consumedByRequestId,null);
 assert.equal(f.store.readProfileState({kind:'record',id:requestId}).record,null);
 const file=await publishPlanningArtifact({storage:f.store as unknown as StoragePort,storeId:f.storeId,ownerUid:process.getuid!(),instanceId:f.instanceId,targetId:requestId},'BUNDLE',{name:'fixture'});
 const approved={...intent,payload:{bundleArtifactId:file.artifactId}},nextGrant=randomUUID();
 f.store.commitFeatureState({kind:'grant',grant:{grantId:nextGrant,canonicalIntent:canonicalWorkflowIntent(approved),createdAtMs:now,expiresAtMs:now+30000,consumedByRequestId:null}});
 const apply={...command,admission:workflowAdmission({requestId,grantId:nextGrant,intent:approved,instanceId:f.instanceId,nowMs:now}),
   revision:{...command.revision!,artifactId:file.artifactId,digest:file.sha256,byteLength:file.expectedBytes}};
 assert.equal(f.store.commitProfileState(apply).operation.outcome,'SUCCEEDED');
 assert.equal(f.store.commitProfileState(apply).inserted,false);
 assert.equal(f.store.readFeatureState({kind:'artifact',id:file.artifactId}).artifact?.referenceCount,1);
 assert.throws(()=>f.store.commitProfileState(command),/IDEMPOTENCY_CONFLICT/);
});
