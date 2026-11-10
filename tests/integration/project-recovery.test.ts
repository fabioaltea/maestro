import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { openStorage } from '../../src/storage/worker.js';
import { canonicalProjectIntent } from '../../src/domain/projects/intent.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { drainProjectOperations } from '../../src/core/lifecycle.js';

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
