import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import type { ProjectPatch } from '../../src/domain/projects/intent.js';

async function update(a: Awaited<ReturnType<typeof createProjectHarness>>, projectId: string, revision: string, patch: ProjectPatch) {
  return a.client.runProject('update', { projectId, expectedRevision: revision, patch }, { stateDirectory: a.h.archive });
}

test('local branch configuration persists on detached dirty checkout without changing any Git file', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('update-local');
  await a.f.git(repo, ['branch', 'chosen-base']); await a.f.git(repo, ['checkout', '--detach']); await a.f.makeDirty(repo);
  const added = await a.register(repo), original = await a.get(added.projectId!); assert.equal(original.baseBranch, null);
  const before = await a.f.snapshotTree(repo);
  const result = await update(a, added.projectId!, '1', { name: 'Chosen', baseBranch: 'chosen-base' });
  assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result));
  const current = await a.get(added.projectId!);
  assert.equal(current.baseBranch, 'chosen-base'); assert.equal(current.displayName, 'Chosen'); assert.equal(current.configRevision, '2');
  assert.deepEqual(current.observation, original.observation); assert.deepEqual(await a.f.snapshotTree(repo), before);
  assert.equal((await a.h.call('restart')).code, 0); assert.deepEqual(await a.get(added.projectId!), current);
});

test('remote-only, missing and unborn branch values reject an atomic name/base patch', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('invalid-base');
  await a.f.git(repo, ['update-ref', 'refs/remotes/origin/remote-only', 'HEAD']);
  const added = await a.register(repo), original = await a.get(added.projectId!);
  const before = await a.f.snapshotTree(repo);
  for (const baseBranch of ['origin/remote-only', 'remote-only', 'missing']) {
    const result = await update(a, added.projectId!, '1', { name: 'Must not change', baseBranch });
    assert.equal(result.error?.code, 'INVALID_BASE_BRANCH', JSON.stringify(result)); assert.deepEqual(await a.get(added.projectId!), original);
  }
  assert.deepEqual(await a.f.snapshotTree(repo), before);
  const empty = await a.f.createRepository('unborn-base', { commit: false }), unborn = await a.register(empty);
  const rejected = await update(a, unborn.projectId!, '1', { baseBranch: 'fixture-base' });
  assert.equal(rejected.error?.code, 'INVALID_BASE_BRANCH'); assert.equal((await a.get(unborn.projectId!)).baseBranch, null);
});

test('rename/clear work with an unavailable reference and never require a Git probe or change the saved identity', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('missing-for-name');
  const added = await a.register(repo), original = await a.get(added.projectId!);
  await rename(repo, repo + '.saved');
  const result = await update(a, added.projectId!, '1', { name: 'Offline reference', baseBranch: null });
  assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result));
  const current = await a.get(added.projectId!);
  assert.equal(current.configRevision, '2'); assert.equal(current.referenceCheckout, original.referenceCheckout);
  assert.equal(current.baseBranch, null); assert.deepEqual(current.observation, original.observation);
});

test('explicit first base selection is separate from verify; deleting it never substitutes another branch', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('first-base', { commit: false });
  const added = await a.register(repo);
  await writeFile(join(repo, 'first.txt'), 'first external commit\n'); await a.f.git(repo, ['add', 'first.txt']); await a.f.git(repo, ['commit', '-m', 'external']);
  const observed = await a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive });
  assert.equal(observed.outcome, 'SUCCEEDED'); assert.equal((await a.get(added.projectId!)).baseBranch, null);
  const selected = await update(a, added.projectId!, '1', { baseBranch: 'fixture-base' });
  assert.equal(selected.outcome, 'SUCCEEDED', JSON.stringify(selected));
  await a.f.git(repo, ['checkout', '--detach']); await a.f.git(repo, ['branch', '-D', 'fixture-base']);
  const snapshot = await a.f.snapshotTree(repo);
  assert.equal((await a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive })).outcome, 'SUCCEEDED');
  const invalid = await a.get(added.projectId!);
  assert.equal(invalid.projectId, added.projectId); assert.equal(invalid.baseBranch, 'fixture-base'); assert.equal(invalid.configRevision, '2');
  assert.equal(invalid.observation.baseState, 'INVALID'); assert.deepEqual(await a.f.snapshotTree(repo), snapshot);
});
