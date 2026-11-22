import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createProjectHarness } from '../fixtures/project-client.js';

test('US1.1: registration is complete, dated and available to another client without changing any repository file', async t => {
  const h = await createProjectHarness(t);
  const repo = await h.f.createRepository('normal');
  const snapshot = await h.f.snapshotTree(repo);
  const registered = await h.register(repo, { name: 'Readable 🎼' });
  const project = await h.get(registered.projectId!);
  assert.equal(registered.effect, 'CREATED'); assert.equal(project.projectId, registered.projectId);
  assert.equal(project.displayName, 'Readable 🎼'); assert.equal(project.referenceCheckout, repo);
  assert.equal(project.configRevision, '1'); assert.equal(project.baseBranch, 'fixture-base');
  assert.equal(project.observation.observationRevision, '1'); assert.equal(project.observation.observedConfigRevision, '1');
  assert.equal(project.observation.freshness, 'LAST_KNOWN'); assert.ok(Number.isFinite(Date.parse(project.observation.completedAt)));
  assert.equal(project.observation.hasCommits, true); assert.equal(project.observation.baseState, 'VALID');
  assert.doesNotMatch(JSON.stringify(project), /"(?:repositoryIdentity|birthtimeNs|canonicalIntent|payloadHash)"\s*:/);
  assert.deepEqual(await h.f.snapshotTree(repo), snapshot);
});

test('US1.2: equivalent paths, subdirectories and Unicode/newline aliases deduplicate without implicit configuration changes', async t => {
  const h = await createProjectHarness(t);
  const repo = await h.f.createRepository('progetto è 🎼\nline');
  const alias = join(h.f.directory, 'alias'); await symlink(repo, alias);
  const subdir = join(repo, 'subdir'); await mkdir(subdir);
  const snapshot = await h.f.snapshotTree(repo);
  const original = await h.register(repo, { name: 'First' });
  const detail = await h.get(original.projectId!);
  for (const path of [alias, subdir, join(subdir, '..'), repo + '/']) {
    const duplicate = await h.register(path, { name: 'Ignored' }, h.other);
    assert.equal(duplicate.effect, 'EXISTING'); assert.equal(duplicate.projectId, original.projectId);
    assert.deepEqual(await h.get(original.projectId!), detail);
  }
  assert.deepEqual(await h.f.snapshotTree(repo), snapshot);
});

test('US1.3: two concurrent first imports produce exactly one project and one initial observation', async t => {
  const h = await createProjectHarness(t);
  const repo = await h.f.createRepository('concurrent');
  const snapshot = await h.f.snapshotTree(repo);
  const [one, two] = await Promise.all([h.register(repo, { name: 'One' }), h.register(repo, { name: 'Two' }, h.other)]);
  assert.equal(one.projectId, two.projectId); assert.deepEqual([one.effect, two.effect].sort(), ['CREATED', 'EXISTING']);
  const detail = await h.get(one.projectId!);
  assert.ok(['One', 'Two'].includes(detail.displayName)); assert.equal(detail.observation.observationRevision, '1');
  assert.equal(detail.configRevision, '1'); assert.deepEqual(await h.f.snapshotTree(repo), snapshot);
});

test('US1.4: invalid, inaccessible and non-Git paths return safe errors with no partial project', async t => {
  const h = await createProjectHarness(t);
  const plain = join(h.f.directory, 'not-git'); await mkdir(plain);
  for (const [path, code] of [[join(h.f.directory, 'absent'), 'REPOSITORY_NOT_FOUND'], [plain, 'REPOSITORY_NOT_FOUND']] as const) {
    const result = await h.client.runProject('register', { path }, { stateDirectory: h.h.archive });
    assert.equal(result.outcome, 'FAILED'); assert.equal(result.error?.code, code); assert.ok(result.error?.nextAction);
  }
  const inaccessible = await h.f.createRepository('inaccessible');
  const mode = (await lstat(inaccessible)).mode & 0o777;
  const snapshot = await h.f.snapshotTree(inaccessible);
  try {
    await chmod(inaccessible, 0);
    const denied = await h.client.runProject('register', { path: inaccessible }, { stateDirectory: h.h.archive });
    assert.equal(denied.error?.code, 'PATH_ACCESS_DENIED');
  } finally { await chmod(inaccessible, mode); }
  assert.deepEqual(await h.f.snapshotTree(inaccessible), snapshot);
  const database = new Database(join(h.h.archive, 'state.sqlite'), { readonly: true });
  try { assert.equal((database.prepare('SELECT count(*) AS count FROM projects').get() as { count: number }).count, 0); }
  finally { database.close(); }
});

test('US1.5: dirty, untracked, conflicts and unsafe filters remain untouched and are never reported as clean', async t => {
  const h = await createProjectHarness(t);
  const dirty = await h.f.createRepository('dirty'); await h.f.makeDirty(dirty);
  const conflicted = await h.f.createRepository('conflicted'); await h.f.makeConflicted(conflicted);
  for (const repo of [dirty, conflicted]) {
    const before = await h.f.snapshotTree(repo);
    const registered = await h.register(repo);
    const project = await h.get(registered.projectId!);
    assert.equal(project.observation.trackedChanges, true);
    assert.equal(project.observation.conflicts, repo === conflicted);
    if (repo === dirty) assert.equal(project.observation.untrackedChanges, true);
    assert.deepEqual(await h.f.snapshotTree(repo), before);
  }
  const unsafe = await h.f.createRepository('unsafe-filter');
  const sentinel = await h.f.createSentinel('must-not-run');
  await h.f.git(unsafe, ['config', 'filter.test.process', sentinel.command]);
  const before = await h.f.snapshotTree(unsafe);
  const registered = await h.register(unsafe);
  const partial = await h.get(registered.projectId!);
  assert.equal(partial.observation.trackedChanges, null); assert.equal(partial.observation.error?.code, 'INSPECTION_UNSAFE');
  assert.ok(partial.observation.limitations.includes('FILE_STATUS_UNVERIFIED'));
  assert.deepEqual(await h.f.snapshotTree(unsafe), before);
  await assert.rejects(lstat(sentinel.marker), { code: 'ENOENT' });
});

test('US1.6: unborn and detached repositories register completely; explicit invalid base is rejected even on duplicates', async t => {
  const h = await createProjectHarness(t);
  const empty = await h.f.createRepository('empty', { commit: false });
  const emptyBefore = await h.f.snapshotTree(empty);
  const registered = await h.register(empty);
  const project = await h.get(registered.projectId!);
  assert.equal(project.baseBranch, null); assert.equal(project.observation.hasCommits, false);
  assert.equal(project.observation.headKind, 'UNBORN'); assert.equal(project.observation.baseState, 'UNCONFIGURED');
  const invalid = await h.client.runProject('register', { path: empty, baseBranch: 'fixture-base' }, { stateDirectory: h.h.archive });
  assert.equal(invalid.error?.code, 'INVALID_BASE_BRANCH'); assert.deepEqual(await h.get(project.projectId), project);
  assert.deepEqual(await h.f.snapshotTree(empty), emptyBefore);
  const detached = await h.f.createRepository('detached'); await h.f.git(detached, ['checkout', '--detach']);
  const detachedBefore = await h.f.snapshotTree(detached);
  const one = await h.register(detached);
  const detail = await h.get(one.projectId!); assert.equal(detail.baseBranch, null); assert.equal(detail.observation.headKind, 'DETACHED');
  const duplicate = await h.register(detached, { baseBranch: 'fixture-base' });
  assert.equal(duplicate.effect, 'EXISTING'); assert.deepEqual(await h.get(detail.projectId), detail);
  const bad = await h.client.runProject('register', { path: detached, baseBranch: 'missing' }, { stateDirectory: h.h.archive });
  assert.equal(bad.error?.code, 'INVALID_BASE_BRANCH'); assert.deepEqual(await h.get(detail.projectId), detail);
  assert.deepEqual(await h.f.snapshotTree(detached), detachedBefore);
});

test('US1.7: linked checkout is fixed as first reference; main/other worktrees and common bare repository deduplicate correctly', async t => {
  const h = await createProjectHarness(t);
  const main = await h.f.createRepository('main');
  const linked = await h.f.addWorktree(main, 'linked', 'linked-one');
  const other = await h.f.addWorktree(main, 'linked-other', 'linked-two');
  const before = await h.f.snapshotTree(main);
  const first = await h.register(linked);
  const original = await h.get(first.projectId!); assert.equal(original.referenceCheckout, linked);
  for (const path of [main, other]) {
    assert.equal((await h.register(path)).projectId, first.projectId);
    assert.deepEqual(await h.get(first.projectId!), original);
  }
  assert.deepEqual(await h.f.snapshotTree(main), before);
  const bare = await h.f.createRepository('common-bare', { bare: true });
  await h.f.git(bare, ['fetch', main, 'fixture-base:fixture-base']);
  const checkout = await h.f.addWorktree(bare, 'bare-linked', 'from-bare');
  const bareBefore = await h.f.snapshotTree(bare), checkoutBefore = await h.f.snapshotTree(checkout);
  const imported = await h.register(checkout); assert.equal((await h.get(imported.projectId!)).referenceCheckout, checkout);
  const unsupported = await h.client.runProject('register', { path: bare }, { stateDirectory: h.h.archive });
  assert.equal(unsupported.error?.code, 'REPOSITORY_UNSUPPORTED');
  assert.deepEqual(await h.f.snapshotTree(bare), bareBefore); assert.deepEqual(await h.f.snapshotTree(checkout), checkoutBefore);
});

test('clones with the same remote, nested repositories and submodules retain separate repository identities', async t => {
  const h = await createProjectHarness(t);
  const outer = await h.f.createRepository('outer');
  const clone = join(h.f.directory, 'clone'); await h.f.git(h.f.directory, ['clone', '--no-hardlinks', '--', outer, clone]);
  for (const repo of [outer, clone]) await h.f.git(repo, ['config', 'remote.origin.url', 'https://example.invalid/shared']);
  const inner = await h.f.createRepository('inner', { parent: outer });
  const source = await h.f.createRepository('sub-source');
  await h.f.git(outer, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--', source, 'module']);
  await h.f.git(outer, ['commit', '-am', 'fixture submodule']);
  const module = join(outer, 'module');
  const snapshots = await Promise.all([outer, clone].map(repo => h.f.snapshotTree(repo)));
  const results = [];
  for (const repo of [outer, clone, inner, module]) results.push(await h.register(repo));
  assert.equal(new Set(results.map(result => result.projectId)).size, 4);
  assert.deepEqual(await h.f.snapshotTree(outer), snapshots[0]); assert.deepEqual(await h.f.snapshotTree(clone), snapshots[1]);
});
