import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createTestContext } from '../fixtures/test-context.js';
import { createFoundationV2 } from '../fixtures/foundation-schema-v2.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createClientBackend } from '../../src/bootstrap.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { createProjectDispatch } from '../../src/core/projects/dispatch.js';
import { openStorage } from '../../src/storage/worker.js';

test('registry observations on an absent archive have zero filesystem effects and never start the daemon', async t => {
  const context = await createTestContext(t);
  const before = await readdir(context.directory);
  let launches = 0;
  const launcher = { spawnDaemon: async () => { launches++; throw new Error('forbidden autostart'); },
    spawnController: async () => { launches++; throw new Error('forbidden autostart'); } };
  const client = new LocalClient(createClientBackend(launcher));
  const result = await client.runProject('operation', { requestId: randomUUID() }, { stateDirectory: join(context.directory, 'absent') });
  assert.equal(result.error?.code, 'STATE_ABSENT');
  assert.equal(launches, 0); assert.deepEqual(await readdir(context.directory), before);
});

test('offline schema 2 registry query reports uninitialized and preserves the known Foundation database', async t => {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const archive = createFoundationV2(directory);
  const before = await readFile(archive.path), names = await readdir(directory);
  const client = new LocalClient(createClientBackend());
  const result = await client.runProject('operation', { requestId: archive.requestId }, { stateDirectory: directory });
  assert.equal(result.error?.code, 'REGISTRY_NOT_INITIALIZED');
  assert.deepEqual(await readFile(archive.path), before);
  assert.deepEqual(await readdir(directory), names);
});

test('explicit start refuses occupied daemon ownership before upgrade, then upgrades safely once it is released', async t => {
  const h = await createCliHarness(t);
  const platform = createPlatformPaths();
  const paths = (await platform.resolveArchive(h.archive, 'write'))!;
  const archive = createFoundationV2(paths.directory);
  // This scenario uses no pending journal batch; exact cursor/outbox preservation
  // with a pending batch is covered independently by the upgrade contract.
  const fixture = new Database(archive.path);
  fixture.exec("UPDATE event_outbox SET records='[]'; UPDATE journal_metadata SET high_water=0,retention_floor=1,degraded_code=NULL; UPDATE store SET next_event_seq=1");
  fixture.close();
  const before = await readFile(archive.path);
  const lock = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
  assert.equal(lock.status, 'HELD');
  if (lock.status !== 'HELD') throw new Error('owned lease unavailable');
  try {
    const denied = await h.call('start');
    assert.equal(denied.code, 4, denied.stdout);
    assert.deepEqual(await readFile(archive.path), before);
  } finally { lock.handle.release(); }
  const started = await h.call('start');
  assert.equal(started.code, 0, started.stdout);
  const reader = await openStorage({ path: archive.path, readonly: true });
  try {
    const snapshot = (await reader.readSnapshot())!;
    assert.equal(snapshot.store.schemaVersion, 3); assert.equal(snapshot.store.storeId, archive.storeId);
    assert.equal(snapshot.instance?.lifecycle, 'RUNNING');
    assert.equal((await reader.getOperation(archive.requestId))?.payloadHash, 'a'.repeat(64));
    assert.equal((await reader.getRequestReservation(archive.requestId))?.scope, 'LIFECYCLE');
    assert.equal((await reader.listPendingProjectOperations()).length, 0);
    assert.equal((await reader.listResources(snapshot.instance!.instanceId)).length, 0);
  } finally { await reader.close(); }
});

test('real local authentication does not grant controller credentials access to private registry outcomes', async t => {
  const f = await createRegistryStore(t);
  const input = f.intent(); f.store.acceptProjectOperation(input);
  const clientKey = randomBytes(32).toString('hex'), controllerKey = randomBytes(32).toString('hex');
  let privateReads = 0;
  const dispatch = createProjectDispatch({ storage: { getEventState: async () => f.store.getEventState(), getProject: async id => f.store.getProject(id) }, operations: {
    get: async (_peer, id) => { privateReads++; return f.store.getProjectOperation(id); },
    admit: async () => { throw new Error('not enabled'); },
  } });
  const transport = createLocalTransport(), endpoint = join(f.directory, 'registry-auth.sock');
  const server = await transport.listen(endpoint, f.instanceId, new Map([[clientKey, 'client'], [controllerKey, 'controller']]),
    (request, peer) => dispatch(request, peer, f.store.readSnapshot()!));
  t.after(() => server.close());
  const request = { protocolVersion: 1 as const, correlationId: randomUUID(), method: 'projects.operation.get', params: { requestId: input.requestId } };
  const denied = await transport.call(endpoint, controllerKey, request, 1_000);
  assert.equal((denied.data as { code: string }).code, 'UNAUTHORIZED'); assert.equal(privateReads, 0);
  const allowed = await transport.call(endpoint, clientKey, request, 1_000);
  assert.equal(allowed.result, 'BUSY'); assert.equal(privateReads, 1);
  assert.doesNotMatch(JSON.stringify(allowed), /canonicalIntent|payloadHash|not-present/);
});
