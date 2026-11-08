import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, writeFile, readdir, lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { EventRecord } from '../../src/ports/storage.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { SCHEMA_VERSION } from '../../src/storage/schema.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Journal {
  append(events: readonly EventRecord[], pendingFloor?: string): void;
  recover(pending: readonly EventRecord[]): void;
  list(options?: {after?: string; highWater?: string; limit?: number; maxBytes?: number}): {records: readonly EventRecord[]; firstAvailable: string; highWater: string; truncated: boolean};
}
interface JournalModule { openJournal(options: {directory: string; storeId: string; readonly?: boolean; segmentBytes?: number; budgetBytes?: number}): Journal; encodeEvent(event: EventRecord): Buffer }
const journalModule = () => loadContract<JournalModule>('storage/event-journal.js', ['openJournal', 'encodeEvent']);
const storeId = randomUUID();
const event = (seq: number): EventRecord => ({protocolVersion: 1, storeId, eventId: randomUUID(), seq: String(seq), occurredAt: new Date().toISOString(), instanceId: null, operationId: null, type: 'diagnostics.degraded', payload: {padding: 'x'.repeat(900)}});

test('only a proven partial pending tail is repaired; complete checksum damage preserves bytes', async t => {
  const {openJournal, encodeEvent} = await journalModule();
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  const journal = openJournal({directory, storeId});
  const first = event(1), second = event(2);
  journal.append([first]);
  const file = join(directory, (await readdir(directory))[0]!);
  await appendFile(file, encodeEvent(second).subarray(0, 51));
  assert.equal(openJournal({directory, storeId, readonly: true}).list({highWater: '1'}).records.length, 1);
  const recovered = openJournal({directory, storeId}); recovered.recover([second]);
  assert.equal(recovered.list().records.length, 2);
  recovered.append([second]);
  assert.equal(recovered.list().records.length, 2);
  const bytes = await readFile(file); bytes[45] = bytes[45]! ^ 1; await writeFile(file, bytes);
  assert.throws(() => openJournal({directory, storeId}).recover([first]), /STATE_CORRUPT/);
  assert.deepEqual(await readFile(file), bytes);
});

test('oldest-first rotation respects physical allocation and cannot prune a pending batch', async t => {
  const {openJournal} = await journalModule();
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  const journal = openJournal({directory, storeId, segmentBytes: 4096, budgetBytes: 8192});
  for (let seq = 1; seq <= 6; seq++) journal.append([event(seq)]);
  const page = journal.list({limit: 1});
  assert.throws(() => journal.append([event(7)], '1'), /EVENT_BACKPRESSURE/);
  for (let seq = 7; seq <= 30; seq++) journal.append([event(seq)]);
  assert.ok(BigInt(journal.list().firstAvailable) > 1n);
  assert.equal(page.records.length, 1); // materialized readers hold no segment handle
  let allocated = 0;
  for (const name of await readdir(directory)) allocated += (await lstat(join(directory, name))).blocks * 512;
  assert.ok(allocated <= 8192, `allocated ${allocated}`);
});

test('outbox is bounded, failed drain preserves the committed intent, and pinned WAL blocks new writes', async t => {
  const module = await journalModule(); assert.ok(module);
  const context = await createTestContext(t), path = join(context.directory, 'state.sqlite');
  const store = new SQLiteStore({path, identity: {storeId, schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0'}}) as SQLiteStore & {
    recordEvents(events: readonly {type: string; payload: Record<string, unknown>}[]): void;
    getEventState(): {pendingBytes: number};
  };
  try {
    const revision = store.readSnapshot()!.store.revision;
    assert.throws(() => store.recordEvents(Array.from({length: 1000}, () => ({type: 'diagnostics.degraded', payload: {code: 'BUSY'}}))), /EVENT_BACKPRESSURE/);
    assert.equal(store.readSnapshot()!.store.revision, revision);
    const blocker = new Database(path); blocker.exec('BEGIN; SELECT * FROM store');
    try {
      let blocked = false;
      for (let seq = 0; seq < 500; seq++) {
        try { store.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]); }
        catch (error) { assert.match((error as Error).message, /EVENT_BACKPRESSURE/); blocked = true; break; }
      }
      assert.equal(blocked, true);
      assert.ok((await lstat(path + '-wal')).blocks * 512 <= 2 * 1024 * 1024);
      assert.ok(store.getEventState().pendingBytes <= 65_536);
    } finally { blocker.exec('ROLLBACK'); blocker.close(); }
  } finally { store.close(); }
  const secondDir = join(context.directory, 'blocked'); await mkdir(secondDir, {mode: 0o700});
  const second = new SQLiteStore({path: join(secondDir, 'state.sqlite'), identity: {storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: secondDir, revision: '0'}}) as typeof store;
  await writeFile(join(secondDir, 'events'), 'foreign sentinel', {mode: 0o600});
  const requestId = randomUUID();
  try {
    second.acceptOperation({requestId, action: 'start', payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(), targetInstanceId: null, acceptedAt: new Date().toISOString()});
    assert.ok(second.getOperation(requestId));
    assert.ok(second.getEventState().pendingBytes > 0);
    assert.throws(() => second.completeOperation(requestId, 'SUCCEEDED', new Date().toISOString(), null), /EVENT_BACKPRESSURE/);
    assert.equal(second.getOperation(requestId)?.outcome, 'IN_PROGRESS');
  } finally { second.close(); }
});

test('short writes are completed and zero-progress writes cannot be acknowledged', async () => {
  const {writeAll} = await loadContract<{writeAll(fd: number, bytes: Buffer, writer: (fd: number, bytes: Buffer, offset: number, length: number) => number): void}>('storage/event-journal.js', ['writeAll']);
  let written = '';
  writeAll(0, Buffer.from('durable-record'), (_fd, bytes, offset, length) => {
    const count = Math.min(3, length); written += bytes.subarray(offset, offset + count).toString(); return count;
  });
  assert.equal(written, 'durable-record');
  assert.throws(() => writeAll(0, Buffer.from('never-confirm'), () => 0), /PERSISTENCE_UNAVAILABLE/);
});

test('read-only pages ignore incomplete temporary retention metadata without modifying it', async t => {
  const {openJournal} = await journalModule();
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  openJournal({directory, storeId}).append([event(1)]);
  const temporary = join(directory, 'retention.next');
  await writeFile(temporary, '', {mode: 0o600});
  assert.equal(openJournal({directory, storeId, readonly: true}).list().records.length, 1);
  assert.equal((await readFile(temporary)).length, 0);
});

test('temporary excess is available only to reconcile an existing outbox, without raising steady limits', async t => {
  const {beforeDiagnosticMutation} = await import('../../src/storage/diagnostic-budget.js');
  const {initializeSchema} = await import('../../src/storage/schema.js');
  const context = await createTestContext(t);
  const database = new Database(join(context.directory, 'budget.sqlite'));
  try {
    initializeSchema(database, {storeId, schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: context.directory, revision: '0'});
    const directory = join(context.directory, 'events'); await mkdir(directory, {mode: 0o700});
    await writeFile(join(directory, 'segment-fixture.journal'), Buffer.alloc(41 * 1024 * 1024, 0x78), {mode: 0o600});
    assert.throws(() => beforeDiagnosticMutation(context.directory, database), /EVENT_BACKPRESSURE/);
    database.prepare('UPDATE event_outbox SET records=?').run(JSON.stringify([event(1)]));
    assert.doesNotThrow(() => beforeDiagnosticMutation(context.directory, database));
    database.prepare("UPDATE event_outbox SET records='[]'").run();
    assert.throws(() => beforeDiagnosticMutation(context.directory, database), /EVENT_BACKPRESSURE/);
  } finally { database.close(); }
});

test('a reader validates only the committed high-water prefix while another writer appends', async t => {
  const {openJournal, encodeEvent} = await journalModule();
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  openJournal({directory, storeId}).append([event(1)]);
  const pending = encodeEvent(event(2)); pending[45] = pending[45]! ^ 1;
  const file = join(directory, (await readdir(directory))[0]!); await appendFile(file, pending);
  const reader = openJournal({directory, storeId, readonly: true});
  assert.equal(reader.list({highWater: '1'}).records.length, 1);
  assert.throws(() => reader.list({highWater: '2'}), /STATE_CORRUPT/);
});

test('reopened journal computes the pending floor after refreshing existing history for an empty drain', async t => {
  const {openJournal} = await journalModule(), context = await createTestContext(t), directory = join(context.directory, 'events');
  const writer = openJournal({directory, storeId, segmentBytes: 4096, budgetBytes: 65536});
  for (let seq = 1; seq <= 30; seq++) writer.append([event(seq)]);
  const reopened = openJournal({directory, storeId, segmentBytes: 4096, budgetBytes: 8192});
  reopened.append([]);
  const page = reopened.list();
  assert.ok(BigInt(page.firstAvailable) > 1n); assert.equal(page.highWater, '30');
  let allocated = 0; for (const name of await readdir(directory)) allocated += (await lstat(join(directory, name))).blocks * 512;
  assert.ok(allocated <= 8192);
});
