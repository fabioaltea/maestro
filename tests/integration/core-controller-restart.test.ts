import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDaemonLauncher } from '../../src/platform/macos/launcher.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { openStorage } from '../../src/storage/worker.js';
import { createCliHarness } from '../fixtures/cli-harness.js';

test('core controller restarts with one durable target/successor while client is detached', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const before = JSON.parse((await h.call('status')).stdout);
  const id = randomUUID();
  const launcher = createDaemonLauncher();
  const controller = await launcher.spawnController({ protocolVersion: 1, requestId: id, action: 'restart', canonicalStateDir: h.archive });
  assert.equal((await controller.exit).code, 0);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  try {
    const op = await store.getOperation(id);
    assert.equal(op?.outcome, 'SUCCEEDED');
    assert.equal(op?.targetInstanceId, before.instanceId);
    const after = (await store.readSnapshot())?.instance;
    assert.equal(op?.successorInstanceId, after?.instanceId);
    assert.notEqual(after?.instanceId, before.instanceId);
    assert.equal(after?.lifecycle, 'RUNNING');
    assert.equal(await createProcessIdentity().probeAbsent(before.data.pid), 'ABSENT');
    // The same historical restart cannot stop its successor.
    const replay = await launcher.spawnController({ protocolVersion: 1, requestId: id, action: 'restart', canonicalStateDir: h.archive });
    assert.equal((await replay.exit).code, 0);
    assert.equal((await store.readSnapshot())?.instance?.instanceId, after?.instanceId);
  } finally { await store.close(); }
});
