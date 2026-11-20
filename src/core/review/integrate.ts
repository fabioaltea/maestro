import {randomUUID,createHash} from 'node:crypto';
import {featureObject} from '../../domain/features/bundle.js';
import {requireCandidateEvidence} from '../../domain/review/model.js';
import {requireIntegrationCandidate} from '../../domain/review/integration.js';
import {makeDeadline,systemClock,type Deadline} from '../../ports/clock.js';
import type {GitCandidateScope,GitIntegrationPort,GitIntegrationScope,IntegrationGuard} from '../../ports/git-integration.js';
import type {CandidatePreparationScope,IntegrationApprovalScope,ReviewRecord} from '../../ports/review.js';
import type {OwnedWorkspaceFilesPort,WorkspaceClaim,WorkspaceRecord} from '../../ports/workspace.js';
import type {WorkflowIntent} from '../../ports/workflow.js';
import {publicReviewOperation} from '../../protocol/review.js';
import {classifyError} from '../control-main.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {readReviewCriteria,reviewEvidenceDigest} from './criteria.js';
import {inspectReviewSource,type ReviewServicesOptions} from './snapshot.js';
import type {ReviewAction} from './dispatch.js';
import {settlePublishedIntegration} from './recovery.js';

export interface ReviewIntegrationPorts {readonly git:GitIntegrationPort;readonly files:OwnedWorkspaceFilesPort}
export function createReviewIntegration(options:ReviewServicesOptions&{
 readonly integration:ReviewIntegrationPorts;schedule(work:()=>Promise<void>):void;
}){
 const {storage,paths,instanceId,requireAccepting}=options,{git,files}=options.integration,auth=createWorkflowAuthorization(options);
 const query=storage.readReviewState!,commit=storage.commitReviewState!;
 const deadline=()=>makeDeadline(systemClock,30000);

 async function loadReview(id:string){
   const {review}=await query({kind:'review',id});
   if(!review)throw new Error('REVIEW_STALE');
   return review;
 }
 async function loadWorktree(id:string){
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id});
   if(!workspace?.ownership)throw new Error('OWNERSHIP_UNPROVEN');
   return{...workspace,ownership:workspace.ownership};
 }
 function sourceScope(r:ReviewRecord,workspace:WorkspaceRecord&{ownership:IntegrationGuard},guardId:string):GitIntegrationScope{
   return{source:workspace.target,ownership:workspace.ownership,sourceOid:r.sourceOid,targetRef:r.targetRef,targetOid:r.targetOid,guardId};
 }
 async function candidateContext(id:string){
   const {candidate}=await query({kind:'candidate',id});
   if(!candidate)throw new Error('CANDIDATE_CHANGED');
   const r=await loadReview(candidate.reviewId);
   const [source,guard,stage]=await Promise.all([loadWorktree(r.workspaceId),loadWorktree(candidate.guardId),loadWorktree(candidate.stagingId)]);
   if(guard.target.integration!=='GUARD'||stage.target.integration!=='STAGING'||guard.ownerGeneration!==stage.ownerGeneration)
     throw new Error('OWNERSHIP_UNPROVEN');
   const input:GitCandidateScope={...sourceScope(r,source,candidate.guardId),stagingId:candidate.stagingId,authoredAt:candidate.authoredAt};
   const staged={staging:stage.ownership,candidateOid:candidate.candidateOid,treeOid:candidate.treeOid};
   return{r,candidate,source,guard,stage,input,staged};
 }
 function claimFor(storeId:string,worktree:WorkspaceRecord,requestId:string,generation=worktree.ownerGeneration):WorkspaceClaim{
   return{storeId,repositoryKey:worktree.repositoryKey,requestId,ownerGeneration:generation};
 }
 async function approvedCandidate(id:string,d:Deadline){
   const selected=await candidateContext(id),{r,candidate,guard,stage,input,staged}=selected;
   const source=await inspectReviewSource(options,r);
   const [{evidence=[]},criteria]=await Promise.all([query({kind:'evidence',id:r.reviewId}),readReviewCriteria(storage,r)]);
   requireCandidateEvidence(criteria.filter(criterion=>criterion.required).map(criterion=>criterion.criterionId),evidence,candidate.treeOid);
   if(guard.state!=='READY'||stage.state!=='READY')throw new Error('WORKSPACE_IN_USE');
   await git.inspectCandidate(input,guard.ownership,staged,d);
   const scope:IntegrationApprovalScope={instanceId,reviewDigest:r.digest,candidateId:candidate.candidateId,candidateDigest:candidate.digest,
     evidenceDigest:reviewEvidenceDigest(evidence),guardRevision:guard.stateRevision,stagingRevision:stage.stateRevision};
   return{...selected,scope,projectRevision:source.project.configRevision};
 }

 const prepare:ReviewAction=async(params,peer)=>{
   const {store}=await auth.guard(peer),i=featureObject(params.intent),action=String(params.action),revision=featureObject(params.expectedRevisions).stateRevision;
   const base={version:1 as const,namespace:'REVIEW' as const,storeId:store.storeId,ownerUid:paths.ownerUid,action};
   let intent:WorkflowIntent,details:Record<string,unknown>;
   if(action==='candidate.prepare'){
     const r=await loadReview(String(i.reviewId)),{workspace,project}=await inspectReviewSource(options,r);
     if(r.stateRevision!==revision||!['DRAFT','READY_FOR_APPROVAL','BLOCKED','CHANGES_REQUESTED'].includes(r.state))throw new Error('REVIEW_STALE');
     const scope:CandidatePreparationScope={instanceId,guardId:randomUUID(),stagingId:randomUUID(),generation:randomUUID(),
       authoredAt:new Date().toISOString(),reviewDigest:r.digest,workspaceRevision:workspace.stateRevision};
     const observed=await git.preflight(sourceScope(r,workspace,scope.guardId),deadline());
     intent={...base,targetId:r.reviewId,projectId:r.projectId,expectedRevision:r.stateRevision,configRevision:project.configRevision,payload:{...scope}};
     details={strategy:observed.fastForward?'FAST_FORWARD':'MERGE_COMMIT',author:observed.fastForward?null:'Maestro <maestro@localhost>',
       sourceOid:r.sourceOid,targetRef:r.targetRef,targetOid:r.targetOid};
   }else{
     const {r,candidate,scope,projectRevision}=await approvedCandidate(String(i.candidateId),deadline());
     if(r.stateRevision!==revision)throw new Error('REVIEW_STALE');
     let decisionId:string|undefined;
     if(action==='approve'){
       if(r.state!=='READY_FOR_APPROVAL'||i.reviewId!==r.reviewId||i.evidenceDigest!==scope.evidenceDigest)throw new Error('APPROVAL_STALE');
     }else{
       const {decision}=await query({kind:'decision',id:String(i.decisionId)});
       if(r.state!=='APPROVED'||i.expectedTargetOid!==r.targetOid||decision?.candidateId!==candidate.candidateId||
         decision.evidenceDigest!==scope.evidenceDigest)throw new Error('APPROVAL_STALE');
       decisionId=decision.decisionId;
     }
     intent={...base,targetId:action==='approve'?r.reviewId:candidate.candidateId,projectId:r.projectId,expectedRevision:r.stateRevision,
       configRevision:projectRevision,payload:{...scope,...(decisionId?{decisionId,expectedTargetOid:r.targetOid}:{})}};
     details={reviewId:r.reviewId,targetRef:r.targetRef,targetOid:r.targetOid,candidateOid:candidate.candidateOid,treeOid:candidate.treeOid,
       evidenceDigest:scope.evidenceDigest};
   }
   requireAccepting();
   const grant=await auth.prepare(peer,intent);
   return{grantId:grant.grantId,canonicalIntentHash:createHash('sha256').update(grant.canonicalIntent).digest('hex'),expiresAt:grant.expiresAtMs,
     summary:{action,targetId:intent.targetId,projectId:intent.projectId,stateRevision:intent.expectedRevision,...details}};
 };

 async function buildCandidate(requestId:string,intent:WorkflowIntent){
   const scope=intent.payload as unknown as CandidatePreparationScope;
   let lease:Awaited<ReturnType<typeof files.claim>>|undefined;
   try{
     requireAccepting();
     const r=await loadReview(intent.targetId!),{workspace}=await inspectReviewSource(options,r);
     const claim=claimFor(intent.storeId,workspace,requestId,scope.generation),input={...sourceScope(r,workspace,scope.guardId),
       stagingId:scope.stagingId,authoredAt:scope.authoredAt};
     lease=await files.claim(claim);
     const d=deadline();
     const own=async(role:'GUARD'|'STAGING',workspaceId:string,ownership:IntegrationGuard)=>{
       const markerDigest=await files.sealMarker(workspace.target.ownedRoot,{...claim,workspaceId,ownership});
       await commit({kind:'candidate-owned',requestId,instanceId,role,ownership,markerDigest});
     };
     requireAccepting();
     const guard=await git.reserveGuard(input,d);
     await own('GUARD',scope.guardId,guard);
     requireAccepting();
     const outcome=await git.prepareCandidate(input,guard,d);
     await own('STAGING',scope.stagingId,outcome.kind==='READY'?outcome.candidate.staging:outcome.staging);
     if(outcome.kind==='CONFLICT')throw new Error('MERGE_CONFLICT');
     const {candidateOid,treeOid}=outcome.candidate;
     await commit({kind:'candidate-finish',requestId,instanceId,candidateOid,treeOid});
   }catch(error){
     await commit({kind:'candidate-block',requestId,instanceId,error:classifyError(error)}).catch(()=>{});
   }finally{lease?.release();}
 }

 async function publish(requestId:string,intent:WorkflowIntent,recovering?:true){
   let lease:Awaited<ReturnType<typeof files.claim>>|undefined;
   try{
     const selected=await candidateContext(String(intent.payload.candidateId)),{r,candidate,guard,input,staged}=selected;
     const claim=claimFor(intent.storeId,guard,candidate.candidateId);
     lease=await files.claim(claim);
     const d=deadline();
     if(!recovering){
       const current=await approvedCandidate(candidate.candidateId,d),previous=intent.payload as unknown as IntegrationApprovalScope;
       const actual={candidateOid:candidate.candidateOid,treeOid:candidate.treeOid,targetOid:r.targetOid,guardId:candidate.guardId,
         stagingId:candidate.stagingId,reviewDigest:r.digest,evidenceDigest:current.scope.evidenceDigest};
       requireIntegrationCandidate({...actual,reviewDigest:previous.reviewDigest,evidenceDigest:previous.evidenceDigest},
         {...actual,targetReserved:true,guardClean:true,stagingClean:true,conflict:false});
       if(r.stateRevision!==intent.expectedRevision||current.projectRevision!==intent.configRevision||
          current.scope.guardRevision!==previous.guardRevision||current.scope.stagingRevision!==previous.stagingRevision)throw new Error('APPROVAL_STALE');
       requireAccepting();
       await commit({kind:'integration-verify',requestId,instanceId});
       requireAccepting();
       await git.publishCandidate(input,guard.ownership,staged,requestId,d);
     }
     const expected={requestId,old:r.targetOid,candidate:candidate.candidateOid};
     await settlePublishedIntegration({storage,instanceId,git},input,guard.ownership,expected,d,recovering);
     await lease.settle();
     await storage.settleWorkspaceClaim!(claim);
   }catch{
     await commit({kind:'integration-block',requestId,instanceId,...(recovering?{recovering}:{})}).catch(()=>{});
   }finally{lease?.release();}
 }

 const actions:Record<string,ReviewAction>={};
 for(const action of ['candidate.prepare','approve','integrate'] as const){
   actions[`review.${action}`]=async(params,peer)=>{
     await auth.guard(peer);
     const requestId=String(params.requestId),grantId=String(params.grantId);
     const {intent,operation}=await originalWorkflowGrant(storage,requestId,grantId,action,'REVIEW');
     if(operation)return{operation:publicReviewOperation(operation)};
     if(intent.payload.instanceId!==instanceId)throw new Error('APPROVAL_STALE');
     if(action!=='candidate.prepare'){
       const {scope,projectRevision,r}=await approvedCandidate(String(intent.payload.candidateId),deadline());
       if(projectRevision!==intent.configRevision||r.stateRevision!==intent.expectedRevision||
          !Object.entries(scope).every(([key,value])=>intent.payload[key]===value))throw new Error('APPROVAL_STALE');
     }
     requireAccepting();
     const kind=action==='candidate.prepare'?'candidate-admit':action==='integrate'?'integrate-admit':'approve';
     const result=await commit({kind,admission:workflowAdmission({requestId,grantId,instanceId,nowMs:Date.now(),intent})});
     if(!result.inserted||action==='approve')return{operation:publicReviewOperation(result.operation)};
     options.schedule(()=>action==='candidate.prepare'?buildCandidate(requestId,intent):publish(requestId,intent));
     return{accepted:true,requestId,entityId:intent.targetId,operationId:requestId,stateRevision:result.operation.result!.stateRevision};
   };
 }
 return{prepare,actions,async recover(){
   const {operations=[]}=await query({kind:'pending-integration'});
   for(const operation of operations){
     if(operation.action==='candidate.prepare'){
       await commit({kind:'candidate-block',requestId:operation.requestId,instanceId,recovering:true,error:'INTEGRATION_UNKNOWN'});
       continue;
     }
     await publish(operation.requestId,JSON.parse(operation.canonicalIntent) as WorkflowIntent,true);
   }
 }};
}
