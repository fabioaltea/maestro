import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createProjectHarness } from '../fixtures/project-client.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createDirectRepositoryInspector } from '../../src/platform/macos/git/repository-inspector.js';
import { createFilesystemIdentity } from '../../src/platform/macos/git/filesystem-identity.js';
import { canonicalRepositoryIdentity } from '../../src/domain/projects/repository-evidence.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { updateProject } from '../../src/core/projects/update.js';
import { verifyProject } from '../../src/core/projects/verify.js';
import { createProjectDispatch } from '../../src/core/projects/dispatch.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';
import type { ProjectPatch } from '../../src/domain/projects/intent.js';

async function controlled(t: Parameters<typeof createRegistryStore>[0]) {
  const f = await createRegistryStore(t), r = await createProjectRepositories(t), repo = await r.createRepository('controlled-update');
  await r.git(repo, ['branch', 'candidate-base']);
  const inspector = createDirectRepositoryInspector(), filesystem = createFilesystemIdentity();
  const inspected = await inspector.inspectCandidate(repo, undefined, { deadline: makeDeadline(systemClock, 5_000) });
  assert.ok(inspected.ok, JSON.stringify(inspected));
  const evidence = inspected.value, intent = f.intent('REGISTER', { path: repo }); f.store.acceptProjectOperation(intent);
  const registered = f.store.commitProjectRegistration({ requestId: intent.requestId, instanceId: f.instanceId, displayName: 'Original',
    baseBranch: 'fixture-base', repositoryKey: createHash('sha256').update(canonicalRepositoryIdentity(evidence.identity)).digest('hex'),
    repositoryIdentity: evidence.identity, referenceCheckout: evidence.reference, observation: evidence.observation, completedAt: new Date().toISOString() });
  const projectId = registered.projectId!;
  const storage = { getProject: async (id: string) => f.store.getProject(id),
    commitProjectUpdate: async (input: Parameters<typeof f.store.commitProjectUpdate>[0]) => f.store.commitProjectUpdate(input),
    commitProjectObservation: async (input: Parameters<typeof f.store.commitProjectObservation>[0]) => f.store.commitProjectObservation(input) } as StoragePort;
  const context = (action: 'UPDATE' | 'VERIFY', patch?: ProjectPatch, checkpoint: (point: string) => Promise<void> = async () => {}): ProjectExecution => {
    const accepted = { ...f.intent(action, { projectId, ...(action === 'UPDATE' ? { expectedRevision: '1', patch } : {}) }), projectId };
    f.store.acceptProjectOperation(accepted);
    const deadline = makeDeadline(systemClock, 5_000);
    return { operation: f.store.getProjectOperation(accepted.requestId)!, deadline, signal: new AbortController().signal, checkpoint,
      probe: async request => {
        assert.equal(request.kind, 'REGISTERED');
        if (request.kind !== 'REGISTERED') throw new Error('wrong probe');
        return inspector.inspectRegistered(request.identity, request.reference, request.configuredBase, { deadline });
      } };
  };
  return { ...f, r, repo, projectId, storage, filesystem, context };
}

test('two real clients updating the same revision confirm exactly one change', async t => {
  const a = await createProjectHarness(t), added = await a.register(await a.f.createRepository('two-updates'));
  const snapshot = await a.f.snapshotTree((await a.get(added.projectId!)).referenceCheckout);
  const results = await Promise.all([a.client, a.other].map((actor, i) => actor.runProject('update', {
    projectId: added.projectId, expectedRevision: '1', patch: { name: `Client ${i}` },
  }, { stateDirectory: a.h.archive })));
  assert.equal(results.filter(result => result.outcome === 'SUCCEEDED').length, 1);
  assert.equal(results.filter(result => result.error?.code === 'REVISION_CONFLICT').length, 1);
  const project = await a.get(added.projectId!); assert.equal(project.configRevision, '2');
  assert.deepEqual(await a.f.snapshotTree(project.referenceCheckout), snapshot);
});

test('verify completed after update cannot publish evidence against the previous configuration', async t => {
  const f = await controlled(t), original = f.store.getProject(f.projectId)!;
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const delayed = verifyProject(f.context('VERIFY', undefined, async point => { if (point === 'project.verified') { entered(); await gate; } }), f.storage, f.filesystem);
  await ready;
  try { await updateProject(f.context('UPDATE', { name: 'Renamed while verifying' }), f.storage, f.filesystem); }
  finally { release(); }
  await assert.rejects(delayed, /OBSERVATION_SUPERSEDED/);
  const project = f.store.getProject(f.projectId)!;
  assert.equal(project.project.configRevision, '2'); assert.deepEqual(project.observation, original.observation);
});

test('a completed verify does not consume configuration revision or invalidate an admitted rename', async t => {
  const f = await controlled(t), rename = f.context('UPDATE', { name: 'Still authorized' });
  await verifyProject(f.context('VERIFY'), f.storage, f.filesystem);
  const observed = f.store.getProject(f.projectId)!.observation;
  const updated = await updateProject(rename, f.storage, f.filesystem);
  assert.equal(updated.configRevision, '2'); assert.equal(updated.observationRevision, '2');
  assert.deepEqual(f.store.getProject(f.projectId)!.observation, observed);
});

for (const change of ['delete-base', 'move-base', 'concurrent-rename'] as const) {
  test(`set-base rechecks ${change} during probe and never commits a partial name/base patch`, async t => {
    const f = await controlled(t), original = f.store.getProject(f.projectId)!;
    if (change === 'move-base') {
      await f.r.git(f.repo, ['commit', '--allow-empty', '-m', 'another commit']);
    }
    const context = f.context('UPDATE', { name: 'Must be atomic', baseBranch: 'candidate-base' }, async point => {
      if (point !== 'project.update.probed') return;
      if (change === 'delete-base') await f.r.git(f.repo, ['branch', '-D', 'candidate-base']);
      else if (change === 'move-base') await f.r.git(f.repo, ['branch', '-f', 'candidate-base', 'HEAD']);
      else await updateProject(f.context('UPDATE', { name: 'Winner' }), f.storage, f.filesystem);
    });
    await assert.rejects(updateProject(context, f.storage, f.filesystem), change === 'concurrent-rename' ? /REVISION_CONFLICT/ : change === 'delete-base' ? /INVALID_BASE_BRANCH/ : /REPOSITORY_UNSTABLE/);
    const current = f.store.getProject(f.projectId)!;
    assert.equal(current.project.baseBranch, original.project.baseBranch);
    assert.equal(current.project.displayName, change === 'concurrent-rename' ? 'Winner' : 'Original');
    assert.deepEqual(current.observation, original.observation);
  });
}

test('a controller role cannot authorize UPDATE or reach the admission/private lookup', async t => {
  const f = await controlled(t); let calls = 0;
  const dispatch = createProjectDispatch({ storage: f.storage, operations: {
    get: async () => { calls++; throw new Error('must not lookup'); }, admit: async () => { calls++; throw new Error('must not admit'); },
  } });
  const before = f.store.getProject(f.projectId);
  const response = await dispatch({ protocolVersion: 1, correlationId: randomUUID(), method: 'projects.update', params: {
    requestId: randomUUID(), projectId: f.projectId, expectedRevision: '1', patch: { name: 'Unauthorized' },
  } }, { role: 'controller', identity: f.instanceId, credentialId: 'fixture' }, f.store.readSnapshot()!);
  assert.equal((response.data as { code: string }).code, 'UNAUTHORIZED'); assert.equal(calls, 0);
  assert.deepEqual(f.store.getProject(f.projectId), before);
});
