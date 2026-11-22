import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import type { DiscoveryAdmission } from '../../src/ports/discovery.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { openStorage } from '../../src/storage/worker.js';

function intent(storeId: string, instanceId: string): DiscoveryAdmission {
  const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId, action: 'check', targetId: 'provider', configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: null, providerProfileDigest: null, modelId: null, payload: {} });
  return { requestId: randomUUID(), instanceId, canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), action: 'check', grantId: null,
    ownerUid: process.getuid!(), nowMs: Date.now(), acceptedAt: new Date().toISOString(), discovery: null, run: null, expectedStateRevision: null, acquireSlot: false };
}
test('existing writer publishes admission with metadata only and replay emits no second event', async t => {
  const f = await createRegistryStore(t); const input = intent(f.storeId, f.instanceId);
  const first = f.store.admitDiscoveryOperation(input); assert.equal(first.ok, true);
  assert.deepEqual(f.store.getRequestReservation(input.requestId), { scope: 'DISCOVERY', action: 'check', payloadHash: input.payloadHash });
  const before = f.store.getEventState().highWater;
  const replay = f.store.admitDiscoveryOperation(input); assert.equal(replay.ok, true);
  if (!replay.ok) throw new Error('EXPECTED_REPLAY'); assert.equal(replay.value.inserted, false);
  assert.equal(f.store.getEventState().highWater, before);
  const record = f.store.listEvents().records.find(event => event.operationId === input.requestId);
  assert.ok(record); assert.deepEqual(record.payload, { scope: 'discovery', action: 'check' });
});
test('failure before commit leaves neither an accepted operation nor an event', async t => {
  const f = await createRegistryStore(t, point => { if (point === 'event.beforeCommit') throw new Error('OWNED_FAULT'); });
  const input = intent(f.storeId, f.instanceId), highWater = f.store.getEventState().highWater;
  const result = f.store.admitDiscoveryOperation(input); assert.equal(result.ok, false);
  assert.equal(f.store.getDiscoveryOperation(input.requestId), null);
  assert.equal(f.store.getRequestReservation(input.requestId), null);
  assert.equal(f.store.getEventState().highWater, highWater);
});
test('worker and confined readonly proxy share Discovery reads without a second writer implementation', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const writer = await openStorage({ path: f.path });
  const input = intent(f.storeId, f.instanceId);
  try {
    const result = await writer.admitDiscoveryOperation!(input); assert.equal(result.ok, true);
    assert.equal((await writer.getDiscoveryOperation!(input.requestId))?.requestId, input.requestId);
    assert.equal((await writer.getRequestReservation(input.requestId))?.scope, 'DISCOVERY');
  } finally { await writer.close(); }
  const reader = await openStorage({ path: f.path, readonly: true });
  try {
    const status = await reader.getDiscoveryOperation!(input.requestId);
    assert.equal(status?.requestId, input.requestId);
    assert.equal(Object.hasOwn(status!, 'canonicalIntent'), false);
    assert.equal(Object.hasOwn(status!, 'payloadHash'), false);
    await assert.rejects(reader.admitDiscoveryOperation!(intent(f.storeId, f.instanceId)), /UNAUTHORIZED/);
  } finally { await reader.close(); }
});

test('a persistence failure returned by Discovery notifies the existing worker failure channel', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const writer = await openStorage({ path: f.path });
  const failures: string[] = []; writer.onFailure(error => failures.push(error.code));
  const Database = (await import('better-sqlite3')).default;
  const corruptor = new Database(f.path);
  try { corruptor.exec('DROP TABLE discovery_operations'); } finally { corruptor.close(); }
  try {
    const result = await writer.admitDiscoveryOperation!(intent(f.storeId, f.instanceId));
    assert.deepEqual(result, { ok: false, code: 'PERSISTENCE_UNAVAILABLE' });
    assert.deepEqual(failures, ['PERSISTENCE_UNAVAILABLE']);
    assert.equal((await writer.readSnapshot())?.store.storeId, f.storeId);
  } finally { await writer.close(); }
});
