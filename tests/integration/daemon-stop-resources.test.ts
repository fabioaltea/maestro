import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { openStorage } from '../../src/storage/worker.js';
import type { ManagedResource } from '../../src/ports/storage.js';

for (const mode of ['cooperative', 'noncooperative', 'foreign'] as const) {
  test(`Foundation drain ${mode}: release only proven resources; never terminate foreign process`, async t => {
    // Register sandbox cleanup before harness cleanup; always explicitly finish resources below.
    const sandbox = await createProcessSandbox(t);
    const h = await createCliHarness(t);
    assert.equal((await h.call('start')).code, 0);
    const status = JSON.parse((await h.call('status')).stdout);
    const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
    const resourceId = randomUUID();
    const endpoint = join(paths.runtimeDirectory, `a-${resourceId}.sock`);
    const credentialRef = join(paths.credentialsDirectory, `a-${resourceId}.key`);
    await createPlatformPaths().createCredential(credentialRef);
    const child = mode === 'foreign' ? sandbox.spawnFixture('controlled-child.js')
      : sandbox.spawnFixture('foundation-auxiliary.js', [endpoint, resourceId, credentialRef, mode]);
    await sandbox.waitForMessage(child, 'ready');
    const store = await openStorage({ path: paths.stateFile });
    const resource: ManagedResource = { resourceId, owningInstanceId: status.instanceId, kind: 'auxiliary', policyScope: 'foundation',
      generation: '1', pid: child.pid!, endpoint, credentialRef, observation: 'UNKNOWN', releaseState: 'OWNED' };
    const stopId = randomUUID();
    try {
      await store.saveResource(resource);
      const stopped = await h.call('stop', '--request-id', stopId);
      if (mode === 'cooperative') {
        assert.equal(stopped.code, 0, stopped.stdout);
        assert.equal((await store.listResources(status.instanceId))[0]?.releaseState, 'RELEASED');
      } else {
        assert.equal(stopped.code, 4, stopped.stdout);
        assert.equal(child.exitCode, null);
        const result = JSON.parse(stopped.stdout);
        assert.ok(result.error.nextAction);
        assert.equal((await store.getOperation(stopId))?.successorInstanceId, null);
        if (mode === 'noncooperative') {
          const ready = sandbox.waitForMessage(child, 'cooperating'); child.send({ type: 'cooperate' }); await ready;
          const retry = await h.call('stop', '--request-id', stopId);
          assert.equal(retry.code, 0, retry.stdout);
        }
      }
    } finally {
      await sandbox.requestExit(child, 'shutdown');
      await store.saveResource({ ...resource, observation: 'ABSENT', releaseState: 'RELEASED' });
      const op = await store.getOperation(stopId);
      if (op && ['IN_PROGRESS', 'BLOCKED'].includes(op.outcome)) await store.completeOperation(stopId, 'INTERRUPTED', new Date().toISOString(), null);
      await store.close();
    }
  });
}
