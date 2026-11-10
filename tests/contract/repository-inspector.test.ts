import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { RepositoryInspector, RepositoryInspection } from '../../src/ports/repository.js';
import type { GitRunner } from '../../src/platform/macos/git/runner.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';

async function loadInspector(options?: { runner?: GitRunner; checkpoint?: (point: string) => Promise<void> }): Promise<RepositoryInspector> {
  const url = new URL('../../src/platform/macos/git/repository-inspector.js', import.meta.url);
  assert.ok(existsSync(url), 'required repository observation adapter has not been implemented');
  const module = await import(url.href) as {
    createDirectRepositoryInspector(options?: { runner?: GitRunner; checkpoint?: (point: string) => Promise<void> }): RepositoryInspector;
  };
  return module.createDirectRepositoryInspector(options);
}
const options = () => ({ deadline: makeDeadline(systemClock, 10_000) });
async function candidate(inspector: RepositoryInspector, path: string, branch?: string): Promise<RepositoryInspection> {
  const result = await inspector.inspectCandidate(path, branch, options());
  assert.ok(result.ok, result.ok ? 'expected verified candidate' : JSON.stringify(result.error));
  return result.value;
}

test('empty repositories register completely and a later first commit never configures an omitted base on verify', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('empty', { commit: false });
  const inspector = await loadInspector();
  const first = await candidate(inspector, repo);
  assert.equal(first.observation.headKind, 'UNBORN');
  assert.equal(first.observation.hasCommits, false);
  assert.equal(first.observation.currentBranch, 'fixture-base');
  assert.equal(first.proposedBaseBranch, null);
  assert.equal(first.observation.baseState, 'UNCONFIGURED');
  await writeFile(join(repo, 'first.txt'), 'first');
  await f.git(repo, ['add', '--', 'first.txt']); await f.git(repo, ['commit', '-m', 'first external commit']);
  const verified = await inspector.inspectRegistered(first.identity, first.reference, null, options());
  assert.ok(verified.ok);
  assert.equal(verified.value.observation.hasCommits, true);
  assert.equal(verified.value.proposedBaseBranch, null);
  assert.equal(verified.value.observation.baseState, 'UNCONFIGURED');
});

test('unborn HEAD is distinct from existing reachable history on another local branch', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('orphan');
  await f.git(repo, ['checkout', '--orphan', 'newborn']);
  const result = await candidate(await loadInspector(), repo);
  assert.equal(result.observation.headKind, 'UNBORN');
  assert.equal(result.observation.currentBranch, 'newborn');
  assert.equal(result.observation.hasCommits, true);
  assert.equal(result.proposedBaseBranch, null);
});

test('detached HEAD does not guess a base; an explicit local branch is validated without checkout', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('detached');
  await f.git(repo, ['checkout', '--detach']);
  const before = await f.snapshotTree(repo);
  const inspector = await loadInspector();
  const detached = await candidate(inspector, repo);
  assert.equal(detached.observation.headKind, 'DETACHED');
  assert.equal(detached.observation.currentBranch, null);
  assert.equal(detached.proposedBaseBranch, null);
  const explicit = await candidate(inspector, repo, 'fixture-base');
  assert.equal(explicit.proposedBaseBranch, 'fixture-base');
  assert.equal(explicit.observation.baseState, 'VALID');
  assert.deepEqual(await f.snapshotTree(repo), before);
  for (const branch of ['missing', 'origin/remote-only', 'fixture-base^{commit}']) {
    const invalid = await inspector.inspectCandidate(repo, branch, options());
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.error.code, 'INVALID_BASE_BRANCH');
  }
});

test('dirty/untracked/conflict observations preserve the complete repository and explicitly scope submodule contents', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('dirty'); await f.makeDirty(repo);
  const inspector = await loadInspector();
  const before = await f.snapshotTree(repo);
  const dirty = await candidate(inspector, repo);
  assert.equal(dirty.observation.trackedChanges, true);
  assert.equal(dirty.observation.untrackedChanges, true);
  assert.equal(dirty.observation.conflicts, false);
  assert.equal(dirty.observation.fileStatusScope, 'REFERENCE_CHECKOUT_DIRECT_ENTRIES');
  assert.ok(dirty.observation.limitations.includes('SUBMODULE_CONTENTS_NOT_INSPECTED'));
  assert.deepEqual(await f.snapshotTree(repo), before);
  const conflicted = await f.createRepository('conflicted'); await f.makeConflicted(conflicted);
  const snapshot = await f.snapshotTree(conflicted);
  assert.equal((await candidate(inspector, conflicted)).observation.conflicts, true);
  assert.deepEqual(await f.snapshotTree(conflicted), snapshot);
});

test('main and linked checkouts share common identity while their reference roots remain distinct, including bare-common', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('main');
  const linked = await f.addWorktree(repo, 'linked');
  const inspector = await loadInspector();
  const main = await candidate(inspector, repo);
  const other = await candidate(inspector, linked);
  assert.deepEqual(main.identity, other.identity);
  assert.notEqual(main.reference.root.canonicalPath, other.reference.root.canonicalPath);
  assert.notEqual(main.reference.adminDirectory.canonicalPath, other.reference.adminDirectory.canonicalPath);
  const bare = await f.createRepository('common-bare', { bare: true });
  await f.git(repo, ['push', bare, 'fixture-base']);
  const checkout = await f.addWorktree(bare, 'bare-linked', 'bare-branch');
  assert.equal((await candidate(inspector, checkout)).identity.commonDirectory.canonicalPath, bare);
  const rejected = await inspector.inspectCandidate(bare, undefined, options());
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'REPOSITORY_UNSUPPORTED');
});

test('aliases and subdirectories resolve to a checkout; nested repositories, clones and submodules stay distinct', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('root space è');
  const child = join(repo, 'directory'); await mkdir(child);
  const alias = join(f.directory, 'alias'); await symlink(child, alias);
  const inspector = await loadInspector();
  const original = await candidate(inspector, repo);
  assert.deepEqual((await candidate(inspector, alias)).identity, original.identity);
  const nested = await f.createRepository('nested', { parent: repo });
  assert.notDeepEqual((await candidate(inspector, nested)).identity, original.identity);
  const source = await f.createRepository('module-source');
  await f.git(repo, ['submodule', 'add', source, 'module']);
  assert.notDeepEqual((await candidate(inspector, join(repo, 'module'))).identity, original.identity);
  const clone = join(f.directory, 'clone'); await f.git(f.directory, ['clone', '--', repo, clone]);
  assert.notDeepEqual((await candidate(inspector, clone)).identity, original.identity);
});

test('executable filters yield UNKNOWN file status while safe metadata can still produce a complete candidate', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('unsafe-filter');
  const sentinel = await f.createSentinel('must-not-run');
  await f.git(repo, ['config', 'filter.sentinel.clean', sentinel.command]);
  await writeFile(join(repo, '.gitattributes'), '*.txt filter=sentinel\n');
  const before = await f.snapshotTree(repo);
  const result = await candidate(await loadInspector(), repo);
  assert.equal(result.observation.hasCommits, true);
  assert.equal(result.observation.trackedChanges, null);
  assert.equal(result.observation.untrackedChanges, null);
  assert.equal(result.observation.conflicts, null);
  assert.equal(result.observation.error?.code, 'INSPECTION_UNSAFE');
  assert.deepEqual(await f.snapshotTree(repo), before);
});

test('deleting a configured branch changes observation validity without replacing the saved base', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('base-deleted'); await f.git(repo, ['branch', 'alternative']);
  const inspector = await loadInspector(); const first = await candidate(inspector, repo, 'alternative');
  await f.git(repo, ['branch', '-D', 'alternative']);
  const verified = await inspector.inspectRegistered(first.identity, first.reference, 'alternative', options());
  assert.ok(verified.ok);
  assert.equal(verified.value.proposedBaseBranch, 'alternative');
  assert.equal(verified.value.observation.baseState, 'INVALID');
});

test('unavailable reference checkouts and replaced repository identities never rebind', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('replace');
  const inspector = await loadInspector(); const first = await candidate(inspector, repo);
  await rename(repo, repo + '-moved');
  const missing = await inspector.inspectRegistered(first.identity, first.reference, 'fixture-base', options());
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error.code, 'REFERENCE_CHECKOUT_UNAVAILABLE');
  await f.createRepository('replace');
  const replacement = await inspector.inspectRegistered(first.identity, first.reference, 'fixture-base', options());
  assert.equal(replacement.ok, false);
  if (!replacement.ok) assert.equal(replacement.error.code, 'REPOSITORY_CHANGED');
});

test('branch changes during observation are retryable uncertainty, not a valid mixed snapshot', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('racing-branch');
  const inspector = await loadInspector({ checkpoint: async point => {
    if (point === 'inspection.beforeRecheck') await f.git(repo, ['branch', '-m', 'renamed-externally']);
  } });
  const result = await inspector.inspectCandidate(repo, undefined, options());
  assert.equal(result.ok, false);
  if (!result.ok) { assert.equal(result.error.code, 'REPOSITORY_UNSTABLE'); assert.equal(result.error.retryable, true); }
});

test('missing commit objects are corruption/unverified evidence rather than an empty repository', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('missing-commit');
  const oid = (await f.git(repo, ['rev-parse', 'HEAD'])).trim();
  await rm(join(repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
  const result = await (await loadInspector()).inspectCandidate(repo, undefined, options());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'REPOSITORY_UNSUPPORTED');
});

test('SHA-256 repositories retain their object format and never assume a 40-character OID', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('sha256', { objectFormat: 'sha256' });
  const result = await candidate(await loadInspector(), repo);
  assert.equal(result.observation.objectFormat, 'sha256');
  assert.match(result.observation.headOid ?? '', /^[0-9a-f]{64}$/);
});

test('unavailable Git capability remains distinct from a missing repository and executes no query', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('git-unavailable');
  const runner: GitRunner = {
    capabilities: async () => ({ version: 1, status: 'UNAVAILABLE', gitVersion: null, confinement: 'UNAVAILABLE',
      error: { code: 'GIT_UNAVAILABLE', retryable: false, nextAction: 'install-supported-git' } }),
    run: async () => { throw new Error('query must not run without Git capability'); },
  };
  const result = await (await loadInspector({ runner })).inspectCandidate(repo, undefined, options());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'GIT_UNAVAILABLE');
});

test('invalid paths and expired observations never initialize or repair a repository', async t => {
  const f = await createProjectRepositories(t);
  const inspector = await loadInspector();
  const snapshot = await f.snapshotTree(f.directory);
  for (const [path, code] of [['relative', 'INVALID_REQUEST'], [join(f.directory, 'missing'), 'REPOSITORY_NOT_FOUND'],
    [f.directory, 'REPOSITORY_NOT_FOUND']] as const) {
    const result = await inspector.inspectCandidate(path, undefined, options());
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, code);
  }
  const expired = await inspector.inspectCandidate(f.directory, undefined, { deadline: makeDeadline(systemClock, 0) });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.equal(expired.error.code, 'DEADLINE_EXCEEDED');
  assert.deepEqual(await f.snapshotTree(f.directory), snapshot);
});

test('repository configuration cannot silently redirect the reference checkout to a foreign root', async t => {
  const f = await createProjectRepositories(t);
  const repo = await f.createRepository('redirect');
  const foreign = await f.createRepository('foreign-root');
  await f.git(repo, ['config', 'core.worktree', foreign]);
  const result = await (await loadInspector()).inspectCandidate(repo, undefined, options());
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'REPOSITORY_CHANGED');
});
