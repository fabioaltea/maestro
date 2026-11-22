import {randomUUID} from 'node:crypto';
import {requireWorkspaceOwnership} from '../../domain/workspaces/ownership.js';
import type {WorkspaceObservation,WorkspaceRecord} from '../../ports/workspace.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {publicWorkspaceOperation} from '../../protocol/workspace.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {classifyError} from '../control-main.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import {workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {createWorkspaceLeases,workspaceFence} from './leases.js';
import {proveWorkspaceHandoff,type WorkspaceProvisionOptions} from './provision.js';

export function createWorkspaceRecovery(options:WorkspaceProvisionOptions){
 const {storage,files,mutator,instanceId}=options;
 const authorization=createWorkflowAuthorization(options),leases=createWorkspaceLeases(options);

 async function observe(peer:AuthenticatedPeer,workspace:WorkspaceRecord,storeId:string,requestId:string){
   const {workspaceId,target}=workspace,fence=workspaceFence(workspace);
   const base={kind:'refresh-finish' as const,requestId,instanceId,fence};
   const unknown={observationId:randomUUID(),ownership:'UNKNOWN' as const,headOid:null,branchRef:null,
     tracked:null,untracked:null,ignored:null,conflicts:null};
   try{
     const {disk,status}=await mutator.inspect(target,makeDeadline(systemClock,15000));
     const {effect}=await storage.readWorkspaceState!({kind:'unresolved-effect',id:workspaceId});
     if(!status&&!disk.branchOid&&!workspace.ownership&&!effect || !status&&!disk.branchOid&&workspace.state==='REMOVED'){
       await storage.commitWorkspaceState!({...base,error:null,observation:{...unknown,ownership:'ABSENT',checkedAt:new Date().toISOString()}});
       return;
     }
     const marker=await files.readMarker(target.ownedRoot,workspaceId),worktree=requireWorkspaceOwnership(storeId,workspace,marker,disk);
     if(!status)throw new Error('OWNERSHIP_UNPROVEN');
     const observation:WorkspaceObservation={observationId:unknown.observationId,checkedAt:new Date().toISOString(),ownership:'VERIFIED',
       headOid:worktree.headOid,branchRef:worktree.branchRef,...status};
     if(effect){
       if(workspace.state!=='RECONCILING'||!marker||effect.requestId!==marker.marker.requestId||
         worktree.headOid!==target.baseOid||disk.baseOid!==target.baseOid)throw new Error('OWNERSHIP_UNPROVEN');
       const {proof}=await proveWorkspaceHandoff(options,peer,workspace.featureId,workspace.envelopeId);
       const claim={storeId,repositoryKey:workspace.repositoryKey,requestId:effect.requestId,ownerGeneration:workspace.ownerGeneration};
       const lease=await files.claim(claim);
       try{
         const result=await storage.commitWorkspaceState!({...base,error:null,observation,recovered:{originalRequestId:effect.requestId,contextCheckedAt:proof.checkedAt}});
         if(result.operation.outcome==='SUCCEEDED'){
           await lease.settle();
           await storage.settleWorkspaceClaim!(claim);
         }
       }finally{lease.release();}
     }else await storage.commitWorkspaceState!({...base,error:null,observation});
   }catch(error){
     try{
       await storage.commitWorkspaceState!({...base,error:classifyError(error),observation:{...unknown,checkedAt:new Date().toISOString()}});
     }catch{/* Keep the original accepted receipt available if persistence is unavailable. */}
   }
 }

 async function refresh(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),workspaceId=String(params.workspaceId),requestId=String(params.requestId);
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   if(operation){
     const prior=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
     if(prior.storeId!==store.storeId||prior.namespace!=='WORKSPACE'||prior.action!=='refresh'||
       prior.targetId!==workspaceId||prior.expectedRevision!==params.expectedStateRevision)throw new Error('IDEMPOTENCY_CONFLICT');
     return{operation:publicWorkspaceOperation(operation)};
   }
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id:workspaceId});
   if(!workspace||workspace.target.integration)throw new Error('WORKSPACE_NOT_FOUND');
   const intent:WorkflowIntent={version:1,storeId:store.storeId,ownerUid:store.ownerUid,namespace:'WORKSPACE',
     action:'refresh',targetId:workspaceId,projectId:workspace.projectId,expectedRevision:String(params.expectedStateRevision),configRevision:null,payload:{}};
   if(!options.accepting())throw new Error('BLOCKED');
   const result=await storage.commitWorkspaceState!({kind:'refresh-admit',
     admission:workflowAdmission({requestId,grantId:null,intent,instanceId,nowMs:Date.now()})});
   if(!result.inserted)return{operation:publicWorkspaceOperation(result.operation)};
   options.schedule(()=>observe(peer,result.workspace!,store.storeId,requestId));
   return{accepted:true,requestId,workspaceId,stateRevision:workspace.stateRevision};
 }

 return{leases,actions:{'workspace.refresh':refresh},async recover(){
   const {operations}=await storage.readWorkspaceState!({kind:'interrupted-refresh'});
   for(const op of operations??[])await storage.commitWorkspaceState!({kind:'refresh-interrupted',instanceId,requestId:op.requestId});
   await leases.recover();
 }};
}
