import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createRegistryStore } from './registry-store.js';
import type { RepositoryInspection, FilesystemAnchor } from '../../src/ports/repository.js';
export function observationInspection(): RepositoryInspection {
  const anchor = (canonicalPath: string, inode: string): FilesystemAnchor => ({ version: 1, canonicalPath, kind: 'directory', device: '100', inode, birthtimeNs: '1000' });
  return { identity: { version: 1, commonDirectory: anchor('/fixture/.git', '1') },
    reference: { version: 1, root: anchor('/fixture', '2'), adminDirectory: anchor('/fixture/.git', '1') }, proposedBaseBranch: 'fixture-base',
    observation: { startedAt: '2026-11-10T12:00:00.000Z', completedAt: '2026-11-10T12:00:00.200Z', referencePath: '/fixture',
      checkoutAvailability: 'VERIFIED', repositoryIdentityStatus: 'VERIFIED', hasCommits: true, headKind: 'BRANCH', currentBranch: 'fixture-base',
      headOid: 'a'.repeat(40), objectFormat: 'sha1', baseState: 'VALID', baseOid: 'a'.repeat(40), trackedChanges: false, untrackedChanges: false,
      conflicts: false, fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES', limitations: ['SUBMODULE_CONTENTS_NOT_INSPECTED'], error: null } };
}
export async function observationStore(t: TestContext) {
  const f = await createRegistryStore(t), evidence = observationInspection(), intent = f.intent('REGISTER', { path: '/fixture' });
  f.store.acceptProjectOperation(intent);
  const result = f.store.commitProjectRegistration({ requestId: intent.requestId, instanceId: f.instanceId, displayName: 'Fixture', baseBranch: 'fixture-base',
    repositoryKey: createHash('sha256').update(JSON.stringify(evidence.identity)).digest('hex'), repositoryIdentity: evidence.identity,
    referenceCheckout: evidence.reference, observation: evidence.observation, completedAt: evidence.observation.completedAt });
  return { ...f, evidence, projectId: result.projectId! };
}
