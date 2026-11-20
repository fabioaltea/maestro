import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workspaceRuntimeFixture} from './workspace-runtime.js';
import {canonicalWorkflowIntent,type WorkflowIntent} from '../../src/domain/workflow/authorization.js';

export async function schedulerStoreFixture(t:Parameters<typeof workspaceRuntimeFixture>[0]){
 const f=await workspaceRuntimeFixture(t),prepared=await f.prepare();
 assert.equal((await f.submit(prepared.data.grantId)).operation?.outcome,'SUCCEEDED');
 const workspaceId=prepared.data.summary.workspaceId;
 const base={version:1 as const,storeId:f.storeId,ownerUid:f.paths.ownerUid};
 function saveGrant(intent:WorkflowIntent){
   const grantId=randomUUID(),canonicalIntent=canonicalWorkflowIntent(intent),now=Date.now();
   f.store.commitFeatureState({kind:'grant',grant:{grantId,canonicalIntent,createdAtMs:now,expiresAtMs:now+60000,consumedByRequestId:null}});
   return{requestId:randomUUID(),grantId,canonicalIntent,instanceId:f.instanceId,nowMs:now};
 }
 function enqueue(originalId:string,priority=0){
   return saveGrant({...base,namespace:'SCHEDULER',action:'enqueue',targetId:originalId,projectId:f.projectId,expectedRevision:null,configRevision:null,
     payload:{jobIntentId:originalId,priority,notBefore:null}});
 }
 function intent(namespace:WorkflowIntent['namespace']='EXECUTION',action='start'){
   return saveGrant({...base,namespace,action,targetId:namespace==='ENVIRONMENT'?workspaceId:prepared.feature.featureId,
     projectId:f.projectId,expectedRevision:'1',configRevision:'1',payload:{workspaceId}}).grantId;
 }
 return{...f,base,workspaceId,saveGrant,enqueue,intent};
}

