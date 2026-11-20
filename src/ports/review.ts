import type {Deadline} from './clock.js';
import type {WorkspaceDiskObservation,WorkspaceGitPin,WorkspaceMutationTarget} from './workspace.js';

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
export interface GitIntegrationPort {
 qualification():Promise<WorkspaceGitPin>;
 preflight(input:GitIntegrationScope,deadline:Deadline):Promise<GitIntegrationPreflight>;
 reserveGuard(input:GitIntegrationScope,deadline:Deadline):Promise<IntegrationGuard>;
 publishFastForward(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline):Promise<{readonly resultingOid:string}>;
 syncGuard(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline):Promise<void>;
}
