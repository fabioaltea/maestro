import {createHash,randomUUID} from 'node:crypto';
import {featureObject} from '../../domain/features/bundle.js';
import {requireEnvironmentValidation} from '../../domain/environments/validation.js';
import {requireCleanReviewCheckpoint} from '../../domain/review/model.js';
import type {EnvironmentDelegatedCheck} from '../../ports/environment.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {ReviewRecord,ReviewValidationScope} from '../../ports/review.js';
import type {WorkflowIntent,WorkflowOperationRecord} from '../../ports/workflow.js';
import {publicReviewOperation} from '../../protocol/review.js';
import {currentEnvironmentPlan} from '../environments/plan.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {readReviewCriteria} from './criteria.js';
import type {ReviewAction} from './dispatch.js';
import {inspectReviewSource,type ReviewServicesOptions} from './snapshot.js';

export type RunReviewCheck=(check:EnvironmentDelegatedCheck,peer:AuthenticatedPeer)=>Promise<void>;

export function createReviewValidation(options:ReviewServicesOptions&{
 readonly runCheck:RunReviewCheck;schedule(work:()=>Promise<void>):void;
}){
 const {storage,paths,instanceId,runCheck,requireAccepting}=options,auth=createWorkflowAuthorization(options);

 async function load(reviewId:string){
   const {review}=await storage.readReviewState!({kind:'review',id:reviewId});
   if(!review)throw new Error('REVIEW_STALE');
   return review;
 }

 async function subject(review:ReviewRecord){
   const source=await inspectReviewSource(options,review),{candidate}=await storage.readReviewState!({kind:'current-candidate',id:review.reviewId});
   if(!candidate)return{workspace:source.workspace,project:source.project,treeDigest:source.checkpoint.treeDigest,
     treeOid:review.sourceTreeOid,candidateId:undefined};
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id:candidate.stagingId});
   if(!workspace?.ownership||workspace.target.integration!=='STAGING'||workspace.state!=='READY')throw new Error('CANDIDATE_CHANGED');
   const current=await options.captureCheckpoint(workspace),digest=createHash('sha256').update(current.patch).digest('hex');
   const observed={tree:current.treeDigest,digest,revision:review.featureRevisionId};
   const oid=requireCleanReviewCheckpoint(JSON.parse(Buffer.from(current.patch).toString('utf8')),observed,observed);
   if(oid!==candidate.candidateOid)throw new Error('CANDIDATE_CHANGED');
   return{workspace,project:source.project,treeDigest:current.treeDigest,treeOid:candidate.treeOid,candidateId:candidate.candidateId};
 }

 const prepare:ReviewAction=async(params,peer)=>{
   const {store}=await auth.guard(peer),p=featureObject(params.intent),revision=featureObject(params.expectedRevisions).stateRevision;
   const review=await load(String(p.reviewId));
   if(review.stateRevision!==revision||!['DRAFT','READY_FOR_APPROVAL','BLOCKED'].includes(review.state))throw new Error('REVIEW_STALE');
   const {workspace,treeDigest,treeOid,candidateId,project}=await subject(review);
   const [{environment,plan},criteria]=await Promise.all([currentEnvironmentPlan(storage,workspace.workspaceId),readReviewCriteria(storage,review)]);
   if(plan.configRevision!==project.configRevision||plan.workspaceGeneration!==workspace.ownerGeneration)throw new Error('ENVIRONMENT_STALE');
   const checks=(p.commandSpecIds as string[]).map(commandSpecId=>{
     const spec=requireEnvironmentValidation({state:environment.state,preparedDigest:environment.preparedDigest,inputDigest:plan.inputDigest,
       expectedInputDigest:plan.inputDigest,commandSpecId,commands:plan.metadata.commands??[]});
     return{jobId:randomUUID(),workspaceId:workspace.workspaceId,treeDigest,planId:plan.planId,planDigest:plan.digest,
       inputDigest:plan.inputDigest,commandSpecId:spec.id,commandDigest:spec.sha256};
   });
   const scope:ReviewValidationScope={instanceId,reviewDigest:review.digest,treeOid,workspaceRevision:workspace.stateRevision,...(candidateId?{candidateId}:{}),
     checks,criteria:criteria.map(({criterionId,required,verification})=>({criterionId,required,proofId:randomUUID(),
       commandSpecId:checks.find(check=>verification===`command:${check.commandSpecId}`)?.commandSpecId??null}))};
   requireAccepting();
   const grant=await auth.prepare(peer,{version:1,namespace:'REVIEW',action:'validate',storeId:store.storeId,ownerUid:paths.ownerUid,
     targetId:review.reviewId,projectId:review.projectId,expectedRevision:review.stateRevision,configRevision:project.configRevision,payload:{...scope}});
   return{grantId:grant.grantId,canonicalIntentHash:createHash('sha256').update(grant.canonicalIntent).digest('hex'),expiresAt:grant.expiresAtMs,
     summary:{action:'validate',reviewId:review.reviewId,treeOid:scope.treeOid,stateRevision:review.stateRevision,planId:plan.planId,
       checks:checks.map(({commandSpecId,commandDigest})=>({commandSpecId,commandDigest}))}};
 };

 async function settle(operation:WorkflowOperationRecord,scope:ReviewValidationScope,recovering?:true){
   let treeCurrent=false;
   try{
     const review=await load(operation.targetId!),observed=await subject(review);
     treeCurrent=observed.candidateId===scope.candidateId&&observed.treeOid===scope.treeOid&&scope.checks.every(check=>check.treeDigest===observed.treeDigest);
   }catch{/* A failed observation cannot attest a current tree. */}
   return storage.commitReviewState!({kind:'validate-finish',instanceId,requestId:operation.requestId,treeCurrent,...(recovering?{recovering}:{})});
 }

 const submit:ReviewAction=async(params,peer)=>{
   await auth.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const {operation,intent}=await originalWorkflowGrant(storage,requestId,grantId,'validate','REVIEW');
   if(operation)return{operation:publicReviewOperation(operation)};
   const scope=intent.payload as unknown as ReviewValidationScope;
   const review=await load(intent.targetId!),{workspace,treeDigest,treeOid,candidateId,project}=await subject(review);
   if(scope.instanceId!==instanceId||scope.workspaceRevision!==workspace.stateRevision||intent.configRevision!==project.configRevision||
      scope.candidateId!==candidateId||scope.treeOid!==treeOid||scope.checks.some(check=>check.treeDigest!==treeDigest))throw new Error('APPROVAL_STALE');
   requireAccepting();
   const result=await storage.commitReviewState!({kind:'validate-admit',admission:workflowAdmission({requestId,grantId,instanceId,nowMs:Date.now(),intent})});
   if(!result.inserted)return{operation:publicReviewOperation(result.operation)};
   options.schedule(async()=>{
     try{
       for(const check of scope.checks){
         requireAccepting();
         await runCheck(check,peer);
       }
     }catch{/* The writer settles only jobs that are durably attributable to this review. */}
     await settle(result.operation,scope);
   });
   return{accepted:true,requestId,entityId:review.reviewId,stateRevision:result.operation.result!.stateRevision,jobIds:scope.checks.map(check=>check.jobId)};
 };

 return{prepare,submit,async recover(){
   const {operations=[]}=await storage.readReviewState!({kind:'pending-validation'});
   for(const op of operations){
     const {payload}=JSON.parse(op.canonicalIntent) as WorkflowIntent;
     await settle(op,payload as unknown as ReviewValidationScope,true);
   }
 }};
}
