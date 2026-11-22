import type {FilesystemAnchor} from '../../ports/repository.js';
import type {WorkspaceDiskObservation,WorkspaceLease,WorkspaceMarker,WorkspaceRecord,WorkspaceReleaseProof} from '../../ports/workspace.js';
import {requireUuid} from '../identifiers.js';

type Worktree=NonNullable<WorkspaceDiskObservation['worktree']>;
export const WORKSPACE_HOLDERS=['ENVIRONMENT','RUN','INTEGRATION'] as const;
export type WorkspaceHolder=typeof WORKSPACE_HOLDERS[number];

export function sameWorkspaceAnchor(left:FilesystemAnchor,right:FilesystemAnchor){
 return left.version===right.version&&left.kind===right.kind&&left.canonicalPath===right.canonicalPath
   &&left.device===right.device&&left.inode===right.inode&&left.birthtimeNs===right.birthtimeNs;
}

export function requireMatchingWorktree(owned:Worktree|null,observed:Worktree|null):asserts observed is Worktree {
 if(!owned||!observed||owned.branchRef!==observed.branchRef||!sameWorkspaceAnchor(owned.root,observed.root)
   ||!sameWorkspaceAnchor(owned.adminDirectory,observed.adminDirectory)||!sameWorkspaceAnchor(owned.gitFile,observed.gitFile))
   throw new Error('OWNERSHIP_UNPROVEN');
}

export function requireWorkspaceOwnership(storeId:string,workspace:WorkspaceRecord,reading:{digest:string;marker:WorkspaceMarker}|null,observation:WorkspaceDiskObservation){
 if(!reading||reading.digest!==workspace.markerDigest||reading.marker.storeId!==storeId||
   reading.marker.workspaceId!==workspace.workspaceId||reading.marker.repositoryKey!==workspace.repositoryKey||
   reading.marker.ownerGeneration!==workspace.ownerGeneration||!workspace.ownership||
   reading.marker.ownership.headOid!==workspace.ownership.headOid)throw new Error('OWNERSHIP_UNPROVEN');
 requireUuid(reading.marker.requestId);
 requireMatchingWorktree(workspace.ownership,reading.marker.ownership);
 requireMatchingWorktree(workspace.ownership,observation.worktree);
 if(observation.branchOid!==observation.worktree.headOid)throw new Error('OWNERSHIP_UNPROVEN');
 return observation.worktree;
}

export function requireWorkspaceRelease(lease:WorkspaceLease,proof:WorkspaceReleaseProof){
 for(const key of ['leaseId','workspaceId','holderId','generation','instanceId'] as const){
   if(requireUuid(lease[key])!==requireUuid(proof[key]))throw new Error('STALE_TARGET');
 }
 if(lease.holderType!==proof.holderType||!WORKSPACE_HOLDERS.includes(lease.holderType))throw new Error('STALE_TARGET');
 if(proof.kind==='EXIT'&&proof.hostExited===true&&proof.descendantsExited===true)return;
 if(proof.kind==='CHECKPOINT'&&proof.durable===true&&proof.quiescent===true)return;
 throw new Error('RESOURCE_IDENTITY_UNKNOWN');
}
