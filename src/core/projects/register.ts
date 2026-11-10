import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { normalizeProjectName } from '../../domain/projects/model.js';
import { normalizeProjectCommand, requireLocalBranch, type RegisterParams } from '../../domain/projects/intent.js';
import { canonicalRepositoryIdentity, canonicalReferenceCheckout } from '../../domain/projects/repository-evidence.js';
import type { RepositoryInspection, FilesystemIdentity } from '../../ports/repository.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ProjectExecution } from './operations.js';

export function registrationConfiguration(params: RegisterParams, evidence: RepositoryInspection): { displayName: string; baseBranch: string | null } {
  const displayName = normalizeProjectName(params.name ?? basename(evidence.reference.root.canonicalPath));
  const baseBranch = params.baseBranch === undefined ? evidence.proposedBaseBranch : requireLocalBranch(params.baseBranch);
  if (baseBranch !== null && (evidence.proposedBaseBranch !== baseBranch || evidence.observation.baseState !== 'VALID' || !evidence.observation.baseOid)) {
    throw new Error('INVALID_BASE_BRANCH');
  }
  return { displayName, baseBranch };
}

export async function registerProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity) {
  if (context.operation.action !== 'REGISTER') throw new Error('INVALID_REQUEST');
  const original = JSON.parse(context.operation.canonicalIntent) as { params: unknown };
  const command = normalizeProjectCommand('REGISTER', original.params);
  if (command.action !== 'REGISTER') throw new Error('INVALID_REQUEST');
  const params = command.params;
  const candidate = await context.probe({ kind: 'CANDIDATE', path: params.path,
    ...(params.baseBranch === undefined ? {} : { requestedBase: params.baseBranch }) });
  if (!candidate.ok) throw new Error(candidate.error.code);
  const configuration = registrationConfiguration(params, candidate.value);
  const identity = canonicalRepositoryIdentity(candidate.value.identity), reference = canonicalReferenceCheckout(candidate.value.reference);
  // Defaults are selected once. A second confined observation validates that
  // fixed identity/reference/base immediately before confirmation.
  const confirmed = await context.probe({ kind: 'REGISTERED', identity: candidate.value.identity,
    reference: candidate.value.reference, configuredBase: configuration.baseBranch });
  if (!confirmed.ok) throw new Error(confirmed.error.code);
  if (canonicalRepositoryIdentity(confirmed.value.identity) !== identity || canonicalReferenceCheckout(confirmed.value.reference) !== reference) {
    throw new Error('REPOSITORY_CHANGED');
  }
  if (configuration.baseBranch !== null && (confirmed.value.observation.baseState !== 'VALID' || !confirmed.value.observation.baseOid)) throw new Error('INVALID_BASE_BRANCH');
  for (const expected of [candidate.value.identity.commonDirectory, candidate.value.reference.root, candidate.value.reference.adminDirectory]) {
    const observed = await filesystem.capture(expected.canonicalPath, 'directory');
    if (filesystem.compare(expected, observed) !== 'VERIFIED') throw new Error('REPOSITORY_CHANGED');
  }
  if (context.signal.aborted) throw new Error('INTERRUPTED');
  if (context.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  const result = await storage.commitProjectRegistration({ requestId: context.operation.requestId, instanceId: context.operation.owningInstanceId,
    displayName: configuration.displayName, baseBranch: configuration.baseBranch, repositoryKey: createHash('sha256').update(identity).digest('hex'),
    repositoryIdentity: candidate.value.identity, referenceCheckout: candidate.value.reference,
    observation: confirmed.value.observation, completedAt: new Date().toISOString() });
  await context.checkpoint('project.beforeAck');
  return result;
}
