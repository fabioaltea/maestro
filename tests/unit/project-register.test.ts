import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadContract } from '../fixtures/load-contract.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import type { RegisterParams } from '../../src/domain/projects/intent.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { ProjectState } from '../../src/ports/registry.js';
import type { FilesystemAnchor, RepositoryInspection } from '../../src/ports/repository.js';

const anchor = (canonicalPath: string, inode: string): FilesystemAnchor => ({ version: 1, canonicalPath, kind: 'directory', device: '100', inode, birthtimeNs: '1000' });
function inspection(): RepositoryInspection {
  return { identity: { version: 1, commonDirectory: anchor('/fixtures/Maestro/.git', '1') },
    reference: { version: 1, root: anchor('/fixtures/Maestro', '2'), adminDirectory: anchor('/fixtures/Maestro/.git', '1') },
    proposedBaseBranch: 'fixture-base', observation: {
      startedAt: '2026-11-10T12:00:00.000Z', completedAt: '2026-11-10T12:00:00.200Z', referencePath: '/fixtures/Maestro',
      checkoutAvailability: 'VERIFIED', repositoryIdentityStatus: 'VERIFIED', hasCommits: true, headKind: 'BRANCH', currentBranch: 'fixture-base',
      headOid: 'a'.repeat(40), objectFormat: 'sha1', baseState: 'VALID', baseOid: 'a'.repeat(40), trackedChanges: false,
      untrackedChanges: false, conflicts: false, fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES', limitations: [], error: null,
    } };
}
const policy = () => loadContract<{ registrationConfiguration(params: RegisterParams, evidence: RepositoryInspection): { displayName: string; baseBranch: string | null } }>(
  'core/projects/register.js', ['registrationConfiguration']);
interface Commit {
  readonly requestId: string; readonly instanceId: string; readonly displayName: string; readonly baseBranch: string | null;
  readonly repositoryKey: string; readonly repositoryIdentity: RepositoryInspection['identity'];
  readonly referenceCheckout: RepositoryInspection['reference']; readonly observation: RepositoryInspection['observation']; readonly completedAt: string;
}
interface RegistrationStore {
  commitProjectRegistration(input: Commit): ProjectOperationResult;
  getProject(projectId: string): ProjectState | null;
}

test('registration computes a valid default name from the checkout root and validates explicit names without mutating evidence', async () => {
  const { registrationConfiguration } = await policy();
  const evidence = inspection(), original = structuredClone(evidence);
  assert.deepEqual(registrationConfiguration({ path: '/input/alias' }, evidence), { displayName: 'Maestro', baseBranch: 'fixture-base' });
  assert.deepEqual(registrationConfiguration({ path: '/input/alias', name: ' My 🎼 ' }, evidence), { displayName: 'My 🎼', baseBranch: 'fixture-base' });
  const badRoot = { ...evidence, reference: { ...evidence.reference, root: anchor('/fixtures/a\nb', '2') } };
  assert.throws(() => registrationConfiguration({ path: '/input' }, badRoot), /INVALID_NAME/);
  assert.equal(registrationConfiguration({ path: '/input', name: 'Explicit' }, badRoot).displayName, 'Explicit');
  assert.throws(() => registrationConfiguration({ path: '/input', name: 'bad\nname' }, evidence), /INVALID_NAME/);
  assert.deepEqual(evidence, original);
});

test('unborn, detached and absent base remain complete registrations without inventing a branch or approval', async () => {
  const { registrationConfiguration } = await policy();
  for (const headKind of ['UNBORN', 'DETACHED'] as const) {
    const original = inspection();
    const evidence = { ...original, proposedBaseBranch: null, observation: { ...original.observation,
      headKind, hasCommits: headKind === 'DETACHED', headOid: headKind === 'DETACHED' ? 'a'.repeat(40) : null,
      currentBranch: headKind === 'UNBORN' ? 'fixture-base' : null, baseState: 'UNCONFIGURED' as const, baseOid: null } };
    assert.deepEqual(registrationConfiguration({ path: '/input' }, evidence), { displayName: 'Maestro', baseBranch: null });
  }
});

test('explicit invalid or changed base is rejected even when a repository would be a duplicate', async () => {
  const { registrationConfiguration } = await policy();
  const evidence = inspection();
  for (const bad of [{ ...evidence, proposedBaseBranch: null }, { ...evidence, observation: { ...evidence.observation, baseState: 'INVALID' as const } },
    { ...evidence, observation: { ...evidence.observation, baseOid: null } }]) {
    assert.throws(() => registrationConfiguration({ path: '/input', baseBranch: 'fixture-base' }, bad), /INVALID_BASE_BRANCH/);
  }
  assert.throws(() => registrationConfiguration({ path: '/input', baseBranch: 'missing' }, evidence), /INVALID_BASE_BRANCH/);
});

test('only the winning registration allocates a project UUID; duplicate import preserves config, reference and observation', async t => {
  const allocated: string[] = [];
  const f = await createRegistryStore(t, undefined, () => { const id = randomUUID(); allocated.push(id); return id; });
  const store = f.store as unknown as RegistrationStore;
  assert.equal(typeof store.commitProjectRegistration, 'function', 'atomic registration commit is not implemented');
  const evidence = inspection();
  const prepare = (value: RepositoryInspection, displayName: string): Commit => {
    const input = f.intent('REGISTER', { path: value.reference.root.canonicalPath, name: displayName });
    f.store.acceptProjectOperation(input); f.store.setProjectOperationPhase(input.requestId, 'PROBING');
    return { requestId: input.requestId, instanceId: f.instanceId, displayName, baseBranch: value.proposedBaseBranch,
      repositoryKey: createHash('sha256').update(JSON.stringify(value.identity)).digest('hex'), repositoryIdentity: value.identity,
      referenceCheckout: value.reference, observation: value.observation, completedAt: '2026-11-10T12:00:01.000Z' };
  };
  const first = store.commitProjectRegistration(prepare(evidence, 'First'));
  assert.equal(first.effect, 'CREATED'); assert.equal(first.configRevision, '1'); assert.equal(first.observationRevision, '1');
  assert.equal(allocated.length, 1); assert.equal(first.projectId, allocated[0]);
  const confirmed = store.getProject(first.projectId!);
  const linked = { ...evidence, reference: { version: 1 as const, root: anchor('/fixtures/linked', '20'),
    adminDirectory: anchor('/fixtures/Maestro/.git/worktrees/linked', '21') }, proposedBaseBranch: 'another-valid',
    observation: { ...evidence.observation, referencePath: '/fixtures/linked', currentBranch: 'another-valid' } };
  for (let i = 0; i < 5; i++) {
    const duplicate = store.commitProjectRegistration(prepare(linked, 'Ignored'));
    assert.equal(duplicate.effect, 'EXISTING'); assert.equal(duplicate.projectId, first.projectId);
  }
  assert.equal(allocated.length, 1); assert.deepEqual(store.getProject(first.projectId!), confirmed);
  const invalid = prepare({ ...linked, proposedBaseBranch: 'missing', observation: { ...linked.observation, baseState: 'INVALID', baseOid: null } }, 'Invalid');
  assert.throws(() => store.commitProjectRegistration(invalid), /INVALID_BASE_BRANCH/);
  assert.deepEqual(store.getProject(first.projectId!), confirmed); assert.equal(allocated.length, 1);
  const replacement = { ...evidence, identity: { version: 1 as const, commonDirectory: { ...evidence.identity.commonDirectory, inode: '999' } } };
  assert.throws(() => store.commitProjectRegistration(prepare(replacement, 'Replacement')), /REPOSITORY_CHANGED/);
  assert.deepEqual(store.getProject(first.projectId!), confirmed); assert.equal(allocated.length, 1);
});
