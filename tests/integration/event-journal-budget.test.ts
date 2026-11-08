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
