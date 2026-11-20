import type {Deadline} from './clock.js';
import type {WorkspaceDiskObservation,WorkspaceGitPin,WorkspaceMutationTarget} from './workspace.js';
import type {RefAttribution} from '../domain/review/integration.js';

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
export interface GitCandidateScope extends GitIntegrationScope {
 readonly stagingId:string;
 readonly authoredAt:string;
}
export interface GitCandidate {
 readonly staging:IntegrationGuard;
 readonly candidateOid:string;
 readonly treeOid:string;
}
export interface GitIntegrationPort {
 qualification():Promise<WorkspaceGitPin>;
 preflight(input:GitIntegrationScope,deadline:Deadline):Promise<GitIntegrationPreflight>;
 captureDiff(input:GitIntegrationScope,deadline:Deadline):Promise<ReviewDiff>;
 reserveGuard(input:GitIntegrationScope,deadline:Deadline):Promise<IntegrationGuard>;
 prepareCandidate(input:GitCandidateScope,guard:IntegrationGuard,deadline:Deadline):Promise<
   {readonly kind:'CONFLICT';readonly staging:IntegrationGuard}|{readonly kind:'READY';readonly candidate:GitCandidate}>;
 inspectCandidate(input:GitCandidateScope,guard:IntegrationGuard,candidate:GitCandidate,deadline:Deadline):Promise<void>;
 publishCandidate(input:GitCandidateScope,guard:IntegrationGuard,candidate:GitCandidate,requestId:string,deadline:Deadline):Promise<RefAttribution>;
 observePublication(input:GitIntegrationScope,guard:IntegrationGuard,expected:RefAttribution,deadline:Deadline):Promise<
   {readonly targetOid:string;readonly proof:RefAttribution|null}>;
 publishFastForward(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline):Promise<{readonly resultingOid:string}>;
 syncGuard(input:GitIntegrationScope,guard:IntegrationGuard,deadline:Deadline,candidateOid?:string):Promise<void>;
}
