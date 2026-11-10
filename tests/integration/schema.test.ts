import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeSchema, SCHEMA_VERSION } from '../../src/storage/schema.js';

test('schema rejects foreign resources and incompatible reinitialization atomically', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys = ON');
  try {
    const identity = { storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: SCHEMA_VERSION,
      ownerUid: 501, canonicalPath: '/private/tmp/isolated', revision: '0' };
    initializeSchema(database, identity);
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
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
    initializeSchema(database, {storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: SCHEMA_VERSION,
      ownerUid: process.getuid!(), canonicalPath: '/isolated-test', revision: '0'});
    assert.throws(() => database.prepare("INSERT INTO event_outbox VALUES(2,'[]')").run());
    assert.throws(() => database.prepare('UPDATE event_outbox SET records=?').run(JSON.stringify(['x'.repeat(65_536)])));
    database.prepare('UPDATE store SET next_event_seq=?').run(9_007_199_254_740_993n);
    database.defaultSafeIntegers(true);
    assert.equal((database.prepare('SELECT next_event_seq FROM store').get() as {next_event_seq: bigint}).next_event_seq.toString(), '9007199254740993');
    assert.equal((database.prepare('SELECT records FROM event_outbox').get() as {records: string}).records, '[]');
  } finally { database.close(); }
});

test('schema 3 enforces active identity dedup, retained tombstones and immutable terminal ledger', () => {
  const database = new Database(':memory:');
  database.pragma('foreign_keys=ON');
  try {
    initializeSchema(database, { storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: SCHEMA_VERSION,
      ownerUid: process.getuid!(), canonicalPath: '/isolated-test', revision: '0' });
    const first = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';
    const second = '234ce67a-4316-4b24-bff6-d13a97f47888';
    const add = database.prepare(`INSERT INTO projects(project_id,display_name,repository_key,repository_identity,
      reference_checkout,config_revision,created_at,updated_at) VALUES(?,'name',?,'{}','{}',1,'date','date')`);
    add.run(first, 'a'.repeat(64));
    assert.throws(() => add.run(second, 'a'.repeat(64)), /UNIQUE/);
    database.prepare('UPDATE projects SET removed_at=?,config_revision=2 WHERE project_id=?').run('removed', first);
    add.run(second, 'a'.repeat(64));
    assert.throws(() => database.prepare('DELETE FROM projects WHERE project_id=?').run(first), /INVALID_TRANSITION/);
    assert.throws(() => database.prepare('UPDATE projects SET removed_at=NULL WHERE project_id=?').run(first), /INVALID_TRANSITION/);
    assert.throws(() => database.prepare('UPDATE projects SET reference_checkout=? WHERE project_id=?').run('{"redirect":true}', second), /INVALID_TRANSITION/);
    database.prepare("INSERT INTO instances(instance_id,pid,generation,lifecycle,started_at) VALUES(?,1,'fixture','RUNNING','date')").run(second);
    const operationId = '345caeb6-a3ce-4fd2-8558-fce8486a6bc5';
    database.prepare("INSERT INTO request_catalog VALUES(?,'PROJECT','REMOVE',?)").run(operationId, 'b'.repeat(64));
    database.prepare(`INSERT INTO project_operations(request_id,action,payload_hash,canonical_intent,project_id,
      expected_config_revision,owning_instance_id,owner_uid,phase,outcome,accepted_at,deadline_at)
      VALUES(?,'REMOVE',?,'{}',?,1,?,?,'ACCEPTED','IN_PROGRESS','date','date')`)
      .run(operationId, 'b'.repeat(64), second, second, process.getuid!());
    assert.throws(() => database.prepare("UPDATE project_operations SET outcome='SUCCEEDED' WHERE request_id=?").run(operationId), /CHECK/);
    database.prepare("UPDATE project_operations SET phase='FINALIZED',outcome='BLOCKED',result='{}',completed_at='date' WHERE request_id=?").run(operationId);
    assert.throws(() => database.prepare("UPDATE project_operations SET outcome='IN_PROGRESS' WHERE request_id=?").run(operationId), /INVALID_TRANSITION/);
    assert.throws(() => database.prepare('DELETE FROM project_operations WHERE request_id=?').run(operationId), /INVALID_TRANSITION/);
    assert.throws(() => database.prepare('UPDATE request_catalog SET payload_hash=? WHERE request_id=?').run('c'.repeat(64), operationId), /INVALID_TRANSITION/);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
