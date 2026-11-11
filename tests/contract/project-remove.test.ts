import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { decodeProjectOperationView, validateProjectParams } from '../../src/protocol/validation.js';

const detail = (projectId: string) => ({ projectId, expectedRevision: '1' });

test('remove requires ID/revision only and CLI offers no force, cleanup or filesystem authority', async t => {
  const a = await createProjectHarness(t), id = randomUUID(), requestId = randomUUID();
  for (const params of [{ projectId: id }, { expectedRevision: '1' }, { projectId: id, expectedRevision: 1 },
    { ...detail(id), force: true }, { ...detail(id), path: '/must-not-inspect' }, { ...detail(id), cleanup: true }]) {
    assert.throws(() => validateProjectParams('projects.remove', { ...params, requestId }));
  }
  for (const flags of [[], ['--expected-revision', '0'], ['--expected-revision', '1', '--force'], ['--expected-revision', '1', '--cleanup'],
    ['--expected-revision', '1', '--name', 'not-allowed']]) {
    const invalid = await invokeCli(['project', 'remove', id, ...flags, '--state-dir', a.h.archive, '--json']);
    assert.equal(invalid.code, 2, invalid.stdout);
  }
  const added = await a.register(await a.f.createRepository('remove-contract'));
  const removed = await invokeCli(['project', 'remove', added.projectId!, '--expected-revision', '1', '--request-id', requestId, '--state-dir', a.h.archive, '--json']);
  assert.equal(removed.code, 0, removed.stdout);
  const result = JSON.parse(removed.stdout); assert.equal(result.data.effect, 'REMOVED'); assert.equal(result.data.configRevision, '2');
  assert.equal(result.requestId, requestId); assert.equal(result.data.accepted, true);
  const query = await a.other.runProject('get', { projectId: added.projectId }, { stateDirectory: a.h.archive });
  assert.equal(query.error?.code, 'PROJECT_REMOVED');
  assert.deepEqual(query.data.tombstone, { projectId: added.projectId, configRevision: '2', removedAt: result.data.completedAt });
  assert.doesNotMatch(JSON.stringify(query), /"(?:repositoryIdentity|birthtimeNs|canonicalIntent)"\s*:/);
});

test('removed outcomes and tombstone are durable across reimport, offline query and identical retry', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('remove-retry'), first = await a.register(repo);
  const requestId = randomUUID(), params = detail(first.projectId!);
  const removed = await a.client.runProject('remove', params, { stateDirectory: a.h.archive, requestId });
  assert.equal(removed.outcome, 'SUCCEEDED', JSON.stringify(removed));
  const original = decodeProjectOperationView(removed.data.operation).result;
  const next = await a.register(repo); assert.notEqual(next.projectId, first.projectId);
  const retry = await a.other.runProject('remove', params, { stateDirectory: a.h.archive, requestId });
  assert.deepEqual(decodeProjectOperationView(retry.data.operation).result, original);
  assert.equal((await a.get(next.projectId!)).projectId, next.projectId);
  const conflict = await a.client.runProject('remove', { ...params, projectId: next.projectId }, { stateDirectory: a.h.archive, requestId });
  assert.equal(conflict.error?.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(conflict.data.accepted, false);
  assert.equal((await a.h.call('stop')).code, 0);
  const saved = await a.other.runProject('operation', { requestId }, { stateDirectory: a.h.archive });
  assert.equal(saved.freshness, 'LAST_KNOWN'); assert.deepEqual(decodeProjectOperationView(saved.data.operation).result, original);
  const tombstone = await a.client.runProject('get', { projectId: first.projectId }, { stateDirectory: a.h.archive });
  assert.equal(tombstone.error?.code, 'PROJECT_REMOVED'); assert.equal(tombstone.freshness, 'LAST_KNOWN');
  assert.equal((tombstone.data.tombstone as { configRevision: string }).configRevision, '2');
});
