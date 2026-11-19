import {createHash,randomUUID} from 'node:crypto';
import {requireWorkspaceHandoff,requireProvisioningObservation,workspaceBranchRef} from '../../domain/workspaces/provision.js';
import type {DiscoveryEligibility} from '../../domain/discovery/approval.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {FeatureContextProof} from '../../ports/feature.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {StoragePort} from '../../ports/storage.js';
import type {OwnedWorkspaceFilesPort,WorkspaceGitPin,WorkspaceMutationTarget,WorkspacePort,WorkspaceRecord} from '../../ports/workspace.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import {publicWorkspaceOperation} from '../../protocol/workspace.js';
import {classifyError} from '../control-main.js';
import {readSealedFeatureArtifact} from '../features/artifacts.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import type {WorkspaceRuntimeContext,WorkspaceRuntimeServices} from './runtime.js';

export interface WorkspaceProvisionOptions extends WorkspaceRuntimeContext {
 readonly storage:StoragePort;
 readonly paths:ArchivePaths;
 readonly instanceId:string;
 readonly files:OwnedWorkspaceFilesPort;
 readonly mutator:WorkspacePort;
 readonly currentEligibility:(peer:AuthenticatedPeer,projectId:string)=>Promise<DiscoveryEligibility>;
}

const digest=(value:string)=>createHash('sha256').update(value).digest('hex');

export function createWorkspaceProvisioning(options:WorkspaceProvisionOptions):WorkspaceRuntimeServices{
 const {storage,paths,instanceId,mutator,files}=options;
 const authorization=createWorkflowAuthorization({storage,paths,instanceId});

 async function prove(peer:AuthenticatedPeer,featureId:string,envelopeId:string){
   const query=storage.readFeatureState!.bind(storage);
   const [{feature},{envelope}]=await Promise.all([query({kind:'feature',id:featureId}),query({kind:'envelope',id:envelopeId})]);
   if(!feature||!envelope)throw new Error('APPROVAL_STALE');
   const project=(await storage.getProject(feature.projectId))?.project;
   if(!project||project.removedAt!==null||project.baseBranch===null)throw new Error('INVALID_BASE_BRANCH');
   if(project.configRevision!==envelope.configRevision)throw new Error('APPROVAL_STALE');
   const [{revision},{approval},eligibility]=await Promise.all([
     query({kind:'revision',id:feature.currentRevisionId}),query({kind:'approval',id:feature.currentRevisionId}),
     options.currentEligibility(peer,project.projectId),
   ]);
   if(!revision)throw new Error('APPROVAL_STALE');
   if(!eligibility.eligible||!eligibility.approvalId||!eligibility.revisionId||!eligibility.contextDigest||!eligibility.checkedAt){
     if(eligibility.reason==='UNKNOWN'||eligibility.reason==='CHECKING')throw new Error('CONTEXT_UNSTABLE');
     throw new Error(eligibility.reason==='APPROVAL_STALE'?'APPROVAL_STALE':'DISCOVERY_REQUIRED');
   }
   const proof:FeatureContextProof={projectId:project.projectId,configRevision:project.configRevision,
     discoveryApprovalId:eligibility.approvalId,discoveryRevisionId:eligibility.revisionId,contextDigest:eligibility.contextDigest,checkedAt:eligibility.checkedAt};
   const expected=requireWorkspaceHandoff(feature,revision,approval??null,envelope,proof,paths.ownerUid);
   if(digest(JSON.stringify(expected))!==envelope.digest)throw new Error('ARTIFACT_CORRUPT');
   const {artifact}=await readSealedFeatureArtifact(storage,revision.artifactId,'BUNDLE',262144,featureId);
   if(artifact.sha256!==revision.bundleDigest||artifact.state!=='REFERENCED')throw new Error('ARTIFACT_CORRUPT');
   return{project,baseBranch:project.baseBranch,feature,envelope,proof};
 }

 async function prepare(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer);
   const {feature,project,baseBranch,envelope,proof}=await prove(peer,String(params.featureId),String(params.envelopeId));
   const workspaceId=randomUUID(),ownerGeneration=randomUUID();
   const ownedRoot=await files.root(store.storeId),pin=await mutator.qualification();
   const draft={workspaceId,featureId:feature.featureId,ownedRoot,reference:project.referenceCheckout.root,
     adminDirectory:project.referenceCheckout.adminDirectory,commonDirectory:project.repositoryIdentity.commonDirectory,baseRef:`refs/heads/${baseBranch}`};
   const deadline=makeDeadline(systemClock,30000);
   const target:WorkspaceMutationTarget={...draft,baseOid:await mutator.resolveBase(draft,deadline)};
   requireProvisioningObservation(target.baseOid,await mutator.observe(target,deadline),'ABSENT');
   const intent:WorkflowIntent={version:1,namespace:'WORKSPACE',action:'create',storeId:store.storeId,ownerUid:paths.ownerUid,
     targetId:workspaceId,projectId:project.projectId,expectedRevision:feature.stateRevision,configRevision:project.configRevision,
     payload:{featureId:feature.featureId,envelopeId:envelope.envelopeId,envelopeDigest:envelope.digest,ownerGeneration,
       repositoryKey:project.repositoryKey,target,contextCheckedAt:proof.checkedAt,pin}};
   const grant=await authorization.prepare(peer,intent);
   return{grantId:grant.grantId,expiresAtMs:grant.expiresAtMs,canonicalIntentHash:digest(grant.canonicalIntent),
     summary:{workspaceId,featureId:feature.featureId,projectId:project.projectId,envelopeId:envelope.envelopeId,
       featureRevision:feature.stateRevision,baseRef:target.baseRef,baseOid:target.baseOid,branchRef:workspaceBranchRef(feature.featureId,workspaceId)}};
 }

 async function work(peer:AuthenticatedPeer,intent:WorkflowIntent,workspace:WorkspaceRecord,requestId:string){
   const commit=storage.commitWorkspaceState!.bind(storage);
   const fence={workspaceId:workspace.workspaceId,stateRevision:workspace.stateRevision,ownerGeneration:workspace.ownerGeneration};
   const operation={requestId,instanceId,fence};
   const claim={storeId:intent.storeId,repositoryKey:workspace.repositoryKey,requestId,ownerGeneration:workspace.ownerGeneration};
   const {target}=workspace,deadline=makeDeadline(systemClock,30000);
   let lease:Awaited<ReturnType<OwnedWorkspaceFilesPort['claim']>>|undefined,attempted=false;
   try{
     lease=await files.claim(claim);
     const current=await prove(peer,workspace.featureId,workspace.envelopeId);
     if(current.feature.stateRevision!==intent.expectedRevision||current.envelope.digest!==intent.payload.envelopeDigest)throw new Error('APPROVAL_STALE');
     const expected=intent.payload.pin as WorkspaceGitPin,actual=await mutator.qualification();
     if(expected.version!==actual.version||expected.sha256!==actual.sha256||expected.profileSha256!==actual.profileSha256)throw new Error('WORKSPACE_UNSAFE');
     requireProvisioningObservation(target.baseOid,await mutator.observe(target,deadline),'ABSENT');
     if(!options.accepting())throw new Error('INTERRUPTED');
     await commit({...operation,kind:'provision-dispatch',contextCheckedAt:current.proof.checkedAt});
     attempted=true;
     await mutator.createBranch(target,deadline);
     await commit({...operation,kind:'provision-step',observation:await mutator.observe(target,deadline)});
     const observation=await mutator.addWorktree(target,deadline);
     requireProvisioningObservation(target.baseOid,observation,'WORKTREE_ADDED');
     const markerDigest=await files.sealMarker(target.ownedRoot,{...claim,workspaceId:workspace.workspaceId,ownership:observation.worktree!});
     await commit({...operation,kind:'provision-step',observation,markerDigest});
     const {proof}=await prove(peer,workspace.featureId,workspace.envelopeId);
     const observed=await mutator.observe(target,deadline),marker=await files.readMarker(target.ownedRoot,workspace.workspaceId);
     requireProvisioningObservation(target.baseOid,observed,'WORKTREE_ADDED');
     if(marker?.digest!==markerDigest||JSON.stringify(marker.marker.ownership)!==JSON.stringify(observed.worktree))throw new Error('OWNERSHIP_UNPROVEN');
     await commit({...operation,kind:'provision-ready',contextCheckedAt:proof.checkedAt});
     await lease.settle();
   }catch(error){
     try{
       const result=await commit({...operation,kind:'provision-block',error:classifyError(error),uncertain:attempted});
       if(result.operation.phase==='FINALIZED')await lease?.settle();
     }catch{/* The durable reservation remains queryable if finalization cannot be verified. */}
   }finally{lease?.release();}
 }

 async function create(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,'create','WORKSPACE');
   if(original.operation)return{operation:publicWorkspaceOperation(original.operation)};
   const intent=original.intent;
   const {proof}=await prove(peer,String(intent.payload.featureId),String(intent.payload.envelopeId));
   if(!options.accepting())throw new Error('BLOCKED');
   const admission=workflowAdmission({requestId,grantId,intent,instanceId,nowMs:Date.now()});
   const result=await storage.commitWorkspaceState!({kind:'reserve',admission,contextCheckedAt:proof.checkedAt});
   if(!result.inserted)return{operation:publicWorkspaceOperation(result.operation)};
   const workspace=result.workspace!;
   options.schedule(()=>work(peer,intent,workspace,requestId));
   return{accepted:true,requestId,workspaceId:workspace.workspaceId,stateRevision:workspace.stateRevision};
 }

 return{
   actions:{'workspace.prepare':prepare,'workspace.create':create},
   async recover(){
     const {interrupted}=await storage.readWorkspaceState!({kind:'interrupted-provisioning'});
     for(const {requestId,workspace} of interrupted??[]){
       const {workspaceId,stateRevision,ownerGeneration}=workspace;
       await storage.commitWorkspaceState!({kind:'provision-interrupted',instanceId,requestId,fence:{workspaceId,stateRevision,ownerGeneration}});
     }
   },
 };
}
