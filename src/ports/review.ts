import type {Deadline} from './clock.js';
import type {WorkspaceDiskObservation,WorkspaceGitPin,WorkspaceMutationTarget} from './workspace.js';
import type {EnvironmentDelegatedCheck} from './environment.js';
import type {ReviewCheckStatus} from '../domain/review/model.js';

export type IntegrationGuard=NonNullable<WorkspaceDiskObservation['worktree']>;
export interface GitIntegrationScope {
 readonly source:WorkspaceMutationTarget;
 readonly ownership:IntegrationGuard;
 readonly targetRef:string;
 readonly targetOid:string;
 readonly sourceOid:string;
 readonly guardId:string;
}
export interface GitIntegrationPreflight {
 readonly sourceOid:string;
 readonly targetOid:string;
 readonly sourceTreeOid:string;
 readonly fastForward:boolean;
}
export interface ReviewDiff extends GitIntegrationPreflight {readonly fileCount:number;readonly diff:Uint8Array}
export interface GitIntegrationPort {
 qualification():Promise<WorkspaceGitPin>;
 preflight(input:GitIntegrationScope,deadline:Deadline):Promise<GitIntegrationPreflight>;
 captureDiff(input:GitIntegrationScope,deadline:Deadline):Promise<ReviewDiff>;
 reserveGuard(input:GitIntegrationScope,deadline:Deadline):Promise<IntegrationGuard>;
 publishFastForward(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline):Promise<{readonly resultingOid:string}>;
 syncGuard(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline):Promise<void>;
}

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
 |{readonly kind:'pending-snapshots'|'pending-validation'}
 |{readonly kind:'evidence'|'feedback';readonly id:string}
 |{readonly kind:'list';readonly projectId:string;readonly offset?:number;readonly limit?:number};
export interface ReviewRead {
 readonly review?:ReviewRecord|null;readonly reviews?:readonly ReviewRecord[];
 readonly artifact?:{readonly sha256:string;readonly bytes:number}|null;readonly revision?:string;readonly nextOffset?:number|null;
 readonly operations?:readonly WorkflowOperationRecord[];
 readonly evidence?:readonly ReviewEvidence[];
 readonly feedback?:ReviewFeedback|null;
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
 readonly checks:readonly EnvironmentDelegatedCheck[];
 readonly criteria:readonly {readonly criterionId:string;readonly required:boolean;readonly commandSpecId:string|null;readonly proofId:string}[];
}
export type ReviewChange=
 |{readonly kind:'create';readonly admission:WorkflowAdmission;readonly snapshot:ReviewRecord}
 |{readonly kind:'request-changes'|'validate-admit';readonly admission:WorkflowAdmission}
 |{readonly kind:'validate-finish';readonly instanceId:string;readonly requestId:string;readonly treeCurrent:boolean;readonly recovering?:true};
export type ReviewRecovery={readonly kind:'recover-snapshot';readonly instanceId:string;readonly requestId:string};
export interface ReviewStoragePort {
 readReviewState?(query:ReviewQuery):Promise<ReviewRead>;
 commitReviewState?(change:ReviewChange|ReviewRecovery):Promise<{readonly operation:WorkflowOperationRecord;readonly inserted:boolean}>;
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
