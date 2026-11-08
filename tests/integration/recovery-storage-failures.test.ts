import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { openStorage } from '../../src/storage/worker.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { SafeError } from '../../src/domain/errors.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Classification { classifyStorageFailure(error: unknown): SafeError & {cause: string | null} }
test('disk-full/read-only/driver failures are classified without exposing raw causes or inventing persistence', async () => {
  const { classifyStorageFailure } = await loadContract<Classification>('storage/worker.js', ['classifyStorageFailure']);
  for (const [code, cause] of [['SQLITE_FULL', 'DISK_FULL'], ['ENOSPC', 'DISK_FULL'], ['SQLITE_READONLY', 'READ_ONLY'], ['SQLITE_IOERR_WRITE', 'IO_ERROR']]) {
    const result = classifyStorageFailure(Object.assign(new Error('sentinel-secret /private/user/path'), { code }));
    assert.equal(result.code, 'PERSISTENCE_UNAVAILABLE');
    assert.equal(result.cause, cause);
    assert.equal(result.persisted, false);
    assert.doesNotMatch(JSON.stringify(result), /sentinel-secret|private\/user/);
  }
});

for (const damage of ['corrupt', 'incompatible'] as const) {
  test(`${damage} archive remains byte-identical after refused recovery`, async t => {
    const context = await createTestContext(t), path = join(context.directory, 'state.sqlite');
    const store = await openStorage({ path, identity: { storeId: randomUUID(), schemaVersion: 1, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } });
    await store.close();
    if (damage === 'corrupt') await writeFile(path, Buffer.alloc(4096, 0x61));
    else { const db = new Database(path); db.pragma('user_version=999'); db.close(); }
    const before = await readFile(path);
    await assert.rejects(openStorage({ path }), new RegExp(damage === 'corrupt' ? 'STATE_CORRUPT' : 'STATE_INCOMPATIBLE'));
    assert.deepEqual(await readFile(path), before);
  });
}

test('native write rejection rolls back the intent and preserves confirmed outcomes; read-only cannot mutate', async t => {
  const context = await createTestContext(t), path = join(context.directory, 'state.sqlite');
  const store = await openStorage({ path, identity: { storeId: randomUUID(), schemaVersion: 1, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } });
  const intent = { requestId: randomUUID(), action: 'start' as const, targetInstanceId: null, payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(), acceptedAt: new Date().toISOString() };
  try {
    await store.acceptOperation(intent);
    await store.completeOperation(intent.requestId, 'SUCCEEDED', new Date().toISOString(), null);
    const confirmed = await store.getOperation(intent.requestId), revision = (await store.readSnapshot())!.store.revision;
    const db = new Database(path);
    db.exec("CREATE TRIGGER reject_write BEFORE INSERT ON operations BEGIN SELECT RAISE(ABORT, 'test write unavailable'); END");
    db.close();
    const next = randomUUID();
    await assert.rejects(store.acceptOperation({ ...intent, requestId: next }), /PERSISTENCE_UNAVAILABLE/);
    assert.equal(await store.getOperation(next), null);
    assert.equal((await store.readSnapshot())!.store.revision, revision);
    assert.deepEqual(await store.getOperation(intent.requestId), confirmed);
    const readonly = await openStorage({ path, readonly: true });
    try { await assert.rejects(readonly.completeOperation(intent.requestId, 'FAILED', '', null), /UNAUTHORIZED/); }
    finally { await readonly.close(); }
  } finally { await store.close(); }
});

test('storage worker loss rejects pending/future calls and does not release main ownership lease', async t => {
  const context = await createTestContext(t), path = join(context.directory, 'state.sqlite');
  let worker: Worker | undefined;
  const open = openStorage as unknown as (options: Parameters<typeof openStorage>[0], host: {observeWorker(worker: Worker): void}) => Promise<StoragePort & {onFailure(callback: (error: SafeError) => void): () => void}>;
  const store = await open({ path, identity: { storeId: randomUUID(), schemaVersion: 1, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } }, { observeWorker: value => { worker = value; } });
  const lease = createOwnershipLease().tryAcquire(join(context.directory, 'daemon-lease.sqlite'), 'daemon');
  assert.equal(lease.status, 'HELD');
  try {
    assert.ok(worker, 'worker host must allow observation of the actual owned thread');
    const failure = new Promise<SafeError>(resolve => store.onFailure(resolve));
    await worker.terminate();
    assert.equal((await failure).persisted, false);
    await assert.rejects(store.readSnapshot(), /PERSISTENCE_UNAVAILABLE/);
    assert.equal(createOwnershipLease().tryAcquire(join(context.directory, 'daemon-lease.sqlite'), 'daemon').status, 'BUSY');
  } finally { await store.close(); if (lease.status === 'HELD') lease.handle.release(); }
});
