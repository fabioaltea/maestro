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
}
