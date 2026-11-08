import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { lstat, readFile, rm } from 'node:fs/promises';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { runControl } from '../../src/core/control-main.js';
import { createTestContext } from '../fixtures/test-context.js';

test('controller contention rejects before creating authoritative state or accepting an intent', async (t) => {
  const context = await createTestContext(t);
  const adapter = createPlatformPaths();
  const archive = (await adapter.resolveArchive(join(context.directory, 'archive'), 'write'))!;
  t.after(async () => {
    const marker = JSON.parse(await readFile(join(archive.runtimeDirectory, 'archive.json'), 'utf8')) as {directory: string};
    assert.equal(marker.directory, archive.directory);
    await rm(archive.runtimeDirectory, { recursive: true });
  });
  const lease = createOwnershipLease().tryAcquire(archive.controlLeaseFile, 'control');
  assert.equal(lease.status, 'HELD');
  if (lease.status !== 'HELD') return;
  try {
    assert.equal(await runControl({ protocolVersion: 1, requestId: randomUUID(), action: 'start', canonicalStateDir: archive.directory }), 3);
    await assert.rejects(lstat(archive.stateFile), { code: 'ENOENT' });
  } finally { lease.handle.release(); }
});
