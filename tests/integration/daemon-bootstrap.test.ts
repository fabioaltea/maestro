import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { openStorage } from '../../src/storage/worker.js';
import { createOperations } from '../../src/core/operations.js';
import { runDaemon } from '../../src/core/daemon-main.js';
import { createTestContext } from '../fixtures/test-context.js';

test('a cancelled delayed candidate cannot register an instance or expose readiness', async (t) => {
  const context = await createTestContext(t);
  const adapter = createPlatformPaths();
  const archive = (await adapter.resolveArchive(join(context.directory, 'archive'), 'write'))!;
  t.after(async () => {
    await adapter.validateOwnerAndLinks(archive.runtimeDirectory, 'directory');
    await rm(archive.runtimeDirectory, { recursive: true });
  });
  const store = await openStorage({ path: archive.stateFile, identity: { storeId: randomUUID(), schemaVersion: 1,
    ownerUid: archive.ownerUid, canonicalPath: archive.directory, revision: '0' } });
  const operations = createOperations(store, archive.ownerUid);
  const requestId = randomUUID();
  let ticket;
  try {
    await operations.accept({ requestId, action: 'start', targetInstanceId: null, canonicalStateDir: archive.directory });
    ticket = await operations.issueLaunch(requestId, randomUUID());
    await store.cancelTicket(ticket.ticketId);
  } finally { await store.close(); }
  await assert.rejects(runDaemon({ ticketId: ticket.ticketId, generation: ticket.generation,
    instanceId: ticket.instanceId, canonicalStateDir: archive.directory }), /STALE_TARGET/);
  await assert.rejects(lstat(archive.daemonEndpoint), { code: 'ENOENT' });
  const inspected = await openStorage({ path: archive.stateFile, readonly: true });
  try { assert.equal((await inspected.readSnapshot())!.instance, null); }
  finally { await inspected.close(); }
  const lease = createOwnershipLease().tryAcquire(archive.daemonLeaseFile, 'daemon');
  assert.equal(lease.status, 'HELD');
  if (lease.status === 'HELD') lease.handle.release();
});
