import type { Project, ProjectObservation, ProjectOperation, ProjectOperationResult, ProjectPhase } from '../domain/projects/model.js';

export type AcceptProjectOperation = Omit<ProjectOperation, 'phase' | 'outcome' | 'completedAt' | 'result'>;
export interface RequestReservation { readonly scope: 'LIFECYCLE' | 'PROJECT'; readonly action: string; readonly payloadHash: string }
export interface RegistryOperationsPort {
  getRequestReservation(requestId: string): Promise<RequestReservation | null>;
  acceptProjectOperation(intent: AcceptProjectOperation): Promise<{ readonly accepted: boolean; readonly operation: ProjectOperation }>;
  getProjectOperation(requestId: string): Promise<ProjectOperation | null>;
  listPendingProjectOperations(): Promise<readonly ProjectOperation[]>;
  setProjectOperationPhase(requestId: string, phase: Exclude<ProjectPhase, 'FINALIZED'>): Promise<void>;
  completeProjectOperation(requestId: string, result: ProjectOperationResult): Promise<void>;
}
export interface ProjectState { readonly project: Project; readonly observation: ProjectObservation | null }
export interface RegistryPage {
  readonly projects: readonly ProjectState[];
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
