import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { createTestContext } from '../fixtures/test-context.js';

test('initial native platform and SQLite durability primitives are available', async (t) => {
  assert.equal(process.platform, 'darwin', 'Initial platform requires macOS');
  assert.equal(process.arch, 'arm64', 'Initial platform requires arm64');
  const version = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  assert.match(version, /^26\.3(?:\.|$)/, 'Validate another OS baseline before supporting it');
  const context = await createTestContext(t);
  const database = new Database(join(context.directory, 'state.sqlite'));
  t.after(() => database.close());
  assert.equal(database.pragma('journal_mode = WAL', { simple: true }), 'wal');
  database.pragma('synchronous = FULL');
  database.pragma('foreign_keys = ON');
  database.pragma('busy_timeout = 50');
  assert.equal(database.pragma('synchronous', { simple: true }), 2);
  assert.equal(database.pragma('foreign_keys', { simple: true }), 1);
  database.exec('CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id))');
  assert.throws(() => database.prepare('INSERT INTO child VALUES (?)').run(99), /FOREIGN KEY/);
  database.transaction(() => database.prepare('INSERT INTO parent VALUES (?)').run(1))();
  assert.equal((database.prepare('SELECT count(*) AS count FROM parent').get() as { count: number }).count, 1);
  const checkpoint = database.pragma('wal_checkpoint(TRUNCATE)') as { busy: number }[];
  assert.equal(checkpoint[0]?.busy, 0);
  assert.equal(database.pragma('quick_check', { simple: true }), 'ok');
});

test('BEGIN IMMEDIATE excludes another process and preserves the lease inode', async (t) => {
  const context = await createTestContext(t);
  const file = join(context.directory, 'lease.sqlite');
  const owner = new Database(file);
  owner.exec('CREATE TABLE lease(id INTEGER PRIMARY KEY)');
  const inode = (await stat(file)).ino;
  owner.exec('BEGIN IMMEDIATE');
  const script = `
    import Database from 'better-sqlite3';
    const database = new Database(process.argv[1], { timeout: 0 });
    try { database.exec('BEGIN IMMEDIATE'); console.log('HELD'); }
    catch (error) { console.log(error.code); }
    finally { database.close(); }
  `;
  const attempt = () => spawnSync(process.execPath, ['--input-type=module', '-e', script, file], { encoding: 'utf8' });
  try {
    const blocked = attempt();
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.equal(blocked.stdout.trim(), 'SQLITE_BUSY');
  } finally { owner.close(); }
  const released = attempt();
  assert.equal(released.status, 0, released.stderr);
  assert.equal(released.stdout.trim(), 'HELD');
  assert.equal((await stat(file)).ino, inode);
});

test('process termination rolls back uncommitted state and releases native locks', async (t) => {
  const context = await createTestContext(t);
  const file = join(context.directory, 'interrupted.sqlite');
  const initial = new Database(file);
  initial.exec('CREATE TABLE state(value TEXT)');
  initial.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import Database from 'better-sqlite3';
    const database = new Database(process.argv[1]);
    database.exec("BEGIN IMMEDIATE; INSERT INTO state VALUES ('unconfirmed')");
    process.exit(19);
  `, file], { encoding: 'utf8' });
  assert.equal(child.status, 19, child.stderr);
  const recovered = new Database(file);
  try {
    assert.deepEqual(recovered.prepare('SELECT * FROM state').all(), []);
    recovered.exec('BEGIN IMMEDIATE');
    assert.equal(recovered.pragma('quick_check', { simple: true }), 'ok');
  } finally { recovered.close(); }
});
