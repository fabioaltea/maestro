import {createHash} from 'node:crypto';
import {reviewCleanupCheck,reviewCompletion} from '../../domain/review/completion.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import type {ReviewReceiptRecord} from '../../ports/review.js';
import type {WorkspacePort} from '../../ports/workspace.js';
import type {WorkflowIntent} from '../../ports/workflow.js';
import {publicReviewOperation} from '../../protocol/review.js';
import {classifyError} from '../control-main.js';
import {workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {inspectWorkspaceCleanup} from '../workspaces/remove.js';
import type {ReviewAction} from './dispatch.js';
import type {ReviewServicesOptions} from './snapshot.js';
import type {ReviewIntegrationPorts} from './integrate.js';
import {reviewContextImpact} from './context-impact.js';

export function createReviewCompletion(options:ReviewServicesOptions&{
 readonly integration:ReviewIntegrationPorts;readonly workspaceGit:WorkspacePort;
}){
 const {storage,instanceId,paths,requireAccepting,workspaceGit}=options,{git,files}=options.integration;
 const query=storage.readReviewState!,auth=createWorkflowAuthorization(options);

 const complete:ReviewAction=async(p,peer)=>{
   const {store}=await auth.guard(peer),requestId=String(p.requestId),integrationId=String(p.integrationId);
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   if(operation){
     const original=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
     if(original.namespace!=='REVIEW'||original.action!=='complete'||original.targetId!==integrationId||original.expectedRevision!==p.expectedStateRevision)
       throw new Error('IDEMPOTENCY_CONFLICT');
     return{operation:publicReviewOperation(operation)};
   }
   const {integration}=await query({kind:'integration',id:integrationId});
   if(!integration||integration.phase!=='FINALIZED'||!integration.proof?.guardSynced)throw new Error('INTEGRATION_UNKNOWN');
   const [{candidate},{decision}]=await Promise.all([query({kind:'candidate',id:integration.candidateId}),query({kind:'decision',id:integration.decisionId})]);
   if(!candidate||!decision)throw new Error('INTEGRATION_UNKNOWN');
   const {review}=await query({kind:'review',id:candidate.reviewId});
   if(!review||review.stateRevision!==p.expectedStateRevision)throw new Error('REVIEW_STALE');
   const [{workspace},project]=await Promise.all([storage.readWorkspaceState!({kind:'get',id:review.workspaceId}),storage.getProject(review.projectId)]);
   if(!workspace?.ownership||!project||project.project.removedAt!==null)throw new Error('REVIEW_STALE');
   const observed=await git.inspectCompletion({source:workspace.target,ownership:workspace.ownership,targetRef:review.targetRef,
     targetOid:review.targetOid,sourceOid:review.sourceOid,guardId:candidate.guardId},integration.proof,makeDeadline(systemClock,8000));
   if(observed.treeOid!==candidate.treeOid)throw new Error('INTEGRATION_UNKNOWN');
   const documentationDigest=createHash('sha256').update(JSON.stringify(observed.documentation)).digest('hex');
   const context=await reviewContextImpact(options,review,observed.changedPaths,peer);
   const result=reviewCompletion({integrationId,reviewId:review.reviewId,workspaceId:review.workspaceId,projectId:review.projectId,
     sourceOid:review.sourceOid,targetRef:integration.targetRef,expectedTargetOid:integration.targetOid,candidateOid:candidate.candidateOid,
     documentationDigest},{observedTargetOid:observed.targetOid,proof:{...integration.proof,guardSynced:true},
     documentationDigest,contextImpact:context.impact});
   const documents:ReviewReceiptRecord['documents'][number][]=[];
   let length=0;
   for(const doc of observed.documentation){
     const bytes=Buffer.byteLength(JSON.stringify(doc))+1;
     if(length+bytes>5800)break;
     documents.push(doc);length+=bytes;
   }
   const receipt:ReviewReceiptRecord={...result,receiptId:requestId,treeOid:candidate.treeOid,featureRevisionId:review.featureRevisionId,
     evidenceDigest:decision.evidenceDigest,documents,documentCount:observed.documentation.length,documentsTruncated:documents.length<observed.documentation.length};
   const intent:WorkflowIntent={version:1,namespace:'REVIEW',action:'complete',storeId:store.storeId,ownerUid:paths.ownerUid,
     targetId:integrationId,projectId:review.projectId,expectedRevision:review.stateRevision,configRevision:project.project.configRevision,payload:{}};
   requireAccepting();
   const written=await storage.commitReviewState!({kind:'complete',receipt,invalidate:context.invalidate,
     admission:workflowAdmission({requestId,grantId:null,instanceId,nowMs:Date.now(),intent})});
   return{operation:publicReviewOperation(written.operation)};
 };

 const preview:ReviewAction=async(p,peer)=>{
   const {store}=await auth.guard(peer),integrationId=String(p.integrationId),workspaceId=String(p.workspaceId);
   const {receipt}=await query({kind:'receipt',id:integrationId});
   if(!receipt||receipt.workspaceId!==workspaceId)throw new Error('OPERATION_NOT_FOUND');
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id:workspaceId});
   const base={integrationId,workspaceId,freshness:'CURRENT'},at=Date.now();
   try{
     if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
     const d=makeDeadline(systemClock,9000);
     const target={targetRef:receipt.targetRef,targetOid:receipt.resultingOid};
     const {worktree,status}=await inspectWorkspaceCleanup({storage,files,mutator:workspaceGit},store.storeId,workspace,target,d);
     const plan=reviewCleanupCheck(receipt,{state:workspace.state,holder:false,effect:false,observedTargetOid:receipt.resultingOid,
       status,integrated:true,headOid:worktree.headOid,checkedAt:at,expiresAt:at+300000},Date.now());
     return{...base,...plan,eligible:true,reason:null,checkedAt:new Date(at).toISOString()};
   }catch(error){return{...base,eligible:false,reason:classifyError(error),checkedAt:new Date(at).toISOString(),cleanupGrantRequired:true};}
 };
 return{'review.complete':complete,'review.cleanup.preview':preview};
}
