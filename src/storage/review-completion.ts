import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {transitionDiscovery} from '../domain/discovery/state.js';
import {requireRefAttribution} from '../domain/review/integration.js';
import type {ReviewCompletionChange,ReviewContextInvalidation,ReviewReceiptRecord} from '../ports/review.js';
import {readReviewState,requireReviewOwner} from './review-store.js';
import type {createWorkflowStore} from './workflow-store.js';

function invalidateContext(db:Database.Database,receipt:ReviewReceiptRecord,scope:ReviewContextInvalidation){
 transitionDiscovery('APPROVED','STALE',{exitVerified:true});
 const update=db.prepare(`UPDATE discoveries SET state='STALE',state_revision=state_revision+1,updated_at=?
   WHERE discovery_id=? AND project_id=? AND state='APPROVED' AND state_revision=? AND snapshot_id=? AND latest_document_revision_id=?
   AND EXISTS(SELECT 1 FROM features_revisions v JOIN discovery_approvals a ON a.approval_id=v.discovery_approval_id
     WHERE v.revision_id=? AND a.discovery_id=discoveries.discovery_id AND a.revision_id=discoveries.latest_document_revision_id)
   AND NOT EXISTS(SELECT 1 FROM discovery_runs r WHERE r.run_id=discoveries.current_run_id AND r.phase NOT IN ('FINALIZED','EXIT_OBSERVED'))
   AND NOT EXISTS(SELECT 1 FROM discovery_processes p WHERE p.run_id=discoveries.current_run_id AND p.release_state<>'RELEASED')`)
   .run(new Date().toISOString(),requireUuid(scope.discoveryId),receipt.projectId,BigInt(scope.discoveryRevision),requireUuid(scope.snapshotId),
     requireUuid(scope.approvalRevisionId),receipt.featureRevisionId);
 return update.changes===1;
}

export function commitReviewCompletion(db:Database.Database,c:ReviewCompletionChange,ledger:ReturnType<typeof createWorkflowStore>){
 const a=c.admission,i=ledger.intent(a.canonicalIntent),receipt=c.receipt;
 if(i.namespace!=='REVIEW'||i.action!=='complete'||i.targetId!==receipt.integrationId||receipt.receiptId!==a.requestId)
   throw new Error('INVALID_REQUEST');
 return ledger.admit(a,()=>{
   requireReviewOwner(db,a.instanceId,'RUNNING');
   const {integration}=readReviewState(db,{kind:'integration',id:receipt.integrationId});
   if(!integration||integration.phase!=='FINALIZED'||!integration.proof?.guardSynced)throw new Error('INTEGRATION_UNKNOWN');
   const {candidate}=readReviewState(db,{kind:'candidate',id:integration.candidateId});
   if(!candidate)throw new Error('CANDIDATE_CHANGED');
   const {review}=readReviewState(db,{kind:'review',id:candidate.reviewId});
   const {decision}=readReviewState(db,{kind:'decision',id:integration.decisionId});
   if(!review||review.stateRevision!==i.expectedRevision||review.projectId!==i.projectId||review.state!=='APPROVED'||!decision||
      receipt.reviewId!==review.reviewId||receipt.workspaceId!==review.workspaceId||receipt.projectId!==review.projectId||
      receipt.featureRevisionId!==review.featureRevisionId||receipt.evidenceDigest!==decision.evidenceDigest)throw new Error('REVIEW_STALE');
   if(!db.prepare('SELECT 1 FROM projects WHERE project_id=? AND config_revision=? AND removed_at IS NULL')
     .get(review.projectId,BigInt(i.configRevision!)))throw new Error('REVIEW_STALE');
   if(integration.resultingOid!==receipt.resultingOid||candidate.candidateOid!==receipt.candidateOid||
      review.sourceOid!==receipt.sourceOid||integration.targetRef!==receipt.targetRef||integration.targetOid!==receipt.expectedTargetOid||
      candidate.treeOid!==receipt.treeOid||receipt.publicationGrantRequired!==true)throw new Error('INTEGRATION_UNKNOWN');
   requireRefAttribution({requestId:receipt.integrationId,old:receipt.expectedTargetOid,candidate:receipt.candidateOid},integration.proof);
   if(readReviewState(db,{kind:'receipt',id:receipt.integrationId}).receipt)throw new Error('INVALID_TRANSITION');
   const invalidated=c.invalidate?invalidateContext(db,receipt,c.invalidate):false;
   const value:ReviewReceiptRecord=c.invalidate&&!invalidated?{...receipt,contextFreshness:'UNKNOWN'}:receipt;
   db.prepare('INSERT INTO review_receipts VALUES(?,?,?)').run(value.receiptId,value.integrationId,JSON.stringify(value));
   ledger.complete(a.requestId,{reviewId:review.reviewId,receiptId:value.receiptId,integrationId:value.integrationId,
     stateRevision:review.stateRevision,resultingOid:value.resultingOid,contextFreshness:value.contextFreshness,
     ...(c.invalidate&&invalidated?{discoveryId:c.invalidate.discoveryId}:{})});
 });
}
