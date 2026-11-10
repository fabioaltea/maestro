import { SCHEMA_VERSION } from '../../src/storage/schema.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { StoragePort, StoreIdentity, AcceptOperation } from '../../src/ports/storage.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Options { path: string; readonly?: boolean; identity?: StoreIdentity }
const storage = () => loadContract<{ openStorage(options: Options): Promise<StoragePort> }>('storage/worker.js', ['openStorage']);
const requestId = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';
const intent: AcceptOperation = {
  requestId, action: 'start', payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(),
  targetInstanceId: null, acceptedAt: '2026-11-08T12:00:00.000Z',
};
function identity(directory: string): StoreIdentity {
  return { storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: SCHEMA_VERSION,
    ownerUid: process.getuid!(), canonicalPath: directory, revision: '0' };
}

test('readonly missing archive remains absent and rejects mutations', async (t) => {
  const context = await createTestContext(t);
  const path = join(context.directory, 'absent', 'state.sqlite');
  const store = await (await storage()).openStorage({ path, readonly: true });
  try {
    assert.equal(await store.readSnapshot(), null);
    await assert.rejects(store.acceptOperation(intent), /UNAUTHORIZED/);
    await assert.rejects(lstat(join(context.directory, 'absent')), { code: 'ENOENT' });
  } finally { await store.close(); }
});

test('accepted intent is durable before acknowledgment and retry preserves its identity', async (t) => {
  const context = await createTestContext(t);
  const open = (await storage()).openStorage;
  const path = join(context.directory, 'state.sqlite');
  let store = await open({ path, identity: identity(context.directory) });
  assert.equal((await store.acceptOperation(intent)).accepted, true);
  await store.close();
  store = await open({ path, readonly: true });
  assert.equal((await store.getOperation(requestId))?.outcome, 'IN_PROGRESS');
  await store.close();
  store = await open({ path });
  try {
    const revision = (await store.readSnapshot())!.store.revision;
    assert.equal((await store.acceptOperation(intent)).accepted, false);
    assert.equal((await store.readSnapshot())!.store.revision, revision);
    await assert.rejects(store.acceptOperation({ ...intent, payloadHash: 'b'.repeat(64) }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(store.acceptOperation({ ...intent, requestId: 'fbd93dc5-bac0-471f-9a35-2d4a2d5e8242' }), /BUSY/);
    assert.equal((await store.getOperation(requestId))?.payloadHash, intent.payloadHash);
  } finally { await store.close(); }
});

test('ticket claim is atomic and a cancelled generation cannot become an instance', async (t) => {
  const context = await createTestContext(t);
  const open = (await storage()).openStorage;
  const path = join(context.directory, 'state.sqlite');
  const first = await open({ path, identity: identity(context.directory) });
  const second = await open({ path });
  try {
    await first.acceptOperation(intent);
    const cancelled = await first.issueTicket({ ticketId: 'a26be691-4445-41d8-bef6-d522d1e0be48', requestId,
      instanceId: '345caeb6-a3ce-4fd2-8558-fce8486a6bc5', generation: '0' });
    assert.equal(await first.cancelTicket(cancelled.ticketId), true);
    assert.equal(await second.claimTicket(cancelled.ticketId, '0', 102), false);
    const ticket = await first.issueTicket({ ticketId: '2f30be90-bc81-4562-bcda-714f1c50b65a', requestId,
      instanceId: '234ce67a-4316-4b24-bff6-d13a97f47888', generation: '1' });
    const claims = await Promise.all([first.claimTicket(ticket.ticketId, '1', 100), second.claimTicket(ticket.ticketId, '1', 101)]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal((await second.getTicket(ticket.ticketId))?.status, 'CLAIMED');
    assert.equal(await first.cancelTicket(ticket.ticketId), false);
    await assert.rejects(first.issueTicket({ ticketId: '76003b5f-447e-49bb-a749-f19928afc1ee', requestId,
      instanceId: '345caeb6-a3ce-4fd2-8558-fce8486a6bc5', generation: '2' }), /BLOCKED/);
  } finally { await second.close(); await first.close(); }
});

test('incompatible existing state is preserved instead of reset', async (t) => {
  const context = await createTestContext(t);
  const open = (await storage()).openStorage;
  const path = join(context.directory, 'state.sqlite');
  const store = await open({ path, identity: identity(context.directory) });
  await store.close();
  const direct = new Database(path);
  direct.pragma('user_version = 999');
  direct.close();
  const before = await readFile(path);
  await assert.rejects(open({ path }), /STATE_INCOMPATIBLE/);
  assert.deepEqual(await readFile(path), before);
});
