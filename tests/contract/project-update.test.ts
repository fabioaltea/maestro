import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { decodeProjectOperationView, validateProjectParams } from '../../src/protocol/validation.js';

test('update requires a nonempty closed patch and exact revision; CLI base/clear flags are exclusive', async t => {
  const id = randomUUID(), requestId = randomUUID();
  for (const params of [ { projectId: id, patch: { name: 'valid' } },
    { projectId: id, expectedRevision: '1', patch: {} }, { projectId: id, expectedRevision: 1, patch: { name: 'valid' } },
    { projectId: id, expectedRevision: '1', patch: { baseBranch: '' } }, { projectId: id, expectedRevision: '1', patch: { name: 'valid', force: true } },
    { projectId: id, expectedRevision: '1', patch: { name: 'valid' }, ownerUid: 0 } ]) {
    assert.throws(() => validateProjectParams('projects.update', { ...params, requestId }));
  }
  const a = await createProjectHarness(t), project = await a.register(await a.f.createRepository('update-contract'));
  for (const flags of [[], ['--name', 'X'], ['--expected-revision', '1'], ['--expected-revision', '1', '--base-branch', 'fixture-base', '--clear-base-branch'],
    ['--expected-revision', '1', '--name', 'X', '--force']]) {
    const invalid = await invokeCli(['project', 'update', project.projectId!, ...flags, '--state-dir', a.h.archive, '--json']);
    assert.equal(invalid.code, 2, invalid.stdout);
  }
  const changed = await invokeCli(['project', 'update', project.projectId!, '--expected-revision', '1', '--name', ' Renamed 🎼 ',
    '--request-id', requestId, '--state-dir', a.h.archive, '--json']);
  assert.equal(changed.code, 0, changed.stdout);
  const result = JSON.parse(changed.stdout);
  assert.equal(result.data.effect, 'UPDATED'); assert.equal(result.data.configRevision, '2'); assert.equal(result.requestId, requestId);
  const query = await a.other.runProject('operation', { requestId }, { stateDirectory: a.h.archive });
  assert.deepEqual(decodeProjectOperationView(query.data.operation).result, result.data.operation.result);
  assert.equal((await a.get(project.projectId!)).baseBranch, 'fixture-base');
  const clear = await a.other.runProject('update', { projectId: project.projectId, expectedRevision: '2', patch: { baseBranch: null } }, { stateDirectory: a.h.archive });
  assert.equal(clear.outcome, 'SUCCEEDED', JSON.stringify(clear)); assert.equal((await a.get(project.projectId!)).baseBranch, null);
});

test('identical update retry returns its original snapshot before checking current revision or repository', async t => {
  const a = await createProjectHarness(t), project = await a.register(await a.f.createRepository('retry-update'));
  const requestId = randomUUID(), params = { projectId: project.projectId, expectedRevision: '1', patch: { name: 'First' } };
  const first = await a.client.runProject('update', params, { stateDirectory: a.h.archive, requestId });
  assert.equal(first.outcome, 'SUCCEEDED', JSON.stringify(first));
  await a.other.runProject('update', { projectId: project.projectId, expectedRevision: '2', patch: { name: 'Second' } }, { stateDirectory: a.h.archive });
  const retry = await a.other.runProject('update', params, { stateDirectory: a.h.archive, requestId });
  assert.deepEqual(decodeProjectOperationView(retry.data.operation).result, decodeProjectOperationView(first.data.operation).result);
  assert.equal((await a.get(project.projectId!)).displayName, 'Second');
  const conflict = await a.client.runProject('update', { ...params, patch: { name: 'Different' } }, { stateDirectory: a.h.archive, requestId });
  assert.equal(conflict.error?.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(conflict.data.accepted, false);
  assert.ok(conflict.error.nextAction); assert.doesNotMatch(JSON.stringify(conflict), /canonicalIntent|payloadHash|birthtimeNs/);
});
