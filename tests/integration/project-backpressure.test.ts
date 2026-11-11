import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createProjectHarness } from '../fixtures/project-client.js';
import { observationStore } from '../fixtures/project-observation.js';
import { openStorage } from '../../src/storage/worker.js';

test('V1 four owned probes and 32 pending bound admission; 33rd is rejected without a ledger row while reads/status remain available', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('queue-capacity'), added = await a.register(repo);
  await rename(join(repo, '.git/index'), join(repo, '.git/index.saved')); await promisify(execFile)('/usr/bin/mkfifo', [join(repo, '.git/index')]);
  const ids = Array.from({ length: 32 }, () => randomUUID());
  await Promise.all(ids.map(requestId => a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId, timeoutMs: 1_000 })));
  const reader = await openStorage({ path: join(a.h.archive, 'state.sqlite'), readonly: true });
  try {
    assert.equal((await reader.listPendingProjectOperations()).length, 32);
    const requestId = randomUUID(), rejected = await a.other.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId });
    assert.equal(rejected.result, 'BUSY'); assert.equal(rejected.data.accepted, false); assert.equal(await reader.getProjectOperation(requestId), null);
    const metrics = JSON.parse((await a.h.call('diagnostics')).stdout).data.projectRegistry;
    assert.ok(metrics, 'registry pressure diagnostics are required'); assert.equal(metrics.pending, 32); assert.equal(metrics.activeProbes, 4); assert.equal(metrics.queued, 28);
    assert.ok(metrics.categories.busy >= 1); assert.doesNotMatch(JSON.stringify(metrics), /queue-capacity|index.saved|canonicalIntent/);
    const start = performance.now(); assert.equal((await a.h.call('status')).code, 0); await a.get(added.projectId!); assert.ok(performance.now() - start <= 2_000);
    const stop = performance.now(); assert.equal((await a.h.call('stop')).code, 0); assert.ok(performance.now() - stop <= 10_000);
    assert.equal((await reader.listPendingProjectOperations()).length, 0);
  } finally { await reader.close(); }
});

test('V1 a blocked outbox prevents both valid and failing verifies from bypassing admission, while authoritative data stays readable', async t => {
  let fault = false; const f = await observationStore(t, point => { if (fault && point === 'journal.allocated') throw new Error('controlled drain IO failure'); });
  const original = f.store.getProject(f.projectId); fault = true;
  f.store.recordEvents([{ type: 'diagnostics.degraded', payload: { code: 'BUSY' } }]);
  for (const projectId of [f.projectId, randomUUID()]) {
    const intent = { ...f.intent('VERIFY', { projectId }), projectId: projectId === f.projectId ? projectId : null };
    assert.throws(() => f.store.acceptProjectOperation(intent), /EVENT_BACKPRESSURE/); assert.equal(f.store.getProjectOperation(intent.requestId), null);
  }
  assert.deepEqual(f.store.getProject(f.projectId), original); assert.ok(f.store.getEventState().pendingBytes <= 64 * 1024);
  fault = false; f.store.drainEvents();
});

test('V1 oversized outbox and pinned WAL cannot rotate project configuration or operation outcomes', async t => {
  const f = await observationStore(t), original = f.store.getProject(f.projectId), revision = f.store.readSnapshot()!.store.revision;
  assert.throws(() => f.store.recordEvents(Array.from({ length: 1000 }, () => ({ type: 'diagnostics.degraded' as const, payload: { code: 'BUSY' } }))), /EVENT_BACKPRESSURE/);
  assert.equal(f.store.readSnapshot()!.store.revision, revision);
  const pin = new Database(f.path); pin.exec('BEGIN; SELECT * FROM store');
  try {
    let blocked = false;
    for (let i = 0; i < 500; i++) { try { f.store.recordEvents([{ type: 'diagnostics.degraded', payload: { code: 'BUSY' } }]); } catch (error) { assert.match(String(error), /EVENT_BACKPRESSURE/); blocked = true; break; } }
    assert.equal(blocked, true); assert.ok((await lstat(f.path + '-wal')).blocks * 512 <= 2 * 1024 * 1024);
    assert.deepEqual(f.store.getProject(f.projectId), original); assert.equal(f.store.getProjectOperation(original!.observation!.requestId)!.outcome, 'SUCCEEDED');
  } finally { pin.exec('ROLLBACK'); pin.close(); }
});
