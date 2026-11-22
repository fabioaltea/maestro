import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { readRepositoryHistory } from '../../src/platform/macos/git/repository-history.js';
import { createGitRunner } from '../../src/platform/macos/git/runner.js';
import { repositoryReadFixture } from './helpers/repository-read-fixture.js';

test('confined Git observes history and worktrees without changing the repository', async t => {
  const runner = createGitRunner();
  if ((await runner.capabilities()).status !== 'AVAILABLE') return t.skip('Qualified Git is not available');
  const fixture = repositoryReadFixture();
  t.after(fixture.dispose);
  const before = fixture.snapshot();
  const options = { cwd: fixture.root, deadline: makeDeadline(systemClock, 5000) };
  const history = await readRepositoryHistory(runner, options, { kind: 'open' });
  assert.ok('refs' in history);
  assert.ok(history.refs.some(ref => ref.name === 'refs/tags/release' && ref.oid === fixture.main));
  assert.ok(history.worktrees.some(item => item.path === fixture.detached && item.detached && item.oid === fixture.base));
  assert.equal(history.commits.find(item => item.oid === fixture.main)?.parents.length, 2);
  const detail = await readRepositoryHistory(runner, options, { kind: 'commit', roots: history.roots, oid: fixture.main, offset: 0 });
  assert.ok('files' in detail);
  assert.equal(detail.base, fixture.firstParent);
  assert.deepEqual(detail.files, ['topic.txt']);
  assert.deepEqual(fixture.snapshot(), before);
});

test('history pages stay pinned after refs move and add no duplicate nodes', async t => {
  const runner = createGitRunner();
  if ((await runner.capabilities()).status !== 'AVAILABLE') return t.skip('Qualified Git is not available');
  const fixture = repositoryReadFixture();
  t.after(fixture.dispose);
  const tree = fixture.git('rev-parse', `${fixture.main}^{tree}`);
  let head = fixture.main;
  for (let i = 0; i < 100; i++) head = fixture.git('commit-tree', tree, '-p', head, '-m', `Fixture ${i}`);
  fixture.git('update-ref', 'refs/heads/main', head);
  fixture.git('branch', 'another', head);
  fixture.git('branch', 'base', fixture.base);
  fixture.git('branch', 'previous', fixture.main);
  fixture.git('worktree', 'add', '--lock', '--detach', `${fixture.detached}-locked`, fixture.main);
  const elapsed: number[] = [];
  const read = (input: Parameters<typeof readRepositoryHistory>[2]) =>
    readRepositoryHistory(runner, { cwd: fixture.root, deadline: makeDeadline(systemClock, 5000) }, input);
  const before = fixture.snapshot();
  let first: Awaited<ReturnType<typeof readRepositoryHistory>> | undefined;
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    first = await read({ kind: 'open' });
    elapsed.push(performance.now() - start);
  }
  t.diagnostic(`Core first page (ms): ${elapsed.map(ms => Math.round(ms)).join(', ')}`);
  assert.ok(first && 'roots' in first && first.nextOffset === 50 && first.worktrees.some(item => item.locked));
  assert.deepEqual(fixture.snapshot(), before);
  const later = fixture.git('commit-tree', tree, '-p', head, '-m', 'Later');
  fixture.git('update-ref', 'refs/heads/main', later);
  const next = await read({ kind: 'log', roots: first.roots, offset: first.nextOffset });
  assert.ok('commits' in next && next.commits.length === 50);
  assert.equal(new Set([...first.commits, ...next.commits].map(commit => commit.oid)).size, 100);
  await assert.rejects(read({ kind: 'commit', roots: first.roots, oid: later, offset: 0 }), { message: 'INVALID_REQUEST' });
});
