import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { openStorage } from '../../src/storage/worker.js';
import type { StoragePort } from '../../src/ports/storage.js';
import { foundationError } from '../../src/domain/errors.js';
import { createTestContext } from '../fixtures/test-context.js';
import { createFoundationV2 } from '../fixtures/foundation-schema-v2.js';

interface Admission {
  requestId: string; action: 'REGISTER'; payloadHash: string; canonicalIntent: string;
  projectId: null; expectedConfigRevision: null; owningInstanceId: string; ownerUid: number;
  acceptedAt: string; deadlineAt: string;
}
interface Result {
  action: 'REGISTER'; requestId: string; projectId: null; outcome: 'FAILED' | 'BLOCKED' | 'INTERRUPTED';
  effect: 'NONE'; configRevision: null; observationRevision: null; completedAt: string;
  error: ReturnType<typeof foundationError>;
}
interface Record extends Admission { phase: string; outcome: string; result: Result | null }
interface RegistryStore {
  acceptProjectOperation(input: Admission): Promise<{ accepted: boolean; operation: Record }>;
  getProjectOperation(requestId: string): Promise<Record | null>;
  setProjectOperationPhase(requestId: string, phase: 'PROBING'): Promise<void>;
  completeProjectOperation(requestId: string, result: Result): Promise<void>;
  listPendingProjectOperations(): Promise<readonly Record[]>;
}
function registry(store: StoragePort): RegistryStore {
  const candidate = store as unknown as RegistryStore;
  for (const method of ['acceptProjectOperation', 'getProjectOperation', 'setProjectOperationPhase', 'completeProjectOperation', 'listPendingProjectOperations'] as const) {
    assert.equal(typeof candidate[method], 'function', `required registry storage method ${method} is not implemented`);
  }
  return candidate;
}
const timestamp = '2026-11-10T12:00:00.000Z';
function admission(storeId: string, instanceId: string, requestId = randomUUID()): Admission {
  const canonicalIntent = JSON.stringify({ version: 1, scope: 'PROJECT', storeId, action: 'REGISTER', params: { path: '/not-present/original' } });
  return { requestId, action: 'REGISTER', canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'),
    projectId: null, expectedConfigRevision: null, owningInstanceId: instanceId, ownerUid: process.getuid!(),
    acceptedAt: timestamp, deadlineAt: '2026-11-10T12:00:28.000Z' };
}
function terminal(input: Admission, outcome: Result['outcome'] = 'INTERRUPTED'): Result {
  return { requestId: input.requestId, action: input.action, projectId: null, outcome, effect: 'NONE', configRevision: null,
    observationRevision: null, completedAt: '2026-11-10T12:00:01.000Z', error: foundationError(outcome === 'BLOCKED' ? 'UNAUTHORIZED' : 'INVALID_REQUEST') };
}
async function fixture(t: Parameters<typeof createTestContext>[0]) {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const path = join(directory, 'state.sqlite');
  const storeId = randomUUID();
  const store = await openStorage({ path, identity: { storeId, schemaVersion: 3, ownerUid: process.getuid!(), canonicalPath: directory, revision: '0' } });
  t.after(() => store.close());
  const api = registry(store);
  const instanceId = randomUUID();
  const bootstrap = randomUUID(), ticketId = randomUUID();
  await store.acceptOperation({ requestId: bootstrap, action: 'start', payloadHash: 'c'.repeat(64), ownerUid: process.getuid!(),
    targetInstanceId: null, acceptedAt: timestamp });
  await store.issueTicket({ requestId: bootstrap, ticketId, instanceId, generation: '1' });
  await store.claimTicket(ticketId, '1', process.pid);
  await store.recordInstance({ instanceId, pid: process.pid, generation: '1', lifecycle: 'RUNNING', startedAt: timestamp, shutdownPrepared: false, lastError: null });
  await store.completeOperation(bootstrap, 'SUCCEEDED', timestamp, null);
  return { path, store, api, storeId, instanceId };
}

test('registry ledger coexists with lifecycle pending and resolves cross-scope requestId collisions', async t => {
  const f = await fixture(t);
  const lifecycle = { requestId: randomUUID(), action: 'start' as const, payloadHash: 'a'.repeat(64),
    ownerUid: process.getuid!(), targetInstanceId: null, acceptedAt: timestamp };
  await f.store.acceptOperation(lifecycle);
  const first = admission(f.storeId, f.instanceId);
  const second = admission(f.storeId, f.instanceId);
  assert.equal((await f.api.acceptProjectOperation(first)).accepted, true);
  assert.equal((await f.api.acceptProjectOperation(second)).accepted, true);
  assert.equal((await f.api.listPendingProjectOperations()).length, 2);
  assert.equal((await f.store.readSnapshot())?.pendingOperation?.requestId, lifecycle.requestId);
  await assert.rejects(f.api.acceptProjectOperation({ ...first, requestId: lifecycle.requestId }), /IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.store.acceptOperation({ ...lifecycle, requestId: first.requestId }), /IDEMPOTENCY_CONFLICT/);
  const database = new Database(f.path, { readonly: true });
  try {
    assert.deepEqual(database.prepare('SELECT scope,action,payload_hash FROM request_catalog WHERE request_id=?').get(lifecycle.requestId),
      { scope: 'LIFECYCLE', action: 'start', payload_hash: lifecycle.payloadHash });
  } finally { database.close(); }
});

test('original normalized intent and terminal snapshot survive restart; changed payload never changes them', async t => {
  const f = await fixture(t);
  const input = admission(f.storeId, f.instanceId);
  await f.api.acceptProjectOperation(input);
  await f.api.setProjectOperationPhase(input.requestId, 'PROBING');
  const result = terminal(input);
  await f.api.completeProjectOperation(input.requestId, result);
  const saved = await f.api.getProjectOperation(input.requestId);
  assert.equal(saved?.phase, 'FINALIZED');
  assert.deepEqual(saved?.result, result);
  const revision = (await f.store.readSnapshot())!.store.revision;
  assert.equal((await f.api.acceptProjectOperation(input)).accepted, false);
  assert.equal((await f.store.readSnapshot())!.store.revision, revision);
  await assert.rejects(f.api.acceptProjectOperation({ ...input, payloadHash: 'b'.repeat(64) }), /IDEMPOTENCY_CONFLICT|INVALID_REQUEST/);
  await assert.rejects(f.api.completeProjectOperation(input.requestId, { ...result, outcome: 'FAILED' }), /INVALID_TRANSITION/);
  await assert.rejects(f.api.setProjectOperationPhase(input.requestId, 'PROBING'), /INVALID_TRANSITION/);
  await f.store.close();
  const offline = await openStorage({ path: f.path, readonly: true });
  try {
    assert.deepEqual(await registry(offline).getProjectOperation(input.requestId), saved);
    await assert.rejects(registry(offline).acceptProjectOperation(input), /UNAUTHORIZED/);
  } finally { await offline.close(); }
});

test('BLOCKED is terminal only for registry and retained beyond event journal retention', async t => {
  const f = await fixture(t);
  const input = admission(f.storeId, f.instanceId);
  await f.api.acceptProjectOperation(input);
  await f.api.completeProjectOperation(input.requestId, terminal(input, 'BLOCKED'));
  assert.equal((await f.api.listPendingProjectOperations()).length, 0);
  assert.equal((await f.api.acceptProjectOperation(input)).operation.outcome, 'BLOCKED');
  const next = admission(f.storeId, f.instanceId);
  await f.api.acceptProjectOperation(next);
  // Simulate an already advanced retention floor; authoritative results are independent.
  const database = new Database(f.path);
  try { database.prepare('UPDATE journal_metadata SET retention_floor=high_water+1 WHERE singleton=1').run(); }
  finally { database.close(); }
  assert.deepEqual((await f.api.getProjectOperation(input.requestId))?.result, terminal(input, 'BLOCKED'));
  assert.equal((await f.api.getProjectOperation(randomUUID())), null);
  const unauthorized = { ...next, requestId: randomUUID(), ownerUid: process.getuid!() + 1 };
  await assert.rejects(f.api.acceptProjectOperation(unauthorized), /UNAUTHORIZED|INVALID_REQUEST/);
});

test('ledger projectId refers to retained tombstones and never cascades away with removal', async t => {
  const f = await fixture(t);
  const database = new Database(f.path, { readonly: true });
  try {
    const projectLinks = database.pragma('foreign_key_list(project_operations)') as Array<{ table: string; on_delete: string }>;
    assert.ok(projectLinks.some(link => link.table === 'projects' && ['NO ACTION', 'RESTRICT'].includes(link.on_delete)));
    const sql = (database.prepare("SELECT sql FROM sqlite_master WHERE name='projects'").get() as { sql: string }).sql;
    assert.match(sql, /removed_at/);
  } finally { database.close(); }
});

test('readonly registry query on known schema 2 reports uninitialized without upgrading or writing', async t => {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const { path, requestId } = createFoundationV2(directory);
  const before = await import('node:fs/promises').then(fs => fs.readFile(path));
  const offline = await openStorage({ path, readonly: true });
  try { await assert.rejects(registry(offline).getProjectOperation(requestId), /REGISTRY_NOT_INITIALIZED/); }
  finally { await offline.close(); }
  assert.deepEqual(await import('node:fs/promises').then(fs => fs.readFile(path)), before);
});

test('registry reads remain available during writer BUSY retry and after a classified mutation failure', async t => {
  const f = await fixture(t);
  const first = admission(f.storeId, f.instanceId);
  await f.api.acceptProjectOperation(first);
  const lock = new Database(f.path);
  lock.exec('BEGIN IMMEDIATE');
  const second = admission(f.storeId, f.instanceId);
  const pending = f.api.acceptProjectOperation(second);
  try {
    await new Promise(resolve => setTimeout(resolve, 75));
    const started = performance.now();
    assert.equal((await f.api.getProjectOperation(first.requestId))?.outcome, 'IN_PROGRESS');
    assert.equal((await f.store.getRequestReservation(first.requestId))?.scope, 'PROJECT');
    assert.equal(await f.store.getProject(randomUUID()), null);
    assert.equal((await f.api.listPendingProjectOperations()).length, 1);
    assert.ok(performance.now() - started < 500);
  } finally { lock.exec('ROLLBACK'); lock.close(); }
  assert.equal((await pending).accepted, true);
  const database = new Database(f.path);
  database.exec("CREATE TRIGGER owned_reject_registry_insert BEFORE INSERT ON project_operations BEGIN SELECT RAISE(ABORT,'owned sentinel-secret write failure'); END");
  database.close();
  const third = admission(f.storeId, f.instanceId);
  await assert.rejects(f.api.acceptProjectOperation(third), /PERSISTENCE_UNAVAILABLE/);
  assert.equal(await f.api.getProjectOperation(third.requestId), null);
  assert.equal((await f.api.listPendingProjectOperations()).length, 2);
  assert.equal((await f.api.getProjectOperation(first.requestId))?.payloadHash, first.payloadHash);
  assert.equal((await f.store.getRequestReservation(first.requestId))?.payloadHash, first.payloadHash);
  assert.equal(await f.store.getProject(randomUUID()), null);
});
