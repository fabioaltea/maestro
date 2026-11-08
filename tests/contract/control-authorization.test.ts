import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadContract } from '../fixtures/load-contract.js';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import type { InstanceRecord, OperationRecord } from '../../src/ports/storage.js';

interface Authorization {
  authorizePrepareStop(input: { role: string; currentCredential: boolean; controlLeaseHeld: boolean; instance: InstanceRecord; operation: OperationRecord | null; params: Readonly<Record<string, unknown>> }): void;
}
test('stop authority is scoped to role, current credential, action, target and generation', async () => {
  const { authorizePrepareStop } = await loadContract<Authorization>('core/operations.js', ['authorizePrepareStop']);
  const instance: InstanceRecord = { instanceId: randomUUID(), pid: 123, generation: '2', lifecycle: 'RUNNING', startedAt: '', shutdownPrepared: false, lastError: null };
  const operation: OperationRecord = { requestId: randomUUID(), action: 'stop', targetInstanceId: instance.instanceId, successorInstanceId: null, phase: 'STOP_REQUESTED', outcome: 'IN_PROGRESS', payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(), acceptedAt: '', completedAt: null, error: null };
  const input = { role: 'controller', currentCredential: true, controlLeaseHeld: true, instance, operation,
    params: { requestId: operation.requestId, targetInstanceId: instance.instanceId, generation: '2' } };
  assert.doesNotThrow(() => authorizePrepareStop(input));
  for (const change of [ { role: 'client' }, { currentCredential: false }, { controlLeaseHeld: false },
    { operation: { ...operation, action: 'start' as const } }, { operation: { ...operation, outcome: 'SUCCEEDED' as const } },
    { params: { ...input.params, generation: '1' } }, { params: { ...input.params, targetInstanceId: randomUUID() } },
    { params: { ...input.params, requestId: randomUUID() } } ]) {
    assert.throws(() => authorizePrepareStop({ ...input, ...change }), /UNAUTHORIZED|STALE_TARGET/);
  }
});

test('public client capability cannot stop a daemon and conflicting idempotency has zero mutation', async t => {
  const h = await createCliHarness(t);
  const id = randomUUID();
  assert.equal((await h.call('start', '--request-id', id)).code, 0);
  const before = JSON.parse((await h.call('status')).stdout);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
  const key = await createPlatformPaths().readCredential(paths.clientKeyFile);
  const denied = await createLocalTransport().call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'internal.prepareStop', params: { requestId: id, targetInstanceId: before.instanceId, generation: '1' } }, 1_000);
  assert.equal(denied.result, 'ERROR');
  assert.equal((denied.data as {code: string}).code, 'UNAUTHORIZED');
  const conflict = await h.call('stop', '--request-id', id);
  assert.equal(conflict.code, 2, conflict.stdout);
  const after = JSON.parse((await h.call('status')).stdout);
  assert.equal(after.instanceId, before.instanceId);
  assert.equal(after.data.revision, before.data.revision);
  assert.equal(after.data.ready, true);
});
