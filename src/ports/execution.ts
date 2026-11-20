export type ExecutionProviderId='codex'|'claude';
export interface ExecutionCapabilityInspection {
 readonly providerId:ExecutionProviderId;readonly version:string|null;readonly sha256:string|null;
 readonly configuration:readonly string[];readonly catalogueQualified:false;
 readonly error:'EXECUTION_UNSUPPORTED'|'PROVIDER_UNSAFE'|null;
}
export interface ExecutionObservedTool {readonly type:string;readonly name:string|null}
export interface ExecutionQualificationEvidence {
 readonly pin:boolean;readonly commandBoundary:boolean;readonly observedCatalogue:readonly ExecutionObservedTool[];
 readonly brokers:readonly {readonly type:string;readonly name:string;readonly operation:'SCOPED_WRITE'|'APPROVED_COMMAND'|'QUESTION'}[];
 readonly ownershipProof:boolean;
}
export interface ExecutionQualificationPort{
 inspect(providerId:ExecutionProviderId,path:string,privateRoot:string):Promise<ExecutionCapabilityInspection>;
}

import type {ExecutionRunPhase,ExecutionSessionState} from '../domain/execution/model.js';
import type {WorkflowAdmission,WorkflowOperationRecord} from './workflow.js';

export interface ExecutionIdentity{
 readonly runId:string;readonly generation:string;readonly leaseId:string;readonly challenge:string;
}
export interface ExecutionExitProof {
 readonly identity:ExecutionIdentity;readonly verified:true;readonly code:number|null;
 readonly finalMessage:boolean;readonly interrupted:boolean;
}
export interface ExecutionSession {
 readonly sessionId:string;readonly featureId:string;readonly workspaceId:string;readonly projectId:string;readonly profileResolutionId:string;
 readonly envelopeId:string;readonly state:ExecutionSessionState;readonly stateRevision:string;readonly runId:string;readonly checkpointId:string|null;
 readonly createdAt:string;readonly updatedAt:string;
}
export interface ExecutionRun {
 readonly runId:string;readonly sessionId:string;readonly generation:string;readonly instanceId:string;readonly providerId:ExecutionProviderId;
 readonly configRevision:string;readonly capabilityDigest:string;readonly inputDigest:string;readonly phase:ExecutionRunPhase;
 readonly outcome:'IN_PROGRESS'|'SUCCEEDED'|'FAILED'|'INTERRUPTED'|'UNKNOWN';readonly identity:ExecutionIdentity|null;
 readonly proof:ExecutionExitProof|null;readonly requested:'PAUSE'|'CANCEL'|null;
 readonly controlRequestId:string|null;readonly outputWatermark:string;readonly truncated:boolean;
}
export interface ExecutionProviderConfig {
 readonly providerId:ExecutionProviderId;readonly configRevision:string;readonly binaryRef:string;readonly modelId:string;
 readonly authProfileRef:string;readonly capabilityDigest:string|null;readonly status:'UNQUALIFIED'|'BLOCKED'|'QUALIFIED';readonly error:string|null;
}
export interface ExecutionCheckpoint {
 readonly checkpointId:string;readonly sessionId:string;readonly runId:string;readonly inputDigest:string;readonly treeDigest:string;
 readonly patchArtifactId:string;readonly digest:string;readonly createdAt:string;
}
export interface ExecutionOutput {
 readonly seq:string;readonly artifactId:string;readonly sha256:string;readonly bytes:number;
}
export interface ExecutionInteraction {
 readonly interactionId:string;readonly runId:string;readonly generation:string;readonly expectedRevision:string;
 readonly textArtifactId:string;readonly type:'QUESTION'|'TOOL_REQUEST';readonly status:'OPEN'|'ANSWERED';
 readonly answerArtifactId:string|null;
}
export type ExecutionQuery=
 |{readonly kind:'session'|'run'|'checkpoint'|'interaction'|'artifact';readonly id:string}
 |{readonly kind:'provider';readonly id:ExecutionProviderId}
 |{readonly kind:'active'|'retained-leases'}
 |{readonly kind:'output';readonly id:string;readonly after?:string;readonly limit?:number}
 |{readonly kind:'sessions';readonly projectId:string;readonly offset?:number;readonly limit?:number}
 |{readonly kind:'interactions';readonly id:string};
export interface ExecutionRead {
 readonly session?:ExecutionSession|null;readonly run?:ExecutionRun|null;readonly checkpoint?:ExecutionCheckpoint|null;readonly provider?:ExecutionProviderConfig|null;
 readonly interaction?:ExecutionInteraction|null;readonly interactions?:readonly ExecutionInteraction[];
 readonly runs?:readonly ExecutionRun[];readonly sessions?:readonly ExecutionSession[];readonly output?:readonly ExecutionOutput[];
 readonly artifact?:{readonly sha256:string;readonly bytes:number}|null;readonly nextOffset?:number|null;readonly revision?:string;
}
export type ExecutionChange=
 |{readonly kind:'configure'|'check';readonly admission:WorkflowAdmission;readonly provider:ExecutionProviderConfig}
 |{readonly kind:'begin';readonly admission:WorkflowAdmission;readonly session:ExecutionSession;readonly run:ExecutionRun}
 |{readonly kind:'stage';readonly runId:string;readonly instanceId:string;readonly identity:ExecutionIdentity;readonly event:'ready'|'authorize'|'go'}
 |{readonly kind:'end';readonly runId:string;readonly instanceId:string;readonly generation:string;readonly proof:ExecutionExitProof|null;
   readonly noLaunch?:boolean;readonly recovering?:boolean;readonly error:string|null}
 |{readonly kind:'output';readonly runId:string;readonly instanceId:string;readonly generation:string;readonly artifactId:string|null}
 |{readonly kind:'question';readonly runId:string;readonly instanceId:string;readonly interaction:ExecutionInteraction}
 |{readonly kind:'answer';readonly admission:WorkflowAdmission;readonly interactionId:string;readonly answerArtifactId:string}
 |{readonly kind:'checkpoint';readonly admission:WorkflowAdmission;readonly checkpoint:ExecutionCheckpoint}
 |{readonly kind:'control';readonly admission:WorkflowAdmission;readonly runId:string;readonly requested:'PAUSE'|'CANCEL'}
 |{readonly kind:'reconcile';readonly admission:WorkflowAdmission;readonly sessionId:string};
export interface ExecutionStoragePort {
 readExecutionState?(query:ExecutionQuery):Promise<ExecutionRead>;
 commitExecutionState?(change:ExecutionChange):Promise<{operation:WorkflowOperationRecord;inserted?:boolean;session?:ExecutionSession;run?:ExecutionRun}>;
}
