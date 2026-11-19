import type {EnvironmentFence,EnvironmentState} from '../domain/environments/state.js';
import type {Deadline} from './clock.js';
import type {FilesystemAnchor} from './repository.js';
import type {WorkflowOperationRecord,WorkflowAdmission} from './workflow.js';
import type {WorkspaceFence} from '../domain/workspaces/model.js';

export interface EnvironmentManagerPin {
 readonly manager:'pnpm';readonly version:string;readonly nodeVersion:string;
 readonly entryDigest:string;readonly distributionDigest:string;readonly nodeDigest:string;readonly profileDigest:string;
 readonly descendants:'DENIED';readonly importMethod:'clone-or-copy';
}
export interface EnvironmentInstallScope {
 readonly workspace:FilesystemAnchor;readonly store:FilesystemAnchor;readonly scratch:FilesystemAnchor;
 readonly registryOrigin:string|null;
 readonly manifestDigest:string;readonly lockDigest:string;
 readonly selectedVersion?:string;
}
export interface EnvironmentInstallResult{
 readonly outcome:'SUCCEEDED'|'FAILED'|'CANCELLED'|'RECONCILING';
 readonly exitVerified:boolean;
 readonly exitCode:number|null;
 readonly error:string|null;
 readonly bytes:number;
}
export interface EnvironmentInstallPort {
 configuredPin():Promise<EnvironmentManagerPin>;
 qualification():Promise<EnvironmentManagerPin>;
 install(scope:EnvironmentInstallScope,deadline:Deadline,signal?:AbortSignal):Promise<EnvironmentInstallResult>;
}

export interface EnvironmentInputEntry {
 readonly path:string;readonly sha256:string;readonly bytes:number;
}
export interface EnvironmentInspection {
 readonly manager:'pnpm'|'npm'|'yarn'|'bun'|'UNKNOWN';
 readonly managerVersion:string|null;
 readonly pin:EnvironmentManagerPin|null;
 readonly disposition:'PLANNED'|'MANUAL_REQUIRED';
 readonly reason:string|null;
 readonly scriptNames:readonly string[];
 readonly inputs:readonly EnvironmentInputEntry[];
 readonly inputDigest:string;
 readonly registryOrigin:string|null;
}
export interface EnvironmentPlan {
 readonly planId:string;readonly environmentId:string;readonly workspaceGeneration:string;
 readonly workspaceRevision:string;readonly configRevision:string;readonly digest:string;readonly inputDigest:string;
 readonly artifactId:string;readonly metadata:EnvironmentInspection;readonly createdAt:string;
}
export interface EnvironmentRecord extends EnvironmentFence {
 readonly environmentId:string;readonly state:EnvironmentState;
 readonly currentPlanId:string|null;readonly attestationId:string|null;readonly preparedDigest:string|null;
 readonly safeError:string|null;readonly checkedAt:string|null;readonly createdAt:string;readonly updatedAt:string;
}
export interface EnvironmentJob {
 readonly jobId:string;readonly environmentId:string;readonly planId:string;readonly requestId:string;readonly cancelRequestId:string|null;
 readonly kind:'INSTALL'|'VALIDATE';readonly commandSpecId:string|null;readonly generation:string;readonly leaseId:string|null;
 readonly phase:'QUEUED'|'RUNNING'|'CANCELLING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'RECONCILING';
 readonly stateRevision:string;readonly inputDigest:string;readonly outputWatermark:string;readonly truncated:boolean;
 readonly exitProof:{readonly verified:true;readonly code:number|null;readonly reason:string|null}|null;
 readonly safeError:string|null;readonly createdAt:string;readonly completedAt:string|null;
}
export interface EnvironmentOutput {
 readonly seq:string;readonly artifactId:string;readonly sha256:string;readonly bytes:number;
}
export type EnvironmentQuery=
 |{readonly kind:'workspace'|'environment'|'plan'|'job'|'artifact';readonly id:string}
 |{readonly kind:'list';readonly projectId:string;readonly offset?:number;readonly limit?:number}
 |{readonly kind:'output';readonly id:string;readonly after?:string;readonly limit?:number}
 |{readonly kind:'active'|'pending-plans'};
export interface EnvironmentRead {
 readonly environment?:EnvironmentRecord|null;
 readonly plan?:EnvironmentPlan|null;
 readonly job?:EnvironmentJob|null;
 readonly items?:readonly EnvironmentRecord[];
 readonly operations?:readonly WorkflowOperationRecord[];
 readonly jobs?:readonly EnvironmentJob[];
 readonly artifact?:{readonly sha256:string;readonly bytes:number}|null;
 readonly chunks?:readonly EnvironmentOutput[];
 readonly nextOffset?:number|null;
 readonly pageRevision?:string;
}
export interface EnvironmentStoragePort {
 commitEnvironmentState?(change:EnvironmentChange):Promise<EnvironmentWrite>;
 readEnvironmentState?(query:EnvironmentQuery):Promise<EnvironmentRead>;
}

export type EnvironmentChange=
 |{readonly kind:'plan-admit';readonly admission:WorkflowAdmission}
 |{readonly kind:'attest';readonly admission:WorkflowAdmission;readonly observedInputDigest:string;readonly checkedAt:string}
 |{readonly kind:'plan-finish';readonly instanceId:string;readonly requestId:string;
   readonly fence:WorkspaceFence;readonly plan:EnvironmentPlan}
 |{readonly kind:'plan-block';readonly instanceId:string;readonly requestId:string;readonly error:string;readonly interrupted?:boolean};
export interface EnvironmentWrite {
 readonly operation:WorkflowOperationRecord;
 readonly environment?:EnvironmentRecord;
 readonly plan?:EnvironmentPlan;
 readonly inserted?:boolean;
}

export interface EnvironmentInspectPort{
 inspect(root:FilesystemAnchor,deadline:Deadline,selectedVersion?:string):Promise<EnvironmentInspection>;
}
