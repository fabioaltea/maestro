import type { Project, ProjectObservation, ProjectOperation, ProjectOperationResult, ProjectPhase } from '../domain/projects/model.js';
import type { RepositoryIdentity, ReferenceCheckout, RepositoryObservationEvidence } from './repository.js';

export type AcceptProjectOperation = Omit<ProjectOperation, 'phase' | 'outcome' | 'completedAt' | 'result'>;
export interface RequestReservation { readonly scope: 'LIFECYCLE' | 'PROJECT'; readonly action: string; readonly payloadHash: string }
export type ProjectOperationView = Pick<ProjectOperation, 'requestId' | 'action' | 'projectId' | 'phase' | 'outcome'
  | 'acceptedAt' | 'deadlineAt' | 'completedAt' | 'result'>;
export interface RegistryOperationsPort {
  getRequestReservation(requestId: string): Promise<RequestReservation | null>;
  acceptProjectOperation(intent: AcceptProjectOperation): Promise<{ readonly accepted: boolean; readonly operation: ProjectOperation }>;
  getProjectOperation(requestId: string): Promise<ProjectOperation | null>;
  listPendingProjectOperations(): Promise<readonly ProjectOperation[]>;
  setProjectOperationPhase(requestId: string, phase: Exclude<ProjectPhase, 'FINALIZED'>): Promise<void>;
  completeProjectOperation(requestId: string, result: ProjectOperationResult): Promise<void>;
}
export interface ProjectState { readonly project: Project; readonly observation: ProjectObservation | null }
export interface ProjectDetail {
  readonly projectId: string; readonly displayName: string; readonly referenceCheckout: string;
  readonly baseBranch: string | null; readonly baseState: import('./repository.js').BaseState;
  readonly configRevision: string; readonly createdAt: string; readonly updatedAt: string;
  readonly observation: (ProjectObservation & { readonly freshness: 'LAST_KNOWN' }) | null;
}
export interface RegisterProjectCommit {
  readonly requestId: string; readonly instanceId: string; readonly displayName: string; readonly baseBranch: string | null;
  readonly repositoryKey: string; readonly repositoryIdentity: RepositoryIdentity; readonly referenceCheckout: ReferenceCheckout;
  readonly observation: RepositoryObservationEvidence; readonly completedAt: string;
}
export interface RegistryRegistrationPort {
  commitProjectRegistration(input: RegisterProjectCommit): Promise<ProjectOperationResult>;
  getProject(projectId: string): Promise<ProjectState | null>;
}
export interface RegistryPage {
  readonly projects: readonly ProjectDetail[];
  readonly registryRevision: string;
  readonly nextCursor: string | null;
}
export interface RegistryReadPort {
  getProject(projectId: string): Promise<ProjectState | null>;
  listProjects(options?: { readonly limit?: number; readonly cursor?: string }): Promise<RegistryPage>;
}
/** Atomic commits are specialized by story; no Git or asynchronous work inside a transaction. */
export interface ProjectCommitContext {
  readonly requestId: string;
  readonly instanceId: string;
  readonly completedAt: string;
}

export interface ObservationProjectCommit extends ProjectCommitContext {
  readonly projectId: string;
  readonly expectedConfigRevision: string;
  readonly expectedObservationRevision: string | null;
  readonly observation: RepositoryObservationEvidence;
}
export interface RegistryObservationPort {
  commitProjectObservation(input: ObservationProjectCommit): Promise<ProjectOperationResult>;
}

/** Only the immutable admitted patch may be applied; proof is required for explicit set-base. */
export interface UpdateProjectCommit extends ProjectCommitContext {
  readonly projectId: string;
  readonly expectedConfigRevision: string;
  readonly baseEvidence?: import('./repository.js').RepositoryInspection;
}
export interface RegistryUpdatePort {
  commitProjectUpdate(input: UpdateProjectCommit): Promise<ProjectOperationResult>;
}

export interface RemoveProjectCommit extends ProjectCommitContext {
  readonly projectId: string;
  readonly expectedConfigRevision: string;
}
export interface RegistryRemovalPort {
  commitProjectRemoval(input: RemoveProjectCommit): Promise<ProjectOperationResult>;
}

export interface ProjectTombstone {
  readonly projectId: string;
  readonly configRevision: string;
  readonly removedAt: string;
}

export interface ProjectRegistryDiagnostics {
  readonly activeProbes: number; readonly pending: number; readonly queued: number; readonly fenced: boolean;
  readonly limits: { readonly probes: 4; readonly pending: 32 };
  readonly categories: { readonly busy: number; readonly backpressure: number; readonly persistence: number; readonly deadlines: number };
  readonly maxQueueWaitMs: number;
}
