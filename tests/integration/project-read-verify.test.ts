import test from 'node:test';
import assert from 'node:assert/strict';
import { rename, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';

for (const scenario of ['moved', 'denied', 'replacement', 'linked'] as const) {
  test(`verify preserves fixed reference and configuration for ${scenario} checkout`, async t => {
    const a = await createProjectHarness(t), main = await a.f.createRepository('main');
    const repo = scenario === 'linked' ? await a.f.addWorktree(main, 'linked') : main;
    const added = await a.register(repo), before = await a.get(added.projectId!);
    if (scenario === 'denied') { await chmod(repo, 0); t.after(() => chmod(repo, 0o755)); }
    else { await rename(repo, repo + '.saved'); if (scenario === 'replacement') await a.f.createRepository('main'); }
    const snapshot = await a.f.snapshotTree(a.f.directory);
    const result = await a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive });
    assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result));
    assert.equal(decodeProjectOperationView(result.data.operation).result!.effect, 'OBSERVED');
    const current = await a.get(added.projectId!);
    assert.equal(current.configRevision, before.configRevision); assert.equal(current.referenceCheckout, before.referenceCheckout);
    assert.equal(current.baseBranch, before.baseBranch); assert.equal(current.displayName, before.displayName);
    assert.notEqual(current.observation.repositoryIdentityStatus, 'VERIFIED');
    assert.ok(current.observation.error); assert.ok(current.observation.error.nextAction);
    assert.equal(current.observation.trackedChanges, null); assert.equal(current.observation.untrackedChanges, null);
    if (scenario === 'linked') await lstat(join(main, '.git'));
    assert.deepEqual(await a.f.snapshotTree(a.f.directory), snapshot);
  });
}

test('restart preserves IDs/config/dates; offline queries cannot create sidecars, recreate checkout or autostart', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('offline');
  const added = await a.register(repo), before = await a.get(added.projectId!);
  assert.equal((await a.h.call('restart')).code, 0); assert.deepEqual(await a.get(added.projectId!), before);
  assert.equal((await a.h.call('stop')).code, 0);
  await rename(repo, repo + '.saved');
  const snapshot = await a.f.snapshotTree(a.h.archive);
  for (const actor of [a.client, a.other]) {
    const listed = await actor.runProject('list', {}, { stateDirectory: a.h.archive });
    assert.equal(listed.result, 'OK', JSON.stringify(listed)); assert.equal(listed.freshness, 'LAST_KNOWN');
    assert.deepEqual((listed.data.projects as unknown[])[0], before);
    assert.deepEqual(await a.get(added.projectId!, actor), before);
  }
  assert.deepEqual(await a.f.snapshotTree(a.h.archive), snapshot); await assert.rejects(lstat(repo), { code: 'ENOENT' });
  const absent = join(a.h.directory, 'never-created');
  const result = await a.client.runProject('list', {}, { stateDirectory: absent });
  assert.equal(result.error?.code, 'STATE_ABSENT'); await assert.rejects(lstat(absent), { code: 'ENOENT' });
});
