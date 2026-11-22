import { normalizeProjectCommand } from '../../domain/projects/intent.js';
import { canonicalRepositoryIdentity, canonicalReferenceCheckout } from '../../domain/projects/repository-evidence.js';
import type { FilesystemIdentity, RepositoryInspection } from '../../ports/repository.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ProjectExecution } from './operations.js';

export async function updateProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity) {
  if (context.operation.action !== 'UPDATE') throw new Error('INVALID_REQUEST');
  const command = normalizeProjectCommand('UPDATE', (JSON.parse(context.operation.canonicalIntent) as { params: unknown }).params);
  if (command.action !== 'UPDATE') throw new Error('INVALID_REQUEST');
  const { projectId, expectedRevision, patch } = command.params;
  const state = await storage.getProject(projectId);
  if (!state) throw new Error('PROJECT_NOT_FOUND');
  if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
  if (state.project.configRevision !== expectedRevision) throw new Error('REVISION_CONFLICT');
  let baseEvidence: RepositoryInspection | undefined;
  if (typeof patch.baseBranch === 'string') {
    const request = { kind: 'REGISTERED' as const, identity: state.project.repositoryIdentity,
      reference: state.project.referenceCheckout, configuredBase: patch.baseBranch };
    const validate = (proof: RepositoryInspection) => {
      if (canonicalRepositoryIdentity(proof.identity) !== canonicalRepositoryIdentity(state.project.repositoryIdentity)
        || canonicalReferenceCheckout(proof.reference) !== canonicalReferenceCheckout(state.project.referenceCheckout)) throw new Error('REPOSITORY_CHANGED');
      if (proof.proposedBaseBranch !== patch.baseBranch || proof.observation.baseState !== 'VALID' || !proof.observation.baseOid
        || proof.observation.repositoryIdentityStatus !== 'VERIFIED' || proof.observation.checkoutAvailability !== 'VERIFIED') throw new Error('INVALID_BASE_BRANCH');
    };
    const first = await context.probe(request);
    if (!first.ok) throw new Error(first.error.code);
    validate(first.value);
    await context.checkpoint('project.update.probed');
    const latest = await context.probe(request);
    if (!latest.ok) throw new Error(latest.error.code);
    validate(latest.value);
    if (first.value.observation.baseOid !== latest.value.observation.baseOid) throw new Error('REPOSITORY_UNSTABLE');
    for (const expected of [request.identity.commonDirectory, request.reference.root, request.reference.adminDirectory]) {
      if (filesystem.compare(expected, await filesystem.capture(expected.canonicalPath, 'directory')) !== 'VERIFIED') throw new Error('REPOSITORY_CHANGED');
    }
    baseEvidence = latest.value;
  }
  if (context.signal.aborted) throw new Error('INTERRUPTED');
  if (context.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  // The writer rechecks active identity/config revision and derives the entire
  // patch from its immutable intent. Latest observation is retained as history.
  const result = await storage.commitProjectUpdate({ requestId: context.operation.requestId, instanceId: context.operation.owningInstanceId,
    projectId, expectedConfigRevision: expectedRevision, ...(baseEvidence ? { baseEvidence } : {}), completedAt: new Date().toISOString() });
  await context.checkpoint('project.beforeAck');
  return result;
}
