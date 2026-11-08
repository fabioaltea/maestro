import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/storage/schema.js';

test('schema rejects foreign resources and incompatible reinitialization atomically', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    const identity = { storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: 2,
      ownerUid: 501, canonicalPath: '/private/tmp/isolated', revision: '0' };
    initializeSchema(database, identity);
    assert.equal(database.pragma('user_version', { simple: true }), 2);
    assert.throws(() => initializeSchema(database, identity), /STATE_INCOMPATIBLE/);
    assert.equal((database.prepare('SELECT store_id FROM store').get() as {store_id: string}).store_id, identity.storeId);
    assert.throws(() => database.prepare('INSERT INTO operations(request_id,action,payload_hash,owner_uid,phase,outcome,accepted_at) VALUES (?,?,?,?,?,?,?)')
      .run('r', 'shell', 'x'.repeat(64), 501, 'ACCEPTED', 'IN_PROGRESS', '2026-11-08'), /CHECK/);
    assert.equal((database.prepare('SELECT count(*) AS count FROM operations').get() as {count: number}).count, 0);
  } finally { database.close(); }
});

test('event outbox has one bounded reusable row and exact integer metadata', () => {
  const database = new Database(':memory:');
  try {
    initializeSchema(database, {storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: 2,
      ownerUid: process.getuid!(), canonicalPath: '/isolated-test', revision: '0'});
    assert.throws(() => database.prepare("INSERT INTO event_outbox VALUES(2,'[]')").run());
    assert.throws(() => database.prepare('UPDATE event_outbox SET records=?').run(JSON.stringify(['x'.repeat(65_536)])));
    database.prepare('UPDATE store SET next_event_seq=?').run(9_007_199_254_740_993n);
    database.defaultSafeIntegers(true);
    assert.equal((database.prepare('SELECT next_event_seq FROM store').get() as {next_event_seq: bigint}).next_event_seq.toString(), '9007199254740993');
    assert.equal((database.prepare('SELECT records FROM event_outbox').get() as {records: string}).records, '[]');
  } finally { database.close(); }
});
