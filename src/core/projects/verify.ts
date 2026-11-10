import type { ProjectExecution } from './operations.js';
import type { StoragePort } from '../../ports/storage.js';
import type { InspectionFailure, RepositoryObservationEvidence, InspectionResult, FilesystemIdentity } from '../../ports/repository.js';
import type { ProjectState } from '../../ports/registry.js';
import { canonicalRepositoryIdentity, canonicalReferenceCheckout } from '../../domain/projects/repository-evidence.js';

export function unavailableObservation(state: ProjectState, error: InspectionFailure, startedAt: string, completedAt: string): RepositoryObservationEvidence {
  return { startedAt, completedAt, referencePath: state.project.referenceCheckout.root.canonicalPath,
    checkoutAvailability: ['REFERENCE_CHECKOUT_UNAVAILABLE', 'REPOSITORY_NOT_FOUND', 'PATH_ACCESS_DENIED'].includes(error.code) ? 'UNAVAILABLE' : 'UNKNOWN',
    repositoryIdentityStatus: error.code === 'REPOSITORY_CHANGED' ? 'CHANGED' : 'UNVERIFIED', hasCommits: null,
    headKind: 'UNKNOWN', currentBranch: null, headOid: null, objectFormat: null,
    baseState: state.project.baseBranch === null ? 'UNCONFIGURED' : 'UNVERIFIED', baseOid: null,
    trackedChanges: null, untrackedChanges: null, conflicts: null, fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES',
    limitations: ['FILE_STATUS_UNVERIFIED', 'SUBMODULE_CONTENTS_NOT_INSPECTED'], error };
}
export async function verifyProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity) {
  if (context.operation.action !== 'VERIFY' || !context.operation.projectId) throw new Error('INVALID_REQUEST');
  const state = await storage.getProject(context.operation.projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  const startedAt = new Date().toISOString();
  const request = { kind: 'REGISTERED' as const, identity: state.project.repositoryIdentity,
    reference: state.project.referenceCheckout, configuredBase: state.project.baseBranch };
  let inspection: InspectionResult = await context.probe(request);
  await context.checkpoint('project.verified');
  if (inspection.ok) {
    const first = inspection.value;
    const latest = await context.probe(request);
    inspection = latest;
    if (latest.ok && (first.observation.headOid !== latest.value.observation.headOid
      || first.observation.baseOid !== latest.value.observation.baseOid || first.observation.currentBranch !== latest.value.observation.currentBranch)) {
      inspection = { ok: false, error: { code: 'REPOSITORY_UNSTABLE', retryable: true, nextAction: 'retry-inspection' } };
    }
  }
  if (inspection.ok && (canonicalRepositoryIdentity(inspection.value.identity) !== canonicalRepositoryIdentity(state.project.repositoryIdentity)
    || canonicalReferenceCheckout(inspection.value.reference) !== canonicalReferenceCheckout(state.project.referenceCheckout))) {
    inspection = { ok: false, error: { code: 'REPOSITORY_CHANGED', retryable: false, nextAction: 'review-repository-identity' } };
  }
  if (inspection.ok) {
    try {
      for (const expected of [request.identity.commonDirectory, request.reference.root, request.reference.adminDirectory]) {
        if (filesystem.compare(expected, await filesystem.capture(expected.canonicalPath, 'directory')) !== 'VERIFIED') throw new Error('REPOSITORY_CHANGED');
      }
    } catch {
      inspection = { ok: false, error: { code: 'REPOSITORY_CHANGED', retryable: false, nextAction: 'review-repository-identity' } };
    }
  }
  // Shutdown/deadline means no new observation; it is never a successful negative Git verification.
  if (context.signal.aborted || (!inspection.ok && inspection.error.code === 'INTERRUPTED')) throw new Error('INTERRUPTED');
  if (context.deadline.expired() || (!inspection.ok && inspection.error.code === 'DEADLINE_EXCEEDED')) throw new Error('DEADLINE_EXCEEDED');
  const observation = inspection.ok ? inspection.value.observation : unavailableObservation(state, inspection.error, startedAt, new Date().toISOString());
  const result = await storage.commitProjectObservation({ requestId: context.operation.requestId, instanceId: context.operation.owningInstanceId,
    projectId: state.project.projectId, expectedConfigRevision: state.project.configRevision,
    expectedObservationRevision: state.observation?.observationRevision ?? null, observation, completedAt: new Date().toISOString() });
  await context.checkpoint('project.beforeAck');
  return result;
}
