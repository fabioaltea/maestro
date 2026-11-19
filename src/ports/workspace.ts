import type {WorkflowAdmission,WorkflowOperationRecord} from './workflow.js';
import type {WorkspaceFence,WorkspaceState} from '../domain/workspaces/model.js';
import type {Deadline} from './clock.js';
import type {FilesystemAnchor} from './repository.js';

export interface WorkspaceMutationTarget {
  readonly workspaceId:string;
  readonly featureId:string;
  readonly ownedRoot:FilesystemAnchor;
  readonly reference:FilesystemAnchor;
  readonly adminDirectory:FilesystemAnchor;
  readonly commonDirectory:FilesystemAnchor;
  readonly baseRef:string;
  readonly baseOid:string;
}

export interface WorkspaceDiskObservation {
  readonly baseOid:string|null;
  readonly branchOid:string|null;
  readonly worktree:{
    readonly root:FilesystemAnchor;
    readonly adminDirectory:FilesystemAnchor;
    readonly gitFile:FilesystemAnchor;
    readonly branchRef:string;
    readonly headOid:string;
  }|null;
}

export interface WorkspaceGitPin {
  readonly version:string;
  readonly sha256:string;
  readonly profileSha256:string;
}

/** Effects are limited to the generated workspace. A lost reply remains uncertain. */
export interface WorkspacePort {
  qualification():Promise<WorkspaceGitPin>;
  resolveBase(target:Omit<WorkspaceMutationTarget,'baseOid'>,deadline:Deadline):Promise<string>;
  observe(target:WorkspaceMutationTarget,deadline:Deadline):Promise<WorkspaceDiskObservation>;
  createBranch(target:WorkspaceMutationTarget,deadline:Deadline):Promise<void>;
  addWorktree(target:WorkspaceMutationTarget,deadline:Deadline):Promise<WorkspaceDiskObservation>;
  removeWorktree(target:WorkspaceMutationTarget,expected:NonNullable<WorkspaceDiskObservation['worktree']>,
    integrated:{readonly targetRef:string;readonly targetOid:string},deadline:Deadline):Promise<void>;
}

export interface WorkspaceRecord extends WorkspaceFence {
 readonly featureId:string;
 readonly projectId:string;
 readonly envelopeId:string;
 readonly repositoryKey:string;
 readonly state:WorkspaceState;
 readonly target:WorkspaceMutationTarget;
 readonly createdAt:string;
 readonly updatedAt:string;
 readonly ownership:NonNullable<WorkspaceDiskObservation['worktree']>|null;
 readonly markerDigest:string|null;
 readonly safeError:string|null;
}
export interface WorkspaceSummary{
 readonly workspaceId:string;readonly featureId:string;readonly projectId:string;readonly envelopeId:string;
 readonly state:WorkspaceState;readonly stateRevision:string;readonly baseRef:string;readonly baseOid:string;
 readonly branchRef:string;readonly ownership:'RECORDED'|'UNKNOWN';readonly updatedAt:string;readonly createdAt:string;readonly safeError:string|null;
}
export type WorkspaceQuery={readonly kind:'get'|'summary';readonly id:string}
 |{readonly kind:'list';readonly projectId:string;readonly limit?:number;readonly offset?:number}
 |{readonly kind:'interrupted-provisioning'};
export interface WorkspaceRead {
 readonly workspace?:WorkspaceRecord|null;
 readonly summary?:WorkspaceSummary|null;
 readonly items?:readonly WorkspaceSummary[];
 readonly nextOffset?:number|null;
 readonly pageRevision?:string;
 readonly interrupted?:readonly {readonly requestId:string;readonly workspace:WorkspaceRecord}[];
}
export interface WorkspaceStoragePort {
 commitWorkspaceState?(change:WorkspaceChange):Promise<WorkspaceWrite>;
 readWorkspaceState?(query:WorkspaceQuery):Promise<WorkspaceRead>;
}

export interface WorkspaceClaim {
 readonly storeId:string;readonly repositoryKey:string;readonly requestId:string;readonly ownerGeneration:string;
}
export interface WorkspaceMarker extends WorkspaceClaim{
 readonly workspaceId:string;
 readonly ownership:NonNullable<WorkspaceDiskObservation['worktree']>;
}
export interface OwnedWorkspaceFilesPort{
 root(storeId:string):Promise<FilesystemAnchor>;
 claim(claim:WorkspaceClaim):Promise<{settle():Promise<void>;release():void}>;
 sealMarker(root:FilesystemAnchor,marker:WorkspaceMarker):Promise<string>;
 readMarker(root:FilesystemAnchor,id:string):Promise<{digest:string;marker:WorkspaceMarker}|null>;
}
export type WorkspaceChange=
 |{readonly kind:'reserve';readonly admission:WorkflowAdmission;readonly contextCheckedAt:string}
 |{readonly kind:'provision-dispatch';readonly requestId:string;readonly instanceId:string;readonly fence:WorkspaceFence;readonly contextCheckedAt:string}
 |{readonly kind:'provision-step';readonly requestId:string;readonly instanceId:string;readonly fence:WorkspaceFence;
   readonly observation:WorkspaceDiskObservation;readonly markerDigest?:string}
 |{readonly kind:'provision-ready';readonly requestId:string;readonly instanceId:string;readonly fence:WorkspaceFence;readonly contextCheckedAt:string}
 |{readonly kind:'provision-block';readonly requestId:string;readonly instanceId:string;readonly fence:WorkspaceFence;readonly error:string;readonly uncertain:boolean}
 |{readonly kind:'provision-interrupted';readonly requestId:string;readonly instanceId:string;readonly fence:WorkspaceFence};
export interface WorkspaceWrite{
 readonly workspace?:WorkspaceRecord;
 readonly operation:WorkflowOperationRecord;
 readonly inserted?:boolean;
}

/** Privileged core consumers bind writer authority to a job identity, never a PID. */
export interface WorkspaceLease {
 readonly leaseId:string;
 readonly workspaceId:string;
 readonly holderType:import('../domain/workspaces/ownership.js').WorkspaceHolder;
 readonly holderId:string;
 readonly generation:string;
 readonly instanceId:string;
}
export type WorkspaceReleaseProof=WorkspaceLease&(
 |{readonly kind:'EXIT';readonly hostExited:true;readonly descendantsExited:true}
 |{readonly kind:'CHECKPOINT';readonly durable:true;readonly quiescent:true});
export interface WorkspaceLeaseRequest{
 readonly workspaceId:string;readonly stateRevision:string;readonly holderId:string;readonly generation:string;
}
export interface WorkspaceWorkingStatus {
 readonly tracked:boolean;readonly untracked:boolean;readonly ignored:boolean;readonly conflicts:boolean;
}
export interface WorkspaceObservation{
 readonly observationId:string;readonly checkedAt:string;readonly headOid:string|null;readonly branchRef:string|null;
 readonly ownership:'VERIFIED'|'UNKNOWN'|'ABSENT';
 readonly tracked:boolean|null;readonly untracked:boolean|null;readonly ignored:boolean|null;readonly conflicts:boolean|null;
}
