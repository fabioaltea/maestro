import type {EnvironmentDelegatedCheck} from './environment.js';
import type {ReviewCheckStatus} from '../domain/review/model.js';
import type {RefAttribution} from '../domain/review/integration.js';
import type {IntegrationGuard} from './git-integration.js';
export type {GitIntegrationPort,GitIntegrationScope,IntegrationGuard} from './git-integration.js';

import type {ReviewState} from '../domain/review/state.js';
import type {WorkflowAdmission,WorkflowOperationRecord} from './workflow.js';

export interface ReviewRecord {
 readonly reviewId:string;readonly projectId:string;readonly featureId:string;readonly featureRevisionId:string;
 readonly workspaceId:string;readonly checkpointId:string;readonly sourceOid:string;readonly sourceTreeOid:string;
 readonly targetRef:string;readonly targetOid:string;readonly digest:string;readonly state:ReviewState;
 readonly stateRevision:string;readonly createdAt:string;readonly fileCount:number;readonly diffBytes:number;
 readonly parts:readonly {readonly artifactId:string;readonly sha256:string;readonly bytes:number}[];
}
export type ReviewQuery={readonly kind:'review'|'artifact';readonly id:string}
 |{readonly kind:'pending-snapshots'|'pending-validation'|'pending-integration'}
 |{readonly kind:'evidence'|'feedback'|'candidate'|'current-candidate'|'decision'|'current-decision'|'integration'|'candidate-integration';readonly id:string}
 |{readonly kind:'list';readonly projectId:string;readonly offset?:number;readonly limit?:number};
export interface ReviewRead {
 readonly review?:ReviewRecord|null;readonly reviews?:readonly ReviewRecord[];
 readonly artifact?:{readonly sha256:string;readonly bytes:number}|null;readonly revision?:string;readonly nextOffset?:number|null;
 readonly operations?:readonly WorkflowOperationRecord[];
 readonly evidence?:readonly ReviewEvidence[];
 readonly feedback?:ReviewFeedback|null;
 readonly candidate?:ReviewCandidateRecord|null;
 readonly decision?:ReviewIntegrationDecision|null;
 readonly integration?:ReviewIntegrationRecord|null;
}
export interface ReviewFeedback {
 readonly decisionId:string;readonly artifactId:string;readonly featureId:string;readonly featureRevisionId:string;
 readonly workspaceId:string;readonly checkpointTreeDigest:string;readonly stateRevision:string;
}
export interface ReviewEvidence {
 readonly criterionId:string;readonly jobId:string|null;readonly commandDigest:string;readonly treeOid:string;
 readonly status:ReviewCheckStatus;readonly outputId:string|null;readonly checkedAt:string;
}
export interface ReviewValidationScope {
 readonly instanceId:string;readonly reviewDigest:string;readonly treeOid:string;readonly workspaceRevision:string;
 readonly candidateId?:string;
 readonly checks:readonly EnvironmentDelegatedCheck[];
 readonly criteria:readonly {readonly criterionId:string;readonly required:boolean;readonly commandSpecId:string|null;readonly proofId:string}[];
}
export interface ReviewCandidateRecord {
 readonly candidateId:string;readonly reviewId:string;readonly sourceOid:string;readonly targetOid:string;
 readonly candidateOid:string;readonly treeOid:string;readonly guardId:string;readonly stagingId:string;readonly digest:string;
 readonly authoredAt:string;
}
export interface ReviewIntegrationDecision {readonly decisionId:string;readonly reviewId:string;readonly candidateId:string;readonly evidenceDigest:string}
export interface ReviewIntegrationRecord {
 readonly integrationId:string;readonly candidateId:string;readonly decisionId:string;readonly repositoryKey:string;
 readonly targetRef:string;readonly targetOid:string;readonly resultingOid:string|null;
 readonly phase:'REF_INTENT'|'REF_UPDATED'|'GUARD_SYNCED'|'FINALIZED'|'RECONCILING';readonly proof:RefAttribution|null;
}
export interface CandidatePreparationScope {
 readonly instanceId:string;readonly reviewDigest:string;readonly workspaceRevision:string;
 readonly authoredAt:string;readonly guardId:string;readonly stagingId:string;readonly generation:string;
}
export interface IntegrationApprovalScope {
 readonly instanceId:string;readonly reviewDigest:string;readonly candidateId:string;readonly candidateDigest:string;
 readonly evidenceDigest:string;readonly guardRevision:string;readonly stagingRevision:string;
}
export type IntegrationChange=
 |{readonly kind:'candidate-admit'|'approve'|'integrate-admit';readonly admission:WorkflowAdmission}
 |{readonly kind:'candidate-owned';readonly requestId:string;readonly instanceId:string;readonly ownership:IntegrationGuard;
   readonly markerDigest:string;readonly role:'GUARD'|'STAGING'}
 |{readonly kind:'candidate-finish';readonly requestId:string;readonly instanceId:string;readonly candidateOid:string;readonly treeOid:string}
 |{readonly kind:'candidate-block';readonly requestId:string;readonly instanceId:string;readonly error:string;readonly recovering?:true}
 |{readonly kind:'integration-ref';readonly requestId:string;readonly instanceId:string;readonly proof:RefAttribution;readonly recovering?:true}
 |{readonly kind:'integration-verify'|'integration-finish'|'integration-block';readonly requestId:string;readonly instanceId:string;readonly recovering?:true};
export type ReviewChange=
 |{readonly kind:'create';readonly admission:WorkflowAdmission;readonly snapshot:ReviewRecord}
 |{readonly kind:'request-changes'|'validate-admit';readonly admission:WorkflowAdmission}
 |{readonly kind:'validate-finish';readonly instanceId:string;readonly requestId:string;readonly treeCurrent:boolean;readonly recovering?:true};
export type ReviewRecovery={readonly kind:'recover-snapshot';readonly instanceId:string;readonly requestId:string};
export interface ReviewStoragePort {
 readReviewState?(query:ReviewQuery):Promise<ReviewRead>;
 commitReviewState?(change:ReviewChange|ReviewRecovery|IntegrationChange):Promise<{readonly operation:WorkflowOperationRecord;readonly inserted:boolean}>;
}

export interface IntegrationReceiptScope {
 readonly integrationId:string;readonly reviewId:string;readonly workspaceId:string;readonly projectId:string;
 readonly sourceOid:string;readonly targetRef:string;readonly expectedTargetOid:string;readonly candidateOid:string;
 readonly documentationDigest:string;
}
export interface IntegrationReceiptProof extends IntegrationReceiptScope {
 readonly resultingOid:string;readonly contextFreshness:'LAST_KNOWN'|'STALE'|'UNKNOWN';
 readonly publicationGrantRequired:true;
}
