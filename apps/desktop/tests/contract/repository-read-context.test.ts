import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RepositoryReadContext } from '../../src/main/repository-read-context.ts';

test('repository snapshots are scoped by selection, view and deadline', () => {
  let now = 0;
  const context = new RepositoryReadContext(() => now);
  const selection = { selectionEpoch: 1, activeProjectId: 'project' };
  const handle = context.open(selection, 'history', { configRevision: '1', roots: ['test'] });
  assert.deepEqual(context.read(selection, 'history', handle).roots, ['test']);
  assert.throws(() => context.read(selection, 'code', handle), { message: 'STALE_CONTEXT' });
  assert.throws(() => context.read({ ...selection, selectionEpoch: 2 }, 'history', handle), { message: 'STALE_CONTEXT' });
  now += 60 * 60 * 1000;
  assert.throws(() => context.read(selection, 'history', handle), { message: 'STALE_CONTEXT' });
});

test('reopening replaces the snapshot and clearing invalidates outstanding reads', () => {
  const context = new RepositoryReadContext();
  const selection = { selectionEpoch: 1, activeProjectId: 'project' };
  const first = context.open(selection, 'code', { configRevision: '1', roots: ['old'] });
  const cursor = context.issue(first, 'tree:src', 100)!;
  assert.equal(context.offset(first, 'tree:src', cursor), 100);
  assert.throws(() => context.offset(first, 'tree:test', cursor), { message: 'STALE_CONTEXT' });
  const second = context.open(selection, 'code', { configRevision: '1', roots: ['new'] });
  assert.throws(() => context.read(selection, 'code', first), { message: 'STALE_CONTEXT' });
  assert.throws(() => context.offset(second, 'tree:src', cursor), { message: 'STALE_CONTEXT' });
  assert.deepEqual(context.read(selection, 'code', second).roots, ['new']);
  context.clear();
  assert.throws(() => context.read(selection, 'code', second), { message: 'STALE_CONTEXT' });
});
