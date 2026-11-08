import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { openStorage } from '../../src/storage/worker.js';

test('ten duplicate restarts retain one operation and successor; old process exits before finalization', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const before = JSON.parse((await h.call('status')).stdout);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
  const store = await openStorage({ path: paths.stateFile, readonly: true });
  const id = randomUUID();
  let observing = true, observations = 0;
  const monitor = (async () => {
    while (observing) {
      const op = await store.getOperation(id);
      if (op?.outcome === 'IN_PROGRESS') {
        const lease = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
        if (lease.status === 'HELD') {
          lease.handle.release();
          // The snapshot may predate finalization and lease release.
          assert.notEqual((await store.getOperation(id))?.outcome, 'IN_PROGRESS');
        } else { assert.equal(lease.status, 'BUSY'); observations++; }
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  })();
  try {
    const requests = await Promise.all(Array.from({ length: 10 }, () => h.call('restart', '--request-id', id)));
    requests.forEach(result => assert.ok([0, 3].includes(result.code!), result.stdout));
    assert.ok(requests.some(result => result.code === 0));
    const op = await store.getOperation(id);
    assert.equal(op?.outcome, 'SUCCEEDED');
    assert.equal(op?.targetInstanceId, before.instanceId);
    assert.ok(op?.successorInstanceId);
    assert.notEqual(op.successorInstanceId, before.instanceId);
    const after = JSON.parse((await h.call('status')).stdout);
    assert.equal(after.instanceId, op.successorInstanceId);
    assert.equal(after.data.ready, true);
    assert.equal(await createProcessIdentity().probeAbsent(before.data.pid), 'ABSENT');
    assert.ok(observations > 0);
    const again = await h.call('restart', '--request-id', id);
    assert.equal(again.code, 0, again.stdout);
    assert.equal(JSON.parse((await h.call('status')).stdout).instanceId, after.instanceId);
  } finally { observing = false; await monitor; await store.close(); }
});

test('restart from STOPPED starts once and lost client response can be queried offline', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('stop')).code, 0);
  const id = randomUUID();
  const impatient = await h.call('restart', '--request-id', id, '--timeout-ms', '1');
  assert.equal(impatient.code, 5, impatient.stdout);
  const deadline = performance.now() + 5_000;
  let operation;
  do {
    const result = await h.call('operation', id);
    if (result.code === 0) operation = JSON.parse(result.stdout).data.operation;
    if (operation?.outcome === 'SUCCEEDED') break;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (performance.now() < deadline);
  assert.equal(operation?.outcome, 'SUCCEEDED');
  assert.equal(operation.targetInstanceId, null);
  assert.equal((await h.call('stop')).code, 0);
  const historical = await h.call('operation', id);
  assert.equal(historical.code, 0, historical.stdout);
  assert.equal(JSON.parse(historical.stdout).data.operation.successorInstanceId, operation.successorInstanceId);
});
