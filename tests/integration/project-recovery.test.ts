import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { openStorage } from '../../src/storage/worker.js';
import { canonicalProjectIntent } from '../../src/domain/projects/intent.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { drainProjectOperations } from '../../src/core/lifecycle.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { inspectProjectOperation } from '../../src/core/inspect-main.js';
import { createClientBackend } from '../../src/bootstrap.js';
import { LocalClient } from '../../src/client/local-client.js';

test('daemon startup interrupts an abandoned durable registry intent before RUNNING without a Git probe', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  assert.equal((await h.call('stop')).code, 0);
  const path = join(h.archive, 'state.sqlite');
  const store = await openStorage({ path });
  const before = (await store.readSnapshot())!;
  const requestId = randomUUID();
  const canonicalIntent = canonicalProjectIntent(before.store.storeId, 'REGISTER', { path: '/not-present/never-created' });
  await store.acceptProjectOperation({ requestId, action: 'REGISTER', canonicalIntent,
    payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), projectId: null, expectedConfigRevision: null,
    owningInstanceId: before.instance!.instanceId, ownerUid: process.getuid!(), acceptedAt: '2026-11-10T12:00:00.000Z',
    deadlineAt: '2026-11-10T12:00:28.000Z' });
  await store.close();
  const started = await h.call('start');
  assert.equal(started.code, 0, started.stdout);
  const platform = createPlatformPaths();
  const paths = (await platform.resolveArchive(h.archive, 'read'))!;
  const live = await createLocalTransport().call(paths.daemonEndpoint, await platform.readCredential(paths.clientKeyFile), {
    protocolVersion: 1, correlationId: randomUUID(), method: 'projects.operation.get', params: { requestId },
  }, 1_000);
  assert.equal((live.data as { operation: { outcome: string } }).operation.outcome, 'INTERRUPTED');
  assert.doesNotMatch(JSON.stringify(live), /canonicalIntent|payloadHash|never-created/);
  const status = JSON.parse((await h.call('status')).stdout);
  assert.equal(status.data.capabilities.projectRegistryVersion, 1);
  assert.deepEqual(status.data.capabilities.projectRegistryMethods, ['projects.operation.get', 'projects.register', 'projects.get', 'projects.list', 'projects.verify', 'projects.update', 'projects.remove']);
  assert.equal(status.data.capabilities.gitInspection.version, 1);
  const client = new LocalClient(createClientBackend());
  const observed = await client.runProject('operation', { requestId }, { stateDirectory: h.archive });
  assert.equal(observed.freshness, 'LIVE'); assert.equal(observed.outcome, 'INTERRUPTED');
  const missingProject = await client.runProject('remove', { projectId: randomUUID(), expectedRevision: '1' }, { stateDirectory: h.archive });
  assert.equal(missingProject.error?.code, 'PROJECT_NOT_FOUND');
  const reader = await openStorage({ path, readonly: true });
  try {
    const current = (await reader.readSnapshot())!;
    assert.equal(current.instance?.lifecycle, 'RUNNING');
    const interrupted = await reader.getProjectOperation(requestId);
    assert.equal(interrupted?.outcome, 'INTERRUPTED');
    assert.equal(interrupted?.result?.error?.nextAction, 'read-project-then-new-request');
    assert.equal(interrupted?.canonicalIntent, canonicalIntent);
    assert.equal((await reader.listResources(current.instance!.instanceId)).length, 0);
    const event = (await reader.listEvents({ limit: 100 })).records.find(event => event.operationId === requestId && event.payload.outcome === 'INTERRUPTED');
    assert.equal(event?.instanceId, current.instance?.instanceId);
    assert.equal((await reader.listPendingProjectOperations()).length, 0);
  } finally { await reader.close(); }
  assert.equal((await h.call('stop')).code, 0);
  const offline = await inspectProjectOperation(h.archive, requestId);
  assert.equal(offline.freshness, 'LAST_KNOWN'); assert.equal(offline.outcome, 'INTERRUPTED');
  assert.doesNotMatch(JSON.stringify(offline), /canonicalIntent|payloadHash|never-created/);
  const offlineClient = await client.runProject('operation', { requestId: requestId.toUpperCase() }, { stateDirectory: h.archive });
  assert.equal(offlineClient.freshness, 'LAST_KNOWN'); assert.equal(offlineClient.outcome, 'INTERRUPTED');
  assert.equal((await h.call('start')).code, 0);
  const afterRestart = await openStorage({ path, readonly: true });
  try { assert.equal((await afterRestart.getProjectOperation(requestId))?.outcome, 'INTERRUPTED'); }
  finally { await afterRestart.close(); }
});

test('registry stop shares the existing drain budget and never turns uncertain ownership into absence', async () => {
  await drainProjectOperations({ shutdown: async () => 'ABSENT' }, makeDeadline(systemClock, 100));
  await assert.rejects(drainProjectOperations({ shutdown: async () => 'UNKNOWN' }, makeDeadline(systemClock, 100)), /RESOURCE_IDENTITY_UNKNOWN/);
  const started = performance.now();
  await assert.rejects(drainProjectOperations({ shutdown: () => new Promise(() => {}) }, makeDeadline(systemClock, 20)), /RESOURCE_IDENTITY_UNKNOWN/);
  assert.ok(performance.now() - started < 250);
});
