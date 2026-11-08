import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { createCliHarness } from './cli-harness.js';
import { createProcessSandbox } from './process-sandbox.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOperations } from '../../src/core/operations.js';
import { openStorage } from '../../src/storage/worker.js';

export const recoveryPoints = ['control.beforeAccept', 'control.accepted', 'control.ticketIssued', 'control.spawned',
  'control.ready', 'control.completed', 'control.stopRequested', 'control.stopObserved', 'recovery.beforeCleanup', 'recovery.afterCleanup', 'daemon.claimed', 'daemon.recorded', 'daemon.recovering', 'daemon.running'] as const;

export async function recoveryScenario(t: TestContext, point: string, requestedAction?: 'start' | 'stop' | 'restart') {
  const sandbox = await createProcessSandbox(t);
  const h = await createCliHarness(t);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'write'))!;
  let requestId = randomUUID();
  const action = requestedAction ?? (point.includes('stop') ? 'stop' : 'start');
  if (action === 'stop' || action === 'restart') assert.equal((await h.call('start')).code, 0);
  if (point.startsWith('recovery.') || point.startsWith('daemon.')) {
    await createPlatformPaths().createCredential(paths.clientKeyFile);
    const store = await openStorage({ path: paths.stateFile, identity: { storeId: randomUUID(), schemaVersion: 1,
      ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0' } });
    const operations = createOperations(store, paths.ownerUid);
    await operations.accept({ requestId, action: 'start', targetInstanceId: null, canonicalStateDir: paths.directory });
    const ticket = await operations.issueLaunch(requestId, randomUUID());
    await store.close();
    const file = join(h.directory, 'daemon-intent.json');
    await writeFile(file, JSON.stringify({ ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: paths.directory }), { mode: 0o600 });
    const daemon = sandbox.spawnFixture('recovery-actor.js', [file, point.startsWith('daemon.') ? point : 'daemon.running']);
    await sandbox.waitForMessage(daemon, 'paused', 5_000);
    if (point === 'daemon.recovering') {
      const status = JSON.parse((await h.call('status')).stdout);
      assert.equal(status.data.ready, false);
      assert.equal(status.data.lifecycle, 'RECOVERING');
      assert.equal((await h.call('operation', requestId)).code, 3);
    }
    assert.equal(await sandbox.requestExit(daemon, 'crash'), 86);
    if (point.startsWith('daemon.')) return { ...h, paths, requestId, action };
  }
  const file = join(h.directory, 'control-intent.json');
  await writeFile(file, JSON.stringify({ protocolVersion: 1, requestId, action, canonicalStateDir: paths.directory }), { mode: 0o600 });
  const child = sandbox.spawnFixture('recovery-actor.js', [file, point]);
  await sandbox.waitForMessage(child, 'paused', 5_000);
  assert.equal(await sandbox.requestExit(child, 'crash'), 86);
  return { ...h, paths, requestId, action };
}
