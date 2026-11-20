import {createHash} from 'node:crypto';
import {requireCleanupConditions,requireCleanupTarget} from '../../domain/workspaces/cleanup.js';
import {requireWorkspaceOwnership} from '../../domain/workspaces/ownership.js';
import {workspaceBranchRef} from '../../domain/workspaces/provision.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {WorkspaceCleanupTarget,WorkspaceGitPin,WorkspaceRecord} from '../../ports/workspace.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {makeDeadline,systemClock,type Deadline} from '../../ports/clock.js';
import {publicWorkspaceOperation} from '../../protocol/workspace.js';
import {classifyError} from '../control-main.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {workspaceFence} from './leases.js';
import type {WorkspaceProvisionOptions} from './provision.js';

export async function inspectWorkspaceCleanup(options:Pick<WorkspaceProvisionOptions,'storage'|'files'|'mutator'>,
 storeId:string,workspace:WorkspaceRecord,integrated:WorkspaceCleanupTarget,deadline:Deadline,requestId?:string){
   const {storage,files,mutator}=options;
   if(workspace.target.integration)throw new Error('WORKSPACE_NOT_FOUND');
   const {workspaceId,target}=workspace;
   requireCleanupTarget(integrated,workspaceBranchRef(workspace.featureId,workspaceId));
   const [{lease},{effect}]=await Promise.all([
     storage.readWorkspaceState!({kind:'active-lease',id:workspaceId}),
     storage.readWorkspaceState!({kind:'unresolved-effect',id:workspaceId}),
   ]);
   if(lease||effect&&effect.requestId!==requestId||workspace.state!==(requestId?'REMOVING':'READY'))throw new Error('WORKSPACE_IN_USE');
   const {disk,status}=await mutator.inspect(target,deadline);
   const marker=await files.readMarker(target.ownedRoot,workspaceId);
   const worktree=requireWorkspaceOwnership(storeId,workspace,marker,disk);
   const ancestor=await mutator.verifyIntegration(target,worktree.headOid,integrated,deadline);
   requireCleanupConditions({state:workspace.state,holder:false,effect:false,targetOid:integrated.targetOid,
     observedTargetOid:integrated.targetOid,status,integrated:ancestor});
   return{worktree,status};
}

export function createWorkspaceCleanup(options:Omit<WorkspaceProvisionOptions,'currentEligibility'>){
 const {storage,instanceId,files,mutator}=options,authorization=createWorkflowAuthorization(options);

 async function prepare(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),workspaceId=String(params.workspaceId);
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id:workspaceId});
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   const project=(await storage.getProject(workspace.projectId))?.project;
   if(!project||project.removedAt!==null)throw new Error('PROJECT_REMOVED');
   const target={targetRef:String(params.targetRef),targetOid:String(params.targetOid)};
   const {worktree}=await inspectWorkspaceCleanup(options,store.storeId,workspace,target,makeDeadline(systemClock,30000));
   const checkedAt=new Date().toISOString(),pin=await mutator.qualification();
   const intent:WorkflowIntent={version:1,storeId:store.storeId,ownerUid:store.ownerUid,namespace:'WORKSPACE',
     action:'remove',targetId:workspaceId,projectId:project.projectId,configRevision:project.configRevision,expectedRevision:workspace.stateRevision,
     payload:{...target,headOid:worktree.headOid,ownerGeneration:workspace.ownerGeneration,markerDigest:workspace.markerDigest,checkedAt,pin}};
   const grant=await authorization.prepare(peer,intent);
   return{grantId:grant.grantId,expiresAtMs:grant.expiresAtMs,canonicalIntentHash:createHash('sha256').update(grant.canonicalIntent).digest('hex'),
     summary:{workspaceId,projectId:project.projectId,stateRevision:workspace.stateRevision,branchRef:worktree.branchRef,headOid:worktree.headOid,...target,checkedAt}};
 }

 function intentTarget(intent:WorkflowIntent){
   return{targetRef:String(intent.payload.targetRef),targetOid:String(intent.payload.targetOid)};
 }
 async function work(intent:WorkflowIntent,workspace:WorkspaceRecord,requestId:string){
   const fence=workspaceFence(workspace),scope={requestId,instanceId,fence},deadline=makeDeadline(systemClock,30000);
   const claim={storeId:intent.storeId,repositoryKey:workspace.repositoryKey,requestId,ownerGeneration:workspace.ownerGeneration};
   const target=intentTarget(intent);
   const commit=storage.commitWorkspaceState!.bind(storage);
   let lease:Awaited<ReturnType<typeof files.claim>>|undefined,attempted=false;
   try{
     lease=await files.claim(claim);
     const pin=await mutator.qualification(),expected=intent.payload.pin as WorkspaceGitPin;
     if(pin.version!==expected.version||pin.sha256!==expected.sha256||pin.profileSha256!==expected.profileSha256)throw new Error('WORKSPACE_UNSAFE');
     const {worktree}=await inspectWorkspaceCleanup(options,intent.storeId,workspace,target,deadline,requestId);
     if(worktree.headOid!==intent.payload.headOid)throw new Error('UNINTEGRATED_WORK');
     if(!options.accepting())throw new Error('INTERRUPTED');
     await commit({...scope,kind:'cleanup-step',stage:'REMOVE_INTENT'});
     attempted=true;
     await mutator.removeWorktree(workspace.target,worktree,target,deadline);
     const observed=await mutator.observe(workspace.target,deadline);
     await commit({...scope,kind:'cleanup-step',stage:'WORKTREE_REMOVED',observation:observed});
     await commit({...scope,kind:'cleanup-step',stage:'DELETE_BRANCH_INTENT'});
     const absent=await mutator.deleteBranch(workspace.target,worktree.headOid,target,deadline);
     await commit({...scope,kind:'cleanup-step',stage:'BRANCH_REMOVED',observation:absent});
     await lease.settle();
     await storage.settleWorkspaceClaim!(claim);
   }catch(error){
     try{
       const result=await commit({...scope,kind:'cleanup-block',error:classifyError(error),uncertain:attempted});
       if(result.operation.phase==='FINALIZED'){
         lease?.release();lease=undefined;
         await files.settleClaim(claim);
         await storage.settleWorkspaceClaim!(claim);
       }
     }catch{/* The original receipt and coordinator claim survive an uncertain effect. */}
   }finally{lease?.release();}
 }

 async function remove(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,'remove','WORKSPACE'),intent=original.intent;
   if(intent.expectedRevision!==params.expectedStateRevision)throw new Error(original.operation?'IDEMPOTENCY_CONFLICT':'REVISION_CONFLICT');
   if(original.operation)return{operation:publicWorkspaceOperation(original.operation)};
   if(!options.accepting())throw new Error('BLOCKED');
   const result=await storage.commitWorkspaceState!({kind:'cleanup-admit',
     admission:workflowAdmission({requestId,instanceId,grantId,intent,nowMs:Date.now()})});
   if(!result.inserted)return{operation:publicWorkspaceOperation(result.operation)};
   const workspace=result.workspace!;
   options.schedule(()=>work(intent,workspace,requestId));
   return{accepted:true,requestId,workspaceId:workspace.workspaceId,stateRevision:workspace.stateRevision};
 }

 return{actions:{'workspace.cleanup.prepare':prepare,'workspace.remove':remove},async recover(){
   const {removals}=await storage.readWorkspaceState!({kind:'interrupted-removals'});
   for(const {workspace,effect} of removals??[]){
     const {requestId}=effect,{workspaceId,target}=workspace;
     const fence=workspaceFence(workspace),scope={kind:'cleanup-interrupted' as const,instanceId,requestId,fence};
     const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
     if(!operation||operation.action!=='remove')throw new Error('STATE_CORRUPT');
     const intent=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
     const claim={storeId:intent.storeId,repositoryKey:workspace.repositoryKey,requestId,ownerGeneration:workspace.ownerGeneration};
     if((effect.lastPhase??effect.phase)==='DELETE_BRANCH_INTENT'){
       const deadline=makeDeadline(systemClock,10000);
       try{
         const lease=await files.claim(claim);
         try{
           const observed=await mutator.observe(target,deadline);
           const marker=await files.readMarker(target.ownedRoot,workspaceId);
           if(!observed.branchOid&&!observed.worktree&&marker?.digest===workspace.markerDigest
             &&await mutator.verifyIntegration(target,String(intent.payload.headOid),intentTarget(intent),deadline)){
             await storage.commitWorkspaceState!({...scope,observation:observed});
             await lease.settle();await storage.settleWorkspaceClaim!(claim);
             continue;
           }
         }finally{lease.release();}
       }catch{/* Do not infer absence or repeat a Git command after restart. */}
     }
     const result=await storage.commitWorkspaceState!(scope);
     if(result.operation.phase==='FINALIZED'){
       try{await files.settleClaim(claim);await storage.settleWorkspaceClaim!(claim);}
       catch{/* Retain any unresolved filesystem claim for the next recovery. */}
     }
   }
 }};
}
