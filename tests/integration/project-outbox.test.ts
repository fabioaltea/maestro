import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';

test('registry admission and terminal events share the existing journal and never inherit a concurrent lifecycle requestId', async t => {
  const f = await createRegistryStore(t);
  const lifecycleId = randomUUID();
  f.store.acceptOperation({ requestId: lifecycleId, action: 'stop', payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(),
    targetInstanceId: f.instanceId, acceptedAt: '2026-11-10T12:00:00.000Z' });
  const input = f.intent();
  f.store.acceptProjectOperation(input);
  f.store.completeProjectOperation(input.requestId, f.terminal(input));
  const records = f.store.listEvents({ limit: 100 }).records;
  const registry = records.filter(event => event.payload.scope === 'project');
  assert.equal(registry.length, 2);
  assert.deepEqual(registry.map(event => event.type), ['operation.accepted', 'operation.failed']);
  assert.deepEqual(registry.map(event => event.payload.outcome), ['IN_PROGRESS', 'INTERRUPTED']);
  for (const record of registry) {
    assert.equal(record.operationId, input.requestId); assert.equal(record.instanceId, f.instanceId);
    assert.equal(record.storeId, f.storeId); assert.equal(record.payload.action, 'REGISTER');
    assert.doesNotMatch(JSON.stringify(record), /not-present|canonicalIntent|payloadHash/);
  }
  const seqs = records.map(record => BigInt(record.seq));
  for (let i = 1; i < seqs.length; i++) assert.equal(seqs[i], seqs[i - 1]! + 1n);
  const beforeRetry = f.store.getEventState();
  f.store.acceptProjectOperation(input);
  assert.deepEqual(f.store.getEventState(), beforeRetry);
});

test('a precommit failure rolls back both terminal ledger state and its event', async t => {
  let reject = false;
  const f = await createRegistryStore(t, point => { if (reject && point === 'event.beforeCommit') throw new Error('owned precommit fault'); });
  const input = f.intent(); f.store.acceptProjectOperation(input);
  const before = f.store.listEvents({ limit: 100 });
  reject = true;
  assert.throws(() => f.store.completeProjectOperation(input.requestId, f.terminal(input)), /owned precommit fault/);
  assert.equal(f.store.getProjectOperation(input.requestId)?.outcome, 'IN_PROGRESS');
  assert.equal(f.store.getProjectOperation(input.requestId)?.result, null);
  assert.deepEqual(f.store.listEvents({ limit: 100 }), before);
  reject = false;
  f.store.completeProjectOperation(input.requestId, f.terminal(input));
  assert.equal(f.store.listEvents({ limit: 100 }).records.filter(event => event.operationId === input.requestId).length, 2);
});

test('postcommit drain failure preserves durable outcome and bounded outbox; replay drain never duplicates it', async t => {
  let failDrain = false;
  const f = await createRegistryStore(t, point => { if (failDrain && point === 'event.cleared') throw new Error('owned sentinel-secret drain fault'); });
  const input = f.intent(); f.store.acceptProjectOperation(input);
  failDrain = true;
  f.store.completeProjectOperation(input.requestId, f.terminal(input, 'BLOCKED'));
  const saved = f.store.getProjectOperation(input.requestId);
  assert.equal(saved?.outcome, 'BLOCKED');
  const state = f.store.getEventState();
  assert.equal(state.degraded, true); assert.ok(state.pendingBytes > 0 && state.pendingBytes <= 64 * 1024);
  const database = new Database(f.path, { readonly: true });
  try {
    const pending = JSON.parse((database.prepare('SELECT records FROM event_outbox').get() as { records: string }).records) as Array<{ operationId: string }>;
    assert.equal(pending.length, 1); assert.equal(pending[0]?.operationId, input.requestId);
  } finally { database.close(); }
  assert.deepEqual(f.store.acceptProjectOperation(input).operation, saved);
  // Pending journal data cannot be bypassed even to admit a failure or another verify.
  assert.throws(() => f.store.acceptProjectOperation(f.intent()), /EVENT_BACKPRESSURE/);
  assert.equal(f.store.listPendingProjectOperations().length, 0);
  failDrain = false;
  f.store.drainEvents();
  const records = f.store.listEvents({ limit: 100 }).records;
  assert.equal(records.filter(event => event.operationId === input.requestId && event.type === 'operation.blocked').length, 1);
  f.store.drainEvents(); assert.deepEqual(f.store.listEvents({ limit: 100 }).records, records);
  assert.deepEqual(f.store.getProjectOperation(input.requestId), saved);
  const offline = new SQLiteStore({ path: f.path, readonly: true });
  try { assert.deepEqual(offline.getProjectOperation(input.requestId), saved); }
  finally { offline.close(); }
});
