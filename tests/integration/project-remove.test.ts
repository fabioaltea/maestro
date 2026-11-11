import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { createProjectHarness } from '../fixtures/project-client.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';

for (const state of ['dirty', 'conflicted', 'linked', 'absent'] as const) {
  test(`remove ${state} registration preserves all repository files, other checkouts and other projects`, async t => {
    const a = await createProjectHarness(t), main = await a.f.createRepository('main');
    const repo = state === 'linked' ? await a.f.addWorktree(main, 'linked') : main;
    if (state === 'conflicted') await a.f.makeConflicted(repo); else await a.f.makeDirty(repo);
    const other = await a.register(await a.f.createRepository('other-project')), added = await a.register(repo);
    const unrelated = await a.get(other.projectId!);
    if (state === 'absent') await rename(repo, repo + '.saved');
    const source = await snapshotArchive(a.f.directory);
    const removed = await a.client.runProject('remove', { projectId: added.projectId, expectedRevision: '1' }, { stateDirectory: a.h.archive });
    assert.equal(removed.outcome, 'SUCCEEDED', JSON.stringify(removed)); assert.equal(decodeProjectOperationView(removed.data.operation).result!.effect, 'REMOVED');
    const listed = await a.other.runProject('list', {}, { stateDirectory: a.h.archive });
    assert.deepEqual((listed.data.projects as { projectId: string }[]).map(project => project.projectId), [other.projectId]);
    assert.deepEqual(await a.get(other.projectId!), unrelated); assert.deepEqual(await snapshotArchive(a.f.directory), source);
    const removedQuery = await a.other.runProject('get', { projectId: added.projectId }, { stateDirectory: a.h.archive });
    assert.equal(removedQuery.error?.code, 'PROJECT_REMOVED');
  });
}

test('unknown/stale IDs never remove another project; reimport allocates a new UUID immune to the old removal retry', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('reimport'), added = await a.register(repo);
  const originalProject = await a.get(added.projectId!), source = await a.f.snapshotTree(repo);
  for (const params of [{ projectId: randomUUID(), expectedRevision: '1' }, { projectId: added.projectId, expectedRevision: '9' }]) {
    const failed = await a.client.runProject('remove', params, { stateDirectory: a.h.archive });
    assert.equal(failed.error?.code, params.expectedRevision === '9' ? 'REVISION_CONFLICT' : 'PROJECT_NOT_FOUND', JSON.stringify(failed));
    assert.deepEqual(await a.get(added.projectId!), originalProject);
  }
  const requestId = randomUUID(), params = { projectId: added.projectId, expectedRevision: '1' };
  const removed = await a.client.runProject('remove', params, { stateDirectory: a.h.archive, requestId });
  assert.equal(removed.outcome, 'SUCCEEDED', JSON.stringify(removed));
  const next = await a.register(repo); assert.notEqual(next.projectId, added.projectId); assert.equal(next.configRevision, '1');
  const retry = await a.other.runProject('remove', params, { stateDirectory: a.h.archive, requestId });
  assert.deepEqual(decodeProjectOperationView(retry.data.operation).result, decodeProjectOperationView(removed.data.operation).result);
  assert.equal((await a.get(next.projectId!)).projectId, next.projectId); assert.deepEqual(await a.f.snapshotTree(repo), source);
});
