import { foundationError } from '../../domain/errors.js';
import type { ProjectDetail, ProjectState, RegistryRegistrationPort } from '../../ports/registry.js';

export function projectDetail(state: ProjectState): ProjectDetail {
  const { project, observation: o } = state;
  let observation: ProjectDetail['observation'] = null;
  if (o) {
    const error = o.error ? foundationError(o.error.code, { persisted: o.error.persisted, cause: o.error.cause,
      ...(o.error.operationId ? { operationId: o.error.operationId } : {}) }) : null;
    observation = { projectId: o.projectId, observationRevision: o.observationRevision, observedConfigRevision: o.observedConfigRevision,
      requestId: o.requestId, observedInstanceId: o.observedInstanceId, startedAt: o.startedAt, completedAt: o.completedAt,
      referencePath: o.referencePath, checkoutAvailability: o.checkoutAvailability, repositoryIdentityStatus: o.repositoryIdentityStatus,
      hasCommits: o.hasCommits, headKind: o.headKind, currentBranch: o.currentBranch, headOid: o.headOid, objectFormat: o.objectFormat,
      baseState: o.baseState, baseOid: o.baseOid, trackedChanges: o.trackedChanges, untrackedChanges: o.untrackedChanges,
      conflicts: o.conflicts, fileStatusScope: o.fileStatusScope, limitations: o.limitations, error, freshness: 'LAST_KNOWN' };
  }
  return { projectId: project.projectId, displayName: project.displayName, referenceCheckout: project.referenceCheckout.root.canonicalPath,
    baseBranch: project.baseBranch, baseState: project.baseBranch === null ? 'UNCONFIGURED'
      : o?.observedConfigRevision === project.configRevision ? o.baseState : 'UNVERIFIED',
    configRevision: project.configRevision, createdAt: project.createdAt, updatedAt: project.updatedAt, observation };
}
export async function readProject(storage: Pick<RegistryRegistrationPort, 'getProject'>, projectId: string): Promise<ProjectDetail> {
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  return projectDetail(state);
}
