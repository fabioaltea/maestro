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
 |{readonly kind:'list';readonly projectId:string;readonly limit?:number;readonly offset?:number};
export interface WorkspaceRead {
 readonly workspace?:WorkspaceRecord|null;
 readonly summary?:WorkspaceSummary|null;
 readonly items?:readonly WorkspaceSummary[];
 readonly nextOffset?:number|null;
 readonly pageRevision?:string;
}
export interface WorkspaceStoragePort {
 commitWorkspaceState?(change:WorkspaceChange):Promise<WorkspaceWrite>;
 readWorkspaceState?(query:WorkspaceQuery):Promise<WorkspaceRead>;
}

export type WorkspaceChange={readonly kind:'reserve';readonly admission:WorkflowAdmission;readonly contextCheckedAt:string};
export interface WorkspaceWrite{
 readonly workspace?:WorkspaceRecord;
 readonly operation:WorkflowOperationRecord;
 readonly inserted?:boolean;
}
