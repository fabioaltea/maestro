import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { createOperations } from '../../src/core/operations.js';
import { openStorage } from '../../src/storage/worker.js';
import type { ManagedResource } from '../../src/ports/storage.js';

async function until(predicate: () => Promise<boolean>, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!await predicate()) {
    if (performance.now() >= deadline) throw new Error('CONDITION_TIMEOUT');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  test(`${signal} uses persisted stop; SIGHUP survives and control contention never bypasses lease`, async t => {
    const sandbox = await createProcessSandbox(t);
    const h = await createCliHarness(t);
    const paths = (await createPlatformPaths().resolveArchive(h.archive, 'write'))!;
    await createPlatformPaths().createCredential(paths.clientKeyFile);
    const store = await openStorage({ path: paths.stateFile, identity: { storeId: randomUUID(), schemaVersion: 2,
      ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0' } });
    const operations = createOperations(store, paths.ownerUid);
    const requestId = randomUUID(), instanceId = randomUUID();
    await operations.accept({ requestId, action: 'start', targetInstanceId: null, canonicalStateDir: paths.directory });
    const ticket = await operations.issueLaunch(requestId, instanceId);
    const file = join(sandbox.directory, 'intent.json');
    await writeFile(file, JSON.stringify({ ticketId: ticket.ticketId, generation: ticket.generation,
      instanceId, canonicalStateDir: paths.directory }) + '\n', { mode: 0o600 });
    const owner = sandbox.spawnFixture('signal-daemon-owner.js', [file]);
    await sandbox.waitForMessage(owner, 'ready');
    let contention: ReturnType<ReturnType<typeof createOwnershipLease>['tryAcquire']> | undefined;
    try {
      await until(async () => (await store.readSnapshot())?.instance?.lifecycle === 'RUNNING');
      await store.completeOperation(requestId, 'SUCCEEDED', new Date().toISOString(), null);
      owner.send({ type: 'signal', signal: 'SIGHUP' });
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(JSON.parse((await h.call('status')).stdout).data.ready, true);
      contention = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
      assert.equal(contention.status, 'HELD');
      owner.send({ type: 'signal', signal });
      await until(async () => (await store.readSnapshot())?.instance?.lastError?.code === 'BUSY');
      assert.equal((await store.readSnapshot())?.instance?.lifecycle, 'RUNNING');
      if (contention.status === 'HELD') contention.handle.release();
      contention = undefined;
      // Wait for the rejected controller's exit so the signal latch can accept another request.
      await new Promise(resolve => setTimeout(resolve, 100));
      const exited = sandbox.waitForMessage(owner, 'daemon-exited', 5_000);
      owner.send({ type: 'signal', signal });
      await exited;
      await until(async () => {
        const snapshot = await store.readSnapshot();
        return snapshot?.instance?.lifecycle === 'STOPPED' && snapshot.pendingOperation === null;
      });
      const instance = (await store.readSnapshot())?.instance;
      assert.equal(instance?.shutdownPrepared, true);
      assert.equal((await store.readSnapshot())?.pendingOperation, null);
    } finally {
      if (contention?.status === 'HELD') contention.handle.release();
      await store.close();
    }
  });
}

for (const mode of ['gated', 'ack-only'] as const) {
  test(mode === 'gated' ? 'accepted restart completes after its requesting process crashes' : 'uncompleted auxiliary shutdown respects stop bound and preserves live resource', async t => {
    const sandbox = await createProcessSandbox(t);
    const h = await createCliHarness(t);
    assert.equal((await h.call('start')).code, 0);
    const shortStatus = await h.call('status', '--timeout-ms', '1');
    assert.equal(shortStatus.code, 5, shortStatus.stdout);
    assert.equal(JSON.parse((await h.call('status')).stdout).data.ready, true);
    const paths = (await createPlatformPaths().resolveArchive(h.archive, 'read'))!;
    const store = await openStorage({ path: paths.stateFile });
    const instance = (await store.readSnapshot())!.instance!;
    const resourceId = randomUUID(), requestId = randomUUID();
    const endpoint = join(paths.runtimeDirectory, `a-${resourceId}.sock`);
    const credentialRef = join(paths.credentialsDirectory, `a-${resourceId}.key`);
    await createPlatformPaths().createCredential(credentialRef);
    const child = sandbox.spawnFixture('foundation-auxiliary.js', [endpoint, resourceId, credentialRef, mode]);
    await sandbox.waitForMessage(child, 'ready');
    const resource: ManagedResource = { resourceId, owningInstanceId: instance.instanceId, kind: 'auxiliary', policyScope: 'foundation',
      generation: '1', pid: child.pid!, endpoint, credentialRef, observation: 'UNKNOWN', releaseState: 'OWNED' };
    await store.saveResource(resource);
    try {
      if (mode === 'gated') {
        const requester = sandbox.spawnFixture('control-requester.js', [h.archive, requestId]);
        await sandbox.waitForMessage(requester, 'accepted');
        assert.equal((await store.getOperation(requestId))?.outcome, 'IN_PROGRESS');
        assert.equal(await sandbox.requestExit(requester, 'crash'), 86);
        child.send({ type: 'cooperate' });
        await until(async () => (await store.getOperation(requestId))?.outcome === 'SUCCEEDED');
        assert.notEqual((await store.readSnapshot())?.instance?.instanceId, instance.instanceId);
      } else {
        const started = performance.now();
        const response = await h.call('stop', '--request-id', requestId);
        const elapsed = performance.now() - started;
        assert.equal(response.code, 4, response.stdout);
        t.diagnostic(`blocked stop observation: ${elapsed.toFixed(2)} ms; target <=10000 ms`);
        assert.ok(elapsed <= 10_000, `stop observation took ${elapsed}ms`);
        assert.equal(child.exitCode, null);
        assert.equal((await store.readSnapshot())?.instance?.lifecycle, 'BLOCKED');
        assert.equal((await store.readSnapshot())?.instance?.shutdownPrepared, false);
        const result = JSON.parse(response.stdout);
        assert.ok(result.error.nextAction);
        assert.ok(result.data.resourceIssues.some((resource: {resourceId: string}) => resource.resourceId === resourceId));
      }
    } finally {
      await sandbox.requestExit(child, 'shutdown');
      if (mode === 'ack-only') {
        // Retry verifies absence and completes the same authorized stop, with no force.
        const retried = await h.call('stop', '--request-id', requestId);
        assert.equal(retried.code, 0, retried.stdout);
      }
      await store.close();
    }
  });
}
