import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeSchema } from '../../src/storage/schema.js';

test('schema rejects foreign resources and incompatible reinitialization atomically', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    const identity = { storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: 1,
      ownerUid: 501, canonicalPath: '/private/tmp/isolated', revision: '0' };
    initializeSchema(database, identity);
    assert.equal(database.pragma('user_version', { simple: true }), 1);
    assert.throws(() => initializeSchema(database, identity), /STATE_INCOMPATIBLE/);
    assert.equal((database.prepare('SELECT store_id FROM store').get() as {store_id: string}).store_id, identity.storeId);
    assert.throws(() => database.prepare('INSERT INTO operations(request_id,action,payload_hash,owner_uid,phase,outcome,accepted_at) VALUES (?,?,?,?,?,?,?)')
      .run('r', 'shell', 'x'.repeat(64), 501, 'ACCEPTED', 'IN_PROGRESS', '2026-11-08'), /CHECK/);
    assert.equal((database.prepare('SELECT count(*) AS count FROM operations').get() as {count: number}).count, 0);
  } finally { database.close(); }
});
