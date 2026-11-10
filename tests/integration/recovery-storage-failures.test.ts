import { SCHEMA_VERSION } from '../../src/storage/schema.js';
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
    const store = await openStorage({ path, identity: { storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } });
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
  const store = await openStorage({ path, identity: { storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } });
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
  const store = await open({ path, identity: { storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0' } }, { observeWorker: value => { worker = value; } });
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

for (const role of ['daemon', 'controller'] as const) {
  test(`${role} worker dies: lease survives or unconfirmed controller result remains queryable`, async t => {
    const { createProcessSandbox } = await import('../fixtures/process-sandbox.js');
    const { createCliHarness } = await import('../fixtures/cli-harness.js');
    const { createPlatformPaths } = await import('../../src/platform/macos/paths.js');
    const { createOperations } = await import('../../src/core/operations.js');
    const sandbox = await createProcessSandbox(t), h = await createCliHarness(t);
    const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'write'))!;
    const requestId = randomUUID();
    let intent: unknown = {protocolVersion: 1, requestId, action: 'start', canonicalStateDir: paths.directory};
    if (role === 'daemon') {
      await adapter.createCredential(paths.clientKeyFile);
      const seed = await openStorage({path: paths.stateFile, identity: {storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0'}});
      try {
        const operations = createOperations(seed, paths.ownerUid);
        await operations.accept({requestId, action: 'start', targetInstanceId: null, canonicalStateDir: paths.directory});
        const ticket = await operations.issueLaunch(requestId, randomUUID());
        intent = {ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: paths.directory};
      } finally { await seed.close(); }
    }
    const file = join(h.directory, 'worker-failure-intent.json');
    await writeFile(file, JSON.stringify(intent), {mode: 0o600});
    const actor = sandbox.spawnFixture('recovery-actor.js', [file, role === 'daemon' ? 'daemon.running' : 'control.ready']);
    await sandbox.waitForMessage(actor, 'paused', 5_000);
    const store = await openStorage({path: paths.stateFile, readonly: true});
    try {
      const instance = (await store.readSnapshot())!.instance!;
      const failed = sandbox.waitForMessage(actor, 'worker-exited');
      actor.send({type: 'worker-exit'}); await failed;
      if (role === 'daemon') {
        const status = JSON.parse((await h.call('status')).stdout);
        assert.equal(status.freshness, 'VOLATILE');
        assert.equal(status.data.ready, false);
        assert.equal(status.data.lastError.persisted, false);
        assert.equal(status.data.lastError.cause, 'WORKER_EXIT');
        assert.equal(createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon').status, 'BUSY');
        assert.equal((await h.call('start')).code, 4);
        assert.equal(actor.exitCode, null);
      } else {
        const exit = new Promise<{code: number | null; signal: string | null}>(resolve => actor.once('exit', (code, signal) => resolve({code, signal})));
        const { createClientBackend } = await import('../../src/bootstrap.js');
        const backend = createClientBackend({spawnController: async () => ({pid: actor.pid!, exit, bootstrap: Promise.resolve({accepted: true})}), spawnDaemon: async () => { throw new Error('UNEXPECTED_SPAWN'); }});
        const observation = backend.control({protocolVersion: 1, requestId, action: 'start', canonicalStateDir: paths.directory}, 3_000);
        actor.send({type: 'continue'});
        assert.equal((await exit).code, 7);
        const result = await observation;
        assert.equal(result.result, 'UNKNOWN_OUTCOME');
        assert.equal(result.error?.code, 'CONTROL_INTERRUPTED');
        assert.equal(result.error?.persisted, false);
        assert.equal((await store.getOperation(requestId))?.outcome, 'IN_PROGRESS');
        const retried = await h.call('start', '--request-id', requestId);
        assert.equal(retried.code, 0, retried.stdout);
        assert.equal(JSON.parse(retried.stdout).instanceId, instance.instanceId);
      }
    } finally {
      if (actor.exitCode === null && actor.signalCode === null) await sandbox.requestExit(actor, 'crash');
      await store.close();
    }
  });
}

test('a copied store at another canonical path is refused before any recovery mutation', async t => {
  const context = await createTestContext(t), path = join(context.directory, 'state.sqlite');
  const store = await openStorage({path, identity: {storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0'}});
  await store.close();
  const {mkdir} = await import('node:fs/promises');
  const other = join(context.directory, 'other');
  await mkdir(other, {mode: 0o700});
  const bytes = await readFile(path), copied = join(other, 'state.sqlite');
  await writeFile(copied, bytes, {mode: 0o600});
  await assert.rejects(openStorage({path: copied}), /UNAUTHORIZED/);
  assert.deepEqual(await readFile(copied), bytes);
  assert.deepEqual(await readFile(path), bytes);
});
