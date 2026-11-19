import type { WorkflowIntent,WorkflowGrant } from '../domain/workflow/authorization.js';
import type { WorkflowOperation } from '../domain/workflow/operation.js';
import type { FeatureRecord,FeatureRevision,FeatureApproval,ImplementationEnvelope } from '../domain/features/model.js';
export interface WorkflowArtifact {readonly artifactId:string;readonly kind:'BUNDLE'|'INPUT'|'OUTPUT'|'CHECKPOINT';readonly targetId:string|null;readonly expectedBytes:number;readonly sha256:string;readonly offsetBytes:number;readonly allocatedBytes:number;readonly state:'RESERVED'|'SEALED'|'REFERENCED'|'ORPHAN'|'CORRUPT'|'DISCARDED';readonly referenceCount:number;readonly createdAtMs:number;readonly expiresAtMs:number|null}
export interface WorkflowOperationRecord extends WorkflowOperation {readonly canonicalIntent:string;readonly payloadHash:string}
export type FeatureQuery={readonly kind:'feature'|'revision'|'approval'|'envelope'|'operation'|'grant'|'artifact'|'turn';readonly id:string}
 |{readonly kind:'features'|'revisions'|'approvals'|'turns';readonly id:string;readonly offset?:number;readonly limit?:number}
 |{readonly kind:'budget'}|{readonly kind:'pending'};
export interface FeatureRead {
 readonly feature?:FeatureRecord|null;readonly revision?:FeatureRevision|null;readonly approval?:FeatureApproval|null;readonly envelope?:ImplementationEnvelope|null;
 readonly operation?:WorkflowOperationRecord|null;readonly grant?:WorkflowGrant|null;readonly artifact?:WorkflowArtifact|null;
 readonly items?:readonly unknown[];readonly nextOffset?:number|null;readonly pageRevision?:string;readonly turn?:Readonly<Record<string,unknown>>|null;
 readonly budget?:{readonly allocatedBytes:number;readonly reservedBytes:number;readonly allocatedFiles:number;readonly openUploads:number;readonly metadataBytes:number};
}
export interface WorkflowAdmission {readonly requestId:string;readonly canonicalIntent:string;readonly grantId:string|null;readonly instanceId:string;readonly nowMs:number}
export type WorkflowChange=
 {readonly kind:'grant';readonly grant:WorkflowGrant}
 |{readonly kind:'admit';readonly admission:WorkflowAdmission}
 |{readonly kind:'complete';readonly requestId:string;readonly outcome:Exclude<WorkflowOperation['outcome'],'IN_PROGRESS'>;readonly result:Readonly<Record<string,unknown>>|null;readonly error:string|null;readonly nowMs:number}
 |{readonly kind:'reserve';readonly admission:WorkflowAdmission;readonly artifact:WorkflowArtifact}
 |{readonly kind:'append';readonly admission:WorkflowAdmission;readonly artifactId:string;readonly offset:number;readonly sha256:string;readonly bytes:Uint8Array}
 |{readonly kind:'seal'|'discard';readonly admission:WorkflowAdmission;readonly artifactId:string}
 |{readonly kind:'create'|'revise';readonly admission:WorkflowAdmission;readonly feature:FeatureRecord;readonly revision:FeatureRevision}
 |{readonly kind:'approve';readonly admission:WorkflowAdmission;readonly approval:FeatureApproval;readonly expectedRevision:string;readonly acceptedUnknownIds:readonly string[]}
 |{readonly kind:'handoff';readonly admission:WorkflowAdmission;readonly envelope:ImplementationEnvelope;readonly expectedRevision:string}
 |{readonly kind:'archive';readonly admission:WorkflowAdmission;readonly featureId:string;readonly expectedRevision:string}
 |{readonly kind:'reconcile';readonly instanceId:string;readonly nowMs:number}
 |{readonly kind:'stale';readonly featureId:string;readonly expectedRevision:string;readonly nowMs:number};
export interface WorkflowWrite {readonly operation?:WorkflowOperationRecord;readonly inserted?:boolean;readonly artifact?:WorkflowArtifact;readonly feature?:FeatureRecord;readonly revision?:FeatureRevision;readonly approval?:FeatureApproval;readonly envelope?:ImplementationEnvelope}
export interface FeatureStoragePort {
 readFeatureState?(query:FeatureQuery):Promise<FeatureRead>;
 commitFeatureState?(change:WorkflowChange):Promise<WorkflowWrite>;
 readWorkflowArtifact?(artifactId:string,offset:number,maximumBytes:number):Promise<{readonly bytes:Uint8Array;readonly sha256:string;readonly totalBytes:number}>;
 reconcileWorkflowArtifacts?():Promise<void>;
}
export type {WorkflowIntent};
