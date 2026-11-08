import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { openStorage } from '../../src/storage/worker.js';
import { createOperations } from '../../src/core/operations.js';
import type { OperationRecord, InstanceRecord } from '../../src/ports/storage.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Admission { controlDisposition(operation: OperationRecord, current: InstanceRecord | null): 'EXECUTE' | 'RETRY' | 'HISTORICAL' }
test('BLOCKED retries revalidate the original target; terminal results stay historical', async t => {
  const { controlDisposition } = await loadContract<Admission>('core/operations.js', ['controlDisposition']);
  const ctx = await createTestContext(t);
  const store = await openStorage({ path: join(ctx.directory, 'state.sqlite'), identity: {
    storeId: randomUUID(), schemaVersion: 1, ownerUid: process.getuid!(), canonicalPath: ctx.directory, revision: '0',
  } });
  try {
    const ops = createOperations(store, process.getuid!());
    const { operation } = await ops.accept({ requestId: randomUUID(), action: 'restart', targetInstanceId: null, canonicalStateDir: ctx.directory });
    assert.equal(controlDisposition(operation, null), 'EXECUTE'); // restart from an empty/stopped archive
    const blocked = { ...operation, outcome: 'BLOCKED' as const };
    assert.equal(controlDisposition(blocked, null), 'RETRY');
    await store.completeOperation(operation.requestId, 'BLOCKED', new Date().toISOString(), null);
    const revision = (await store.readSnapshot())!.store.revision;
    await assert.rejects(store.resumeBlocked(operation.requestId, randomUUID()), /STALE_TARGET/);
    assert.equal((await store.readSnapshot())!.store.revision, revision);
    assert.equal((await store.resumeBlocked(operation.requestId, null)).outcome, 'IN_PROGRESS');
    await store.completeOperation(operation.requestId, 'SUCCEEDED', new Date().toISOString(), null);
    await assert.rejects(store.resumeBlocked(operation.requestId, null), /STALE_TARGET/);
    const successor: InstanceRecord = { instanceId: randomUUID(), pid: 123, generation: '1', lifecycle: 'RUNNING', startedAt: '', shutdownPrepared: false, lastError: null };
    assert.throws(() => controlDisposition(blocked, successor), /STALE_TARGET/);
    assert.equal(controlDisposition({ ...blocked, outcome: 'SUCCEEDED' }, successor), 'HISTORICAL');
    assert.equal(controlDisposition({ ...blocked, outcome: 'FAILED' }, successor), 'HISTORICAL');
  } finally { await store.close(); }
});

test('shutdownPrepared is a drain completion marker, not an intention to stop', async t => {
  const ctx = await createTestContext(t);
  const store = await openStorage({ path: join(ctx.directory, 'state.sqlite'), identity: {
    storeId: randomUUID(), schemaVersion: 1, ownerUid: process.getuid!(), canonicalPath: ctx.directory, revision: '0',
  } });
  try {
    const ops = createOperations(store, process.getuid!());
    const id = randomUUID(), instanceId = randomUUID();
    await ops.accept({ requestId: id, action: 'start', targetInstanceId: null, canonicalStateDir: ctx.directory });
    const ticket = await ops.issueLaunch(id, instanceId);
    await ops.claimLaunch(ticket.ticketId, '1', 123);
    await store.recordInstance({ instanceId, pid: 123, generation: '1', lifecycle: 'STARTING', startedAt: new Date().toISOString(), shutdownPrepared: false, lastError: null });
    await store.transitionInstance(instanceId, 'RUNNING');
    await store.transitionInstance(instanceId, 'STOPPING');
    assert.equal((await store.readSnapshot())?.instance?.shutdownPrepared, false);
    await assert.rejects(store.transitionInstance(instanceId, 'STOPPED'), /BLOCKED/);
  } finally { await store.close(); }
});

test('status client enforces its observation deadline even when backend does not return', async () => {
  const client = new LocalClient({ defaultDirectory: '/unused', operation: () => new Promise(() => {}), inspect: () => new Promise(() => {}), control: () => new Promise(() => {}) });
  const result = await Promise.race([client.run('status', { timeoutMs: 15 }), new Promise<null>(resolve => setTimeout(() => resolve(null), 100))]);
  assert.equal(result?.error?.code, 'DEADLINE_EXCEEDED');
});

test('client expiry preserves the request identity and does not cancel accepted work', async () => {
  let finish!: () => void;
  let calls = 0, completed = false;
  const id = randomUUID();
  const client = new LocalClient({ defaultDirectory: '/unused', inspect: () => new Promise(() => {}), operation: () => new Promise(() => {}),
    control: async intent => {
      calls++;
      assert.equal(intent.requestId, id);
      await new Promise<void>(resolve => { finish = resolve; });
      completed = true;
      return { protocolVersion: 1, requestId: id, storeId: null, instanceId: null, result: 'OK', outcome: 'SUCCEEDED', freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {}, error: null };
    },
  });
  const result = await client.run('restart', { requestId: id, timeoutMs: 10 });
  assert.equal(result.result, 'UNKNOWN_OUTCOME');
  assert.equal(result.requestId, id);
  assert.equal(completed, false);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, true);
  assert.equal(calls, 1);
  await assert.rejects(client.run('status', { timeoutMs: 2_001 }), /INVALID_REQUEST/);
  await assert.rejects(client.run('stop', { timeoutMs: 10_001 }), /INVALID_REQUEST/);
  await assert.rejects(client.run('restart', { timeoutMs: 30_001 }), /INVALID_REQUEST/);
});
