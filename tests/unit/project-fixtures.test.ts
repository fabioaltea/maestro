import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { projectFault, snapshotDigest } from '../fixtures/project-faults.js';

test('project fixtures own their setup and distinguish empty, dirty, linked and nested repositories', async t => {
  const f = await createProjectRepositories(t);
  const empty = await f.createRepository('empty space', { commit: false });
  assert.equal((await f.git(empty, ['symbolic-ref', 'HEAD'])).trim(), 'refs/heads/fixture-base');
  await f.git(empty, ['rev-parse', '--verify', 'HEAD'], 128);
  const repo = await f.createRepository('repo Unicode è');
  const linked = await f.addWorktree(repo, 'linked checkout');
  const common = (await f.git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim();
  assert.equal((await f.git(linked, ['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim(), common);
  await f.createRepository('nested', { parent: repo });
  const before = snapshotDigest(await f.snapshotTree(repo));
  await f.makeDirty(repo);
  assert.notEqual(snapshotDigest(await f.snapshotTree(repo)), before);
  await assert.rejects(f.createRepository('../escape'), /INVALID_FIXTURE_NAME/);
  await assert.rejects(f.git('/', ['status']), /UNOWNED_FIXTURE/);
  await symlink('/', join(f.directory, 'foreign'));
  await assert.rejects(f.createRepository('foreign'), /EEXIST/);
});

test('sentinels are prepared without execution and fault checkpoints reuse the deterministic schedule', async t => {
  const f = await createProjectRepositories(t);
  const sentinel = await f.createSentinel("helper ' space");
  assert.match(await readFile(sentinel.script, 'utf8'), /^#!\/bin\/sh/);
  await assert.rejects(access(sentinel.marker), { code: 'ENOENT' });
  await assert.rejects(projectFault('project.beforeCommit').checkpoint('project.beforeCommit'), /TEST_FAULT/);
});
