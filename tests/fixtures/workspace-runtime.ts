import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {workspaceAuthoringFixture} from './workspace-authoring.js';
import {createWorkspaceRuntime,type WorkspaceRuntimeServices} from '../../src/core/workspaces/runtime.js';
import {createWorkspaceMutator} from '../../src/platform/macos/git/workspace-mutator.js';
import {createOwnedWorkspaceFiles} from '../../src/platform/macos/git/workspace-files.js';
import {createWorkspaceProvisioning,type WorkspaceProvisionOptions} from '../../src/core/workspaces/provision.js';
import type {StoragePort} from '../../src/ports/storage.js';
import type {WorkspaceChange,WorkspacePort} from '../../src/ports/workspace.js';

export async function workspaceRuntimeFixture(t:Parameters<typeof workspaceAuthoringFixture>[0],mutator:WorkspacePort=createWorkspaceMutator(),compose:(options:WorkspaceProvisionOptions)=>WorkspaceRuntimeServices=createWorkspaceProvisioning,
 beforeCommit?:(change:WorkspaceChange)=>void){
 const f=await workspaceAuthoringFixture(t);
 const storage=new Proxy(f.store,{get(target,key){
   if(key==='commitWorkspaceState')return (change:WorkspaceChange)=>{beforeCommit?.(change);return target.commitWorkspaceState(change);};
   const value:unknown=Reflect.get(target,key);
   return typeof value==='function'?value.bind(target):value;
 }}) as unknown as StoragePort;
 const files=createOwnedWorkspaceFiles(f.root);
 const runtime=createWorkspaceRuntime(storage,context=>compose({...context,storage,paths:f.paths,instanceId:f.instanceId,
   mutator,files,currentEligibility:(peer:typeof f.peer,id:string)=>f.service.currentEligibility(peer,id)}));
 await runtime.recover();
 function send(method:string,params:Record<string,unknown>){
   return runtime.dispatch({protocolVersion:1,correlationId:randomUUID(),method,params},f.peer,f.store.readSnapshot()!);
 }
 async function prepare(){
   const feature=await f.approvedFeature();
   const response=await send('workspace.prepare',{featureId:feature.featureId,envelopeId:feature.envelope.envelopeId});
   assert.equal(response.result,'OK',JSON.stringify(response));
   return{feature,data:response.data as {grantId:string;summary:{workspaceId:string;baseOid:string;branchRef:string}}};
 }
 async function submit(grantId:string,requestId=randomUUID()){
   const r=await send('workspace.create',{grantId,requestId});
   await runtime.idle();
   return{r,requestId,operation:f.store.readFeatureState({kind:'operation',id:requestId}).operation};
 }
 return{...f,files,storage,mutator,runtime,send,prepare,submit};
}

export function startSuccessor(f:Pick<Awaited<ReturnType<typeof workspaceRuntimeFixture>>,'store'|'instanceId'|'paths'>){
 const instanceId=randomUUID(),ticketId=randomUUID(),requestId=randomUUID(),at=new Date().toISOString();
 f.store.reconcileInstanceAbsent(f.instanceId,'1');
 f.store.acceptOperation({requestId,action:'start',payloadHash:'a'.repeat(64),ownerUid:f.paths.ownerUid,targetInstanceId:null,acceptedAt:at});
 f.store.issueTicket({requestId,ticketId,instanceId,generation:'2'});
 f.store.claimTicket(ticketId,'2',process.pid);
 f.store.recordInstance({instanceId,generation:'2',pid:process.pid,lifecycle:'RECOVERING',startedAt:at,shutdownPrepared:false,lastError:null});
 return instanceId;
}
