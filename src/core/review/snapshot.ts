import {createHash,randomUUID} from 'node:crypto';
import {partitionReviewDiff} from '../../domain/review/model.js';
import {reviewOid,reviewTargetRef} from '../../domain/review/state.js';
import {featureFields,featureObject} from '../../domain/features/bundle.js';
import type {GitIntegrationPort,ReviewRecord} from '../../ports/review.js';
import type {WorkspaceRecord} from '../../ports/workspace.js';
import type {DiscoveryEligibility} from '../../domain/discovery/approval.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {StoragePort} from '../../ports/storage.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import {publicReviewOperation} from '../../protocol/review.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {publishPlanningArtifact,readSealedFeatureArtifact} from '../features/artifacts.js';
import type {ReviewAction} from './dispatch.js';

const digest=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export interface ReviewServicesOptions {
 readonly storage:StoragePort;readonly instanceId:string;readonly paths:ArchivePaths;
 readonly git:Pick<GitIntegrationPort,'captureDiff'>;
 readonly currentEligibility:(peer:AuthenticatedPeer,projectId:string)=>Promise<DiscoveryEligibility>;
 readonly captureCheckpoint:(w:WorkspaceRecord)=>Promise<{readonly treeDigest:string;readonly patch:Uint8Array}>;
 readonly requireAccepting:()=>void;
}
export function createReviewSnapshotServices(options:ReviewServicesOptions):Readonly<Record<string,ReviewAction>>{
 const {storage,instanceId,paths,git,requireAccepting}=options,auth=createWorkflowAuthorization(options);
 async function inspect(p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const targetRef=reviewTargetRef(p.targetRef),targetOid=reviewOid(p.targetOid);
   const {feature}=await storage.readFeatureState!({kind:'feature',id:String(p.featureId)});
   const {checkpoint}=await storage.readExecutionState!({kind:'checkpoint',id:String(p.checkpointId)});
   if(!feature||feature.state!=='APPROVED'||!checkpoint)throw new Error('REVIEW_STALE');
   const [{session},{run}]=await Promise.all([storage.readExecutionState!({kind:'session',id:checkpoint.sessionId}),
     storage.readExecutionState!({kind:'run',id:checkpoint.runId})]);
   if(!session||session.featureId!==feature.featureId||session.checkpointId!==checkpoint.checkpointId||session.runId!==checkpoint.runId||
      !run||run.phase!=='FINALIZED'||run.proof?.verified!==true||!['READY_FOR_REVIEW','PAUSED','INTERRUPTED'].includes(session.state))
     throw new Error('SOURCE_NOT_QUIESCENT');
   const [{workspace},{lease},{envelope},project]=await Promise.all([
     storage.readWorkspaceState!({kind:'get',id:session.workspaceId}),storage.readWorkspaceState!({kind:'active-lease',id:session.workspaceId}),
     storage.readFeatureState!({kind:'envelope',id:session.envelopeId}),storage.getProject(feature.projectId),
   ]);
   if(!workspace?.ownership||workspace.state!=='READY'||lease)throw new Error('SOURCE_NOT_QUIESCENT');
   if(!envelope||envelope.featureId!==feature.featureId||envelope.revisionId!==feature.currentRevisionId||!project||
      project.project.removedAt!==null||project.project.configRevision!==envelope.configRevision)throw new Error('REVIEW_STALE');
   const discovery=await options.currentEligibility(peer,feature.projectId);
   if(!discovery.eligible||discovery.approvalId!==envelope.discoveryApprovalId||discovery.contextDigest!==envelope.contextDigest)
     throw new Error('REVIEW_STALE');
   const sealed=await readSealedFeatureArtifact(storage,checkpoint.patchArtifactId,'CHECKPOINT',262144,session.sessionId);
   if(sealed.artifact.sha256!==checkpoint.digest)throw new Error('ARTIFACT_CORRUPT');
   let patch:Record<string,unknown>;
   try{
     patch=featureObject(JSON.parse(sealed.text));featureFields(patch,['version','baseOid','trackedDiff','untracked']);
     if(patch.version!==1||!Array.isArray(patch.untracked)||typeof patch.trackedDiff!=='string')throw new Error();
     reviewOid(patch.baseOid);
   }catch{throw new Error('ARTIFACT_CORRUPT');}
   if((patch.untracked as unknown[]).length!==0||patch.trackedDiff!=='')throw new Error('SOURCE_NOT_QUIESCENT');
   const current=await options.captureCheckpoint(workspace);
   if(current.treeDigest!==checkpoint.treeDigest||digest(current.patch)!==checkpoint.digest)throw new Error('REVIEW_STALE');
   const evidence=await git.captureDiff({source:workspace.target,ownership:workspace.ownership,targetRef,targetOid,
     sourceOid:reviewOid(patch.baseOid),guardId:randomUUID()},makeDeadline(systemClock,12000));
   const raw=partitionReviewDiff(evidence.diff,evidence.fileCount);
   const partDescriptors=raw.map(bytes=>({bytes:bytes.length,sha256:digest(bytes)}));
   const payload={featureId:feature.featureId,checkpointId:checkpoint.checkpointId,workspaceId:workspace.workspaceId,
     workspaceRevision:workspace.stateRevision,featureRevisionId:feature.currentRevisionId,targetRef,targetOid,
     sourceOid:evidence.sourceOid,sourceTreeOid:evidence.sourceTreeOid,diffBytes:evidence.diff.length,fileCount:evidence.fileCount,partDescriptors};
   return{feature,configRevision:project.project.configRevision,payload:{...payload,digest:digest(JSON.stringify(payload))},raw};
 }
 async function prepare(p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const snapshot=await auth.guard(peer),input=featureObject(p.intent),action=String(p.action);
   const base={version:1 as const,namespace:'REVIEW' as const,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid};
   let i:WorkflowIntent;
   if(action==='create'){
     const selected=await inspect(input,peer);
     i={...base,action,targetId:selected.feature.featureId,projectId:selected.feature.projectId,expectedRevision:selected.feature.stateRevision,
       configRevision:selected.configRevision,payload:{...selected.payload,instanceId}};
   }else if(action==='request-changes'){
     const {review}=await storage.readReviewState!({kind:'review',id:String(input.reviewId)});
     if(!review||featureObject(p.expectedRevisions).stateRevision!==review.stateRevision)throw new Error('REVIEW_STALE');
     const a=await readSealedFeatureArtifact(storage,String(input.feedbackArtifactId),'INPUT',262144,review.featureId);
     i={...base,action,targetId:review.reviewId,projectId:review.projectId,expectedRevision:review.stateRevision,configRevision:null,
       payload:{digest:review.digest,feedbackArtifactId:a.artifact.artifactId,instanceId}};
   }else throw new Error('UNSUPPORTED_VERSION');
   requireAccepting();
   const grant=await auth.prepare(peer,i);
   return{grantId:grant.grantId,canonicalIntentHash:digest(grant.canonicalIntent),summary:grant.summary,expiresAt:grant.expiresAtMs};
 }
 const actions:Record<string,ReviewAction>={'review.prepare':prepare};
 for(const action of ['create','request-changes'] as const){
   actions[`review.${action}`]=async(p,peer)=>{
     const snapshot=await auth.guard(peer),requestId=String(p.requestId);
     const {grant,intent,operation}=await originalWorkflowGrant(storage,requestId,String(p.grantId),action,'REVIEW');
     if(operation)return{operation:publicReviewOperation(operation)};
     requireAccepting();
     if(intent.payload.instanceId!==instanceId)throw new Error('APPROVAL_STALE');
     const a=workflowAdmission({requestId,grantId:grant.grantId,instanceId,nowMs:Date.now(),intent});
     if(action==='request-changes'){
       const {operation}=await storage.commitReviewState!({kind:action,admission:a});
       return{operation:publicReviewOperation(operation)};
     }
     const selected=await inspect(intent.payload,peer),r=selected.payload;
     if(r.digest!==intent.payload.digest||selected.feature.stateRevision!==intent.expectedRevision||selected.configRevision!==intent.configRevision)
       throw new Error('REVIEW_STALE');
     const parts:ReviewRecord['parts'][number][]=[];
     for(const chunk of selected.raw){
       requireAccepting();
       const art=await publishPlanningArtifact({storage,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,instanceId,targetId:selected.feature.featureId},
         'BUNDLE',chunk);
       parts.push({artifactId:art.artifactId,bytes:art.expectedBytes,sha256:art.sha256});
     }
     const v:ReviewRecord={...r,reviewId:requestId,projectId:selected.feature.projectId,state:'DRAFT',stateRevision:'1',createdAt:'',parts};
     requireAccepting();
     const {operation:completed}=await storage.commitReviewState!({kind:action,admission:a,snapshot:v});
     return{operation:publicReviewOperation(completed)};
   };
 }
 return actions;
}
