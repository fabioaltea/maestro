import {createHash} from 'node:crypto';
import {join} from 'node:path';
import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {requireRefAttribution} from '../domain/review/integration.js';
import {reviewOid} from '../domain/review/state.js';
import {requireWorkspaceCapacity} from '../domain/workspaces/model.js';
import type {CandidatePreparationScope,IntegrationApprovalScope,IntegrationChange,ReviewCandidateRecord,ReviewEvidence,ReviewRecord} from '../ports/review.js';
import type {WorkspaceRecord} from '../ports/workspace.js';
import type {FeatureRow} from './features-store.js';
import type {createWorkflowStore} from './workflow-store.js';
import {readWorkspaceState} from './workspaces-store.js';
import {readEnvironmentState} from './environments-store.js';
import {readReviewState,requireReviewOwner} from './review-store.js';
import {reviewEvidenceDigest} from '../core/review/criteria.js';

type Ledger=ReturnType<typeof createWorkflowStore>;
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

function workspace(db:Database.Database,id:string){
 const {workspace:record}=readWorkspaceState(db,{kind:'get',id});
 if(!record)throw new Error('WORKSPACE_NOT_FOUND');
 return record;
}
function review(db:Database.Database,id:string){
 const {review:record}=readReviewState(db,{kind:'review',id});
 if(!record)throw new Error('REVIEW_STALE');
 return record;
}
function candidate(db:Database.Database,id:string){
 const {candidate:record}=readReviewState(db,{kind:'candidate',id});
 if(!record)throw new Error('CANDIDATE_CHANGED');
 return record;
}
function requireProject(db:Database.Database,r:ReviewRecord,configRevision:string|null){
 if(!db.prepare(`SELECT 1 FROM projects p JOIN features_records f USING(project_id)
   JOIN features_revisions v ON v.revision_id=f.current_revision_id
   JOIN discovery_approvals a ON a.approval_id=v.discovery_approval_id JOIN discoveries d USING(discovery_id)
   WHERE f.feature_id=? AND f.state='APPROVED' AND f.current_revision_id=? AND p.config_revision=? AND p.removed_at IS NULL
     AND d.state='APPROVED' AND d.config_revision=p.config_revision AND d.latest_document_revision_id=a.revision_id`)
   .get(r.featureId,r.featureRevisionId,BigInt(configRevision!)))throw new Error('REVIEW_STALE');
}
function ready(db:Database.Database,w:WorkspaceRecord){
 if(w.state!=='READY'||!w.ownership||readWorkspaceState(db,{kind:'active-lease',id:w.workspaceId}).lease)throw new Error('WORKSPACE_IN_USE');
}
function stepReview(db:Database.Database,r:ReviewRecord,state:ReviewRecord['state']){
 const revision=String(BigInt(r.stateRevision)+1n);
 db.prepare('UPDATE review_records SET state=?,state_revision=? WHERE review_id=?').run(state,BigInt(revision),r.reviewId);
 return revision;
}

function admission(db:Database.Database,c:Extract<IntegrationChange,{admission:unknown}>,ledger:Ledger,verify:(id:string)=>void){
 const a=c.admission,i=ledger.intent(a.canonicalIntent),p=i.payload;
 const expected=c.kind==='candidate-admit'?'candidate.prepare':c.kind==='integrate-admit'?'integrate':'approve';
 if(i.namespace!=='REVIEW'||i.action!==expected)throw new Error('INVALID_REQUEST');
 return ledger.admit(a,()=>{
   requireReviewOwner(db,a.instanceId,'RUNNING');
   if(p.instanceId!==a.instanceId)throw new Error('APPROVAL_STALE');
   const selected=c.kind==='candidate-admit'?null:candidate(db,requireUuid(p.candidateId));
   const r=review(db,selected?.reviewId??requireUuid(i.targetId));
   if(r.projectId!==i.projectId||r.digest!==p.reviewDigest||r.stateRevision!==i.expectedRevision)throw new Error('REVIEW_STALE');
   requireProject(db,r,i.configRevision);
   const source=workspace(db,r.workspaceId),at=new Date().toISOString();
   ready(db,source);
   if(c.kind==='candidate-admit'){
     const scope=p as unknown as CandidatePreparationScope;
     if(!['DRAFT','READY_FOR_APPROVAL','BLOCKED','CHANGES_REQUESTED'].includes(r.state)||source.stateRevision!==scope.workspaceRevision)
       throw new Error('REVIEW_STALE');
     if(db.prepare("SELECT 1 FROM workspaces_effects WHERE repository_key=? AND phase<>'RESOLVED'").get(source.repositoryKey))
       throw new Error('WORKSPACE_IN_USE');
     const count=db.prepare("SELECT count(*) AS n FROM workspaces_records WHERE state<>'REMOVED'").get() as FeatureRow;
     requireWorkspaceCapacity(Number(count.n)+1);
     const guardId=requireUuid(scope.guardId),stagingId=requireUuid(scope.stagingId),generation=requireUuid(scope.generation);
     if(guardId===stagingId||guardId===source.workspaceId||stagingId===source.workspaceId)throw new Error('INVALID_REQUEST');
     const insert=db.prepare(`INSERT INTO workspaces_records(workspace_id,feature_id,project_id,envelope_id,repository_key,state,state_revision,
        owner_generation,target,created_at,updated_at,purpose) VALUES(?,?,?,?,?,'REQUESTED',1,?,?,?,?,?)`);
     for(const [id,role] of [[guardId,'GUARD'],[stagingId,'STAGING']] as const){
       const target={...source.target,workspaceId:id,baseRef:r.targetRef,baseOid:r.targetOid,integration:role};
       insert.run(id,r.featureId,r.projectId,source.envelopeId,source.repositoryKey,generation,JSON.stringify(target),at,at,`INTEGRATION_${role}`);
     }
     db.prepare("INSERT INTO workspaces_effects(request_id,workspace_id,repository_key,owner_generation,phase) VALUES(?,?,?,?,'INTENT')")
       .run(a.requestId,guardId,source.repositoryKey,generation);
     const stateRevision=stepReview(db,r,'DRAFT');
     db.prepare("UPDATE workflow_operations SET phase='WORKING',result=? WHERE request_id=?")
       .run(JSON.stringify({reviewId:r.reviewId,candidateId:a.requestId,stateRevision}),a.requestId);
     return;
   }
   const scope=p as unknown as IntegrationApprovalScope;
   if(!selected||selected.digest!==scope.candidateDigest)throw new Error('CANDIDATE_CHANGED');
   const guard=workspace(db,selected.guardId),staging=workspace(db,selected.stagingId);
   ready(db,guard);ready(db,staging);
   if(guard.stateRevision!==scope.guardRevision||staging.stateRevision!==scope.stagingRevision)throw new Error('CANDIDATE_CHANGED');
   const {evidence=[]}=readReviewState(db,{kind:'evidence',id:r.reviewId});
   requireEvidence(db,selected,evidence,scope.evidenceDigest,verify);
   if(!db.prepare("SELECT 1 FROM workspaces_effects WHERE request_id=? AND workspace_id=? AND phase='WORKTREE_ADDED'")
     .get(selected.candidateId,guard.workspaceId))throw new Error('INTEGRATION_UNKNOWN');
   if(c.kind==='approve'){
     if(r.state!=='READY_FOR_APPROVAL'||i.targetId!==r.reviewId)throw new Error('REVIEW_STALE');
     db.prepare("INSERT INTO review_decisions VALUES(?,?,?,?,'APPROVE_INTEGRATION',NULL,?)").run(a.requestId,r.reviewId,selected.candidateId,r.digest,at);
     const stateRevision=stepReview(db,r,'APPROVED');
     ledger.complete(a.requestId,{reviewId:r.reviewId,candidateId:selected.candidateId,decisionId:a.requestId,stateRevision});
     return;
   }
   const decisionId=requireUuid(p.decisionId),{decision}=readReviewState(db,{kind:'decision',id:decisionId});
   if(r.state!=='APPROVED'||i.targetId!==selected.candidateId||p.expectedTargetOid!==r.targetOid||!decision||decision.reviewId!==r.reviewId||
      decision.candidateId!==selected.candidateId||decision.evidenceDigest!==scope.evidenceDigest)throw new Error('APPROVAL_STALE');
   if(db.prepare('SELECT 1 FROM review_integrations WHERE candidate_id=? OR (repository_key=? AND phase<>\'FINALIZED\')')
     .get(selected.candidateId,source.repositoryKey))throw new Error('INTEGRATION_UNKNOWN');
   db.prepare("INSERT INTO review_integrations VALUES(?,?,?,?,?,?,'REF_INTENT',NULL,NULL)")
     .run(a.requestId,selected.candidateId,decisionId,source.repositoryKey,r.targetRef,r.targetOid);
   db.prepare("UPDATE workflow_operations SET phase='WORKING',result=? WHERE request_id=?")
     .run(JSON.stringify({reviewId:r.reviewId,candidateId:selected.candidateId,integrationId:a.requestId,stateRevision:r.stateRevision}),a.requestId);
 });
}

function requireEvidence(db:Database.Database,selected:ReviewCandidateRecord,evidence:readonly ReviewEvidence[],expected:string,verify:(id:string)=>void){
 if(evidence.some(item=>item.treeOid!==selected.treeOid)||reviewEvidenceDigest(evidence)!==expected)throw new Error('APPROVAL_STALE');
 const {environment}=readEnvironmentState(db,{kind:'workspace',id:selected.stagingId});
 if(!environment?.currentPlanId||environment.state!=='READY')throw new Error('ENVIRONMENT_STALE');
 for(const item of evidence)if(item.status==='PASS'){
   if(!item.outputId||!item.jobId)throw new Error('CHECKS_NOT_RUN');
   const {job}=readEnvironmentState(db,{kind:'job',id:item.jobId});
   if(!job||job.phase!=='SUCCEEDED'||job.planId!==environment.currentPlanId||job.inputDigest!==environment.preparedDigest)
     throw new Error('ENVIRONMENT_STALE');
   verify(item.outputId);
 }
}

export function commitIntegrationState(db:Database.Database,c:IntegrationChange,ledger:Ledger,verify:(id:string)=>void){
 if('admission' in c)return admission(db,c,ledger,verify);
 const operation=ledger.operation(c.requestId);
 if(!operation||operation.namespace!=='REVIEW'||operation.action!==(c.kind.startsWith('candidate-')?'candidate.prepare':'integrate'))
   throw new Error('OPERATION_NOT_FOUND');
 if(operation.phase==='FINALIZED')return{operation,inserted:false};
 if(c.kind==='candidate-block'&&operation.outcome==='UNKNOWN')return{operation,inserted:false};
 const intent=ledger.intent(operation.canonicalIntent),p=intent.payload;
 const recovering='recovering'in c&&c.recovering===true;
 const finish=(result:ReturnType<Ledger['complete']>)=>({operation:result,inserted:false});
 return ledger.transaction(()=>{
   requireReviewOwner(db,c.instanceId,recovering?'RECOVERING':'SETTLING');
   if((p.instanceId===c.instanceId)===recovering)throw new Error('STALE_TARGET');
   if(c.kind==='candidate-owned'||c.kind==='candidate-finish'||c.kind==='candidate-block'){
     const scope=p as unknown as CandidatePreparationScope,guard=workspace(db,scope.guardId),staging=workspace(db,scope.stagingId);
     const r=review(db,requireUuid(intent.targetId)),at=new Date().toISOString();
     if(c.kind==='candidate-block'){
       const uncertain=c.error!=='MERGE_CONFLICT';
       for(const record of [guard,staging])db.prepare('UPDATE workspaces_records SET state=?,state_revision=state_revision+1,safe_error=?,updated_at=? WHERE workspace_id=?')
         .run(uncertain?'RECONCILING':'BLOCKED',c.error,at,record.workspaceId);
       db.prepare("UPDATE workspaces_effects SET phase='UNKNOWN' WHERE request_id=?").run(c.requestId);
       const stateRevision=stepReview(db,r,'BLOCKED');
       return finish(ledger.complete(c.requestId,{...operation.result,stateRevision},c.error,uncertain?'UNKNOWN':'BLOCKED'));
     }
     if(r.digest!==scope.reviewDigest||r.stateRevision!==operation.result?.stateRevision)throw new Error('REVIEW_STALE');
     requireProject(db,r,intent.configRevision);
     if(c.kind==='candidate-owned'){
       const w=c.role==='GUARD'?guard:staging,v=c.ownership,expected=c.role==='GUARD'?r.targetRef:'HEAD';
       if(w.state!=='REQUESTED'||v.branchRef!==expected||v.root.canonicalPath!==join(w.target.ownedRoot.canonicalPath,w.workspaceId)||
         v.adminDirectory.canonicalPath!==join(w.target.commonDirectory.canonicalPath,'worktrees',w.workspaceId)||
         v.gitFile.canonicalPath!==join(v.root.canonicalPath,'.git')||c.role==='GUARD'&&v.headOid!==r.targetOid||
         !/^[a-f0-9]{64}$/.test(c.markerDigest))throw new Error('OWNERSHIP_UNPROVEN');
       db.prepare("UPDATE workspaces_records SET state='READY',state_revision=state_revision+1,ownership=?,marker_digest=?,updated_at=? WHERE workspace_id=?")
         .run(JSON.stringify(v),c.markerDigest,at,w.workspaceId);
       return{operation,inserted:false};
     }
     ready(db,guard);ready(db,staging);
     const {candidateOid,treeOid}=c;
     if(staging.ownership?.headOid!==candidateOid)throw new Error('CANDIDATE_CHANGED');
     reviewOid(candidateOid);reviewOid(treeOid);
     const hash=digest({reviewDigest:r.digest,sourceOid:r.sourceOid,targetOid:r.targetOid,candidateOid,treeOid,guardId:guard.workspaceId,stagingId:staging.workspaceId});
     db.prepare('INSERT INTO review_candidates VALUES(?,?,?,?,?,?,?,?,?)')
       .run(c.requestId,r.reviewId,r.sourceOid,r.targetOid,candidateOid,treeOid,guard.workspaceId,staging.workspaceId,hash);
     db.prepare("UPDATE workspaces_effects SET phase='WORKTREE_ADDED' WHERE request_id=?").run(c.requestId);
     return finish(ledger.complete(c.requestId,{...operation.result,digest:hash,candidateOid}));
   }
   const {integration}=readReviewState(db,{kind:'integration',id:c.requestId});
   if(!integration)throw new Error('INTEGRATION_UNKNOWN');
   const selected=candidate(db,integration.candidateId);
   if(c.kind==='integration-verify'){
     if(recovering||integration.phase!=='REF_INTENT')throw new Error('INTEGRATION_UNKNOWN');
     const r=review(db,selected.reviewId),guard=workspace(db,selected.guardId),staging=workspace(db,selected.stagingId);
     requireProject(db,r,intent.configRevision);
     ready(db,workspace(db,r.workspaceId));ready(db,guard);ready(db,staging);
     if(r.state!=='APPROVED'||r.stateRevision!==intent.expectedRevision||r.digest!==p.reviewDigest||selected.digest!==p.candidateDigest||
       guard.stateRevision!==p.guardRevision||staging.stateRevision!==p.stagingRevision)throw new Error('APPROVAL_STALE');
     const {evidence=[]}=readReviewState(db,{kind:'evidence',id:r.reviewId});
     requireEvidence(db,selected,evidence,String(p.evidenceDigest),verify);
     return{operation,inserted:false};
   }
   if(c.kind==='integration-block'){
     db.prepare("UPDATE review_integrations SET phase='RECONCILING' WHERE integration_id=?").run(c.requestId);
     return finish(ledger.complete(c.requestId,operation.result,'INTEGRATION_UNKNOWN','UNKNOWN'));
   }
   const expected={requestId:c.requestId,old:integration.targetOid,candidate:selected.candidateOid};
   if(c.kind==='integration-ref'){
     const proof=requireRefAttribution(expected,c.proof);
     db.prepare("UPDATE review_integrations SET phase='REF_UPDATED',resulting_oid=?,proof=? WHERE integration_id=?")
       .run(proof.candidate,JSON.stringify(proof),c.requestId);
     return{operation,inserted:false};
   }
   if(integration.phase!=='REF_UPDATED')throw new Error('INTEGRATION_UNKNOWN');
   requireRefAttribution(expected,integration.proof);
   db.prepare("UPDATE review_integrations SET phase='FINALIZED' WHERE integration_id=?").run(c.requestId);
   db.prepare("UPDATE workspaces_effects SET phase='RESOLVED' WHERE request_id=?").run(selected.candidateId);
   return finish(ledger.complete(c.requestId,{...operation.result,resultingOid:expected.candidate}));
 },true,{requestIds:[c.requestId]});
}
