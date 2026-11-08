import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { loadContract } from '../fixtures/load-contract.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createOperations } from '../../src/core/operations.js';
import { openStorage } from '../../src/storage/worker.js';

for (const mode of ['cooperative', 'foreign'] as const) {
  test(`orphan recovery ${mode}: authenticate Foundation resources and preserve uncertain identity`, async t => {
    const { recoverAbsentInstance } = await loadContract<{recoverAbsentInstance(context: unknown): Promise<void>}>('core/recovery.js', ['recoverAbsentInstance']);
    const sandbox = await createProcessSandbox(t), h = await createCliHarness(t);
    const platformPaths = createPlatformPaths();
    const paths = (await platformPaths.resolveArchive(h.archive, 'write'))!;
    const store = await openStorage({ path: paths.stateFile, identity: { storeId: randomUUID(), schemaVersion: 1,
      ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0' } });
    const parent = sandbox.spawnFixture('controlled-child.js');
    await sandbox.waitForMessage(parent, 'ready');
    const operations = createOperations(store, paths.ownerUid), requestId = randomUUID(), instanceId = randomUUID();
    await operations.accept({requestId, action: 'start', targetInstanceId: null, canonicalStateDir: paths.directory});
    const ticket = await operations.issueLaunch(requestId, instanceId);
    await operations.claimLaunch(ticket.ticketId, ticket.generation, parent.pid!);
    await store.recordInstance({instanceId, generation: ticket.generation, pid: parent.pid!, lifecycle: 'STARTING', startedAt: new Date().toISOString(), shutdownPrepared: false, lastError: null});
    await store.transitionInstance(instanceId, 'RUNNING');
    await store.completeOperation(requestId, 'SUCCEEDED', new Date().toISOString(), null);
    const resourceId = randomUUID(), endpoint = join(paths.runtimeDirectory, `a-${resourceId}.sock`), credentialRef = join(paths.credentialsDirectory, `a-${resourceId}.key`);
    await createPlatformPaths().createCredential(credentialRef);
    const child = mode === 'cooperative' ? sandbox.spawnFixture('foundation-auxiliary.js', [endpoint, resourceId, credentialRef, mode]) : sandbox.spawnFixture('controlled-child.js');
    await sandbox.waitForMessage(child, 'ready');
    await store.saveResource({resourceId, owningInstanceId: instanceId, kind: 'auxiliary', policyScope: 'foundation', generation: '1', pid: child.pid!, endpoint, credentialRef, observation: 'UNKNOWN', releaseState: 'OWNED'});
    await sandbox.requestExit(parent, 'crash');
    const revision = (await store.readSnapshot())!.store.revision;
    const offline = JSON.parse((await h.call('status')).stdout);
    assert.equal(offline.freshness, 'LAST_KNOWN');
    assert.equal(offline.data.ready, false);
    assert.equal(offline.data.observationError.code, 'DAEMON_ABSENT');
    assert.equal(offline.data.observationError.persisted, false);
    assert.ok(offline.data.resourceIssues.some((r: {resourceId: string}) => r.resourceId === resourceId));
    assert.equal((await store.readSnapshot())!.store.revision, revision);
    const identity = createProcessIdentity();
    let destructiveCalls = 0;
    const context = {store, paths, identity: mode === 'foreign' ? { ...identity, challenge: async () => 'UNKNOWN' } : identity,
      transport: mode === 'foreign' ? { call: async () => { destructiveCalls++; throw new Error('UNEXPECTED_COMMAND'); } } : createLocalTransport(),
      leases: createOwnershipLease(), platformPaths, deadline: makeDeadline(systemClock, 2_000), excludedPids: [process.pid], checkpoint: async () => {}, sleep: (ms: number) => new Promise(resolve => setTimeout(resolve, ms))};
    try {
      if (mode === 'cooperative') {
        await recoverAbsentInstance(context);
        assert.equal((await store.readSnapshot())?.instance?.lifecycle, 'STOPPED');
        assert.equal((await store.listResources(instanceId))[0]?.releaseState, 'RELEASED');
        assert.equal(await identity.probeAbsent(child.pid!), 'ABSENT');
      } else {
        await assert.rejects(recoverAbsentInstance(context), /RESOURCE_IDENTITY_UNKNOWN|BLOCKED/);
        assert.equal(child.exitCode, null);
        assert.equal(destructiveCalls, 0);
        assert.notEqual((await store.readSnapshot())?.instance?.lifecycle, 'STOPPED');
      }
      assert.equal((await store.getOperation(requestId))?.outcome, 'SUCCEEDED');
    } finally { await sandbox.requestExit(child, 'shutdown'); await store.close(); }
  });
}

test('recovery never unlinks a live foreign endpoint or a regular file at a reserved path', async t => {
  const h = await createCliHarness(t), adapter = createPlatformPaths();
  const paths = (await adapter.resolveArchive(h.archive, 'write'))!;
  const server = await createLocalTransport().listen(paths.daemonEndpoint, randomUUID(), new Map(), async request => ({protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: {}}));
  try { await assert.rejects(adapter.inspectStaleSocket(paths.daemonEndpoint), /ENDPOINT_COLLISION/); }
  finally { await server.close(); }
  const {writeFile, readFile} = await import('node:fs/promises');
  await writeFile(paths.daemonEndpoint, 'foreign sentinel', { mode: 0o600 });
  await assert.rejects(adapter.inspectStaleSocket(paths.daemonEndpoint), /ENDPOINT_COLLISION/);
  assert.equal(await readFile(paths.daemonEndpoint, 'utf8'), 'foreign sentinel');
});
