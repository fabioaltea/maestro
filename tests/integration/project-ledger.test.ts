import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { canonicalProjectIntent } from '../../src/domain/projects/intent.js';
import { foundationError } from '../../src/domain/errors.js';
import { createTestContext } from '../fixtures/test-context.js';
import type { AcceptProjectOperation } from '../../src/ports/registry.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';

async function fixture(t: Parameters<typeof createTestContext>[0]) {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const storeId = randomUUID(), instanceId = randomUUID();
  const path = join(directory, 'state.sqlite');
  const store = new SQLiteStore({ path, identity: { storeId, schemaVersion: 3, ownerUid: process.getuid!(), canonicalPath: directory, revision: '0' } });
  t.after(() => store.close());
  const bootstrap = randomUUID(), ticketId = randomUUID();
  store.acceptOperation({ requestId: bootstrap, action: 'start', payloadHash: 'c'.repeat(64), ownerUid: process.getuid!(),
    targetInstanceId: null, acceptedAt: '2026-11-10T12:00:00.000Z' });
  store.issueTicket({ requestId: bootstrap, ticketId, instanceId, generation: '1' });
  store.claimTicket(ticketId, '1', process.pid);
  store.recordInstance({ instanceId, generation: '1', pid: process.pid, lifecycle: 'RUNNING',
    startedAt: '2026-11-10T12:00:00.000Z', shutdownPrepared: false, lastError: null });
  store.completeOperation(bootstrap, 'SUCCEEDED', '2026-11-10T12:00:01.000Z', null);
  const makeIntent = (params: { path: string } = { path: '/unavailable/original' }): AcceptProjectOperation => {
    const canonicalIntent = canonicalProjectIntent(storeId, 'REGISTER', params);
    return { requestId: randomUUID(), action: 'REGISTER', canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'),
      projectId: null, expectedConfigRevision: null, owningInstanceId: instanceId, ownerUid: process.getuid!(),
      acceptedAt: '2026-11-10T12:00:00.000Z', deadlineAt: '2026-11-10T12:00:28.000Z' };
  };
  return { store, storeId, instanceId, makeIntent, path };
}

test('global catalog rejects both cross-scope collision directions while allowing independent registry pending work', async t => {
  const f = await fixture(t);
  const lifecycle = { requestId: randomUUID(), action: 'start' as const, payloadHash: 'a'.repeat(64),
    ownerUid: process.getuid!(), targetInstanceId: null, acceptedAt: '2026-11-10T12:00:00.000Z' };
  f.store.acceptOperation(lifecycle);
  const first = f.makeIntent(), second = f.makeIntent();
  assert.equal(f.store.acceptProjectOperation(first).accepted, true);
  assert.equal(f.store.acceptProjectOperation(second).accepted, true);
  assert.equal(f.store.listPendingProjectOperations().length, 2);
  assert.throws(() => f.store.acceptProjectOperation({ ...first, requestId: lifecycle.requestId }), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => f.store.acceptOperation({ ...lifecycle, requestId: first.requestId }), /IDEMPOTENCY_CONFLICT/);
  assert.equal(f.store.getOperation(lifecycle.requestId)?.payloadHash, lifecycle.payloadHash);
});

test('terminal results and original intents stay immutable; retry ignores live path and current instance defaults', async t => {
  const f = await fixture(t);
  const input = f.makeIntent();
  f.store.acceptProjectOperation(input);
  f.store.setProjectOperationPhase(input.requestId, 'PROBING');
  const result: ProjectOperationResult = { action: input.action, requestId: input.requestId, projectId: null,
    outcome: 'BLOCKED', effect: 'NONE', configRevision: null, observationRevision: null,
    completedAt: '2026-11-10T12:00:01.000Z', error: foundationError('UNAUTHORIZED') };
  f.store.completeProjectOperation(input.requestId, result);
  const revision = f.store.readSnapshot()!.store.revision;
  assert.deepEqual(f.store.acceptProjectOperation({ ...input, owningInstanceId: randomUUID() }).operation.result, result);
  assert.equal(f.store.readSnapshot()!.store.revision, revision);
  assert.equal(f.store.listPendingProjectOperations().length, 0);
  assert.throws(() => f.store.completeProjectOperation(input.requestId, { ...result, outcome: 'FAILED' }), /INVALID_TRANSITION/);
  assert.throws(() => f.store.setProjectOperationPhase(input.requestId, 'PROBING'), /INVALID_TRANSITION/);
  assert.throws(() => f.store.acceptProjectOperation({ ...input, canonicalIntent: 'not-the-original-intent' }), /IDEMPOTENCY_CONFLICT/);
});

test('invalid hash, foreign store or unauthorized owner leaves no partial reservation', async t => {
  const f = await fixture(t);
  const input = f.makeIntent();
  assert.throws(() => f.store.acceptProjectOperation({ ...input, payloadHash: 'b'.repeat(64) }), /INVALID_REQUEST/);
  assert.throws(() => f.store.acceptProjectOperation({ ...input, ownerUid: process.getuid!() + 1 }), /UNAUTHORIZED/);
  assert.equal(f.store.getProjectOperation(input.requestId), null);
  const database = new Database(f.path, { readonly: true });
  try { assert.equal((database.prepare("SELECT count(*) AS count FROM request_catalog WHERE scope='PROJECT'").get() as { count: number }).count, 0); }
  finally { database.close(); }
  assert.equal(f.store.acceptProjectOperation(input).accepted, true);
});

test('unknown project intent can be recorded without fabricating a project or violating ledger FKs', async t => {
  const f = await fixture(t);
  const unknownId = randomUUID();
  const canonicalIntent = canonicalProjectIntent(f.storeId, 'VERIFY', { projectId: unknownId });
  const input: AcceptProjectOperation = { ...f.makeIntent(), action: 'VERIFY', canonicalIntent,
    payloadHash: createHash('sha256').update(canonicalIntent).digest('hex') };
  const accepted = f.store.acceptProjectOperation(input);
  assert.equal(accepted.operation.projectId, null);
  assert.equal(JSON.parse(accepted.operation.canonicalIntent).params.projectId, unknownId);
});
