import test from 'node:test';
import assert from 'node:assert/strict';
import { realpath, readdir, readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createTestContext } from '../fixtures/test-context.js';
import { createFoundationV2 } from '../fixtures/foundation-schema-v2.js';
import { loadContract } from '../fixtures/load-contract.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import type { ArchivePaths, LeaseHandle } from '../../src/ports/platform.js';
import { makeDeadline, systemClock, type Deadline } from '../../src/ports/clock.js';
import { initializeSchema, SCHEMA_VERSION } from '../../src/storage/schema.js';
import { openStorage } from '../../src/storage/worker.js';

interface UpgradeOptions {
  paths: ArchivePaths; controlLease: LeaseHandle; daemonLease: LeaseHandle; deadline: Deadline;
  checkpoint?: (point: string) => void;
}
const upgrade = () => loadContract<{ upgradeRegistry(options: UpgradeOptions): void }>('storage/registry-upgrade.js', ['upgradeRegistry']);
const tables = ['store', 'instances', 'operations', 'controller_attempts', 'launch_tickets', 'managed_resources', 'event_outbox', 'journal_metadata'];
function snapshot(path: string) {
  const database = new Database(path, { readonly: true });
  try { return Object.fromEntries(tables.map(table => [table, database.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])); }
  finally { database.close(); }
}
async function fixture(t: Parameters<typeof createTestContext>[0]) {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const paths = (await createPlatformPaths().resolveArchive(directory, 'write'))!;
  const archive = createFoundationV2(directory);
  const leases = createOwnershipLease();
  const control = leases.tryAcquire(paths.controlLeaseFile, 'control');
  const daemon = leases.tryAcquire(paths.daemonLeaseFile, 'daemon');
  assert.equal(control.status, 'HELD'); assert.equal(daemon.status, 'HELD');
  if (control.status !== 'HELD' || daemon.status !== 'HELD') throw new Error('owned fixture lease unavailable');
  t.after(() => { daemon.handle.release(); control.handle.release(); });
  return { context, paths, archive, options: { paths, controlLease: control.handle, daemonLease: daemon.handle, deadline: makeDeadline(systemClock, 2_000) } };
}

test('fresh schema includes registry v3, with separate registry pending and active identity uniqueness', () => {
  assert.ok(SCHEMA_VERSION >= 3, 'required registry schema has not been introduced');
  const database = new Database(':memory:');
  try {
    initializeSchema(database, { storeId: randomUUID(), ownerUid: process.getuid!(), canonicalPath: '/owned-fixture', schemaVersion: SCHEMA_VERSION, revision: '0' });
    assert.equal(database.pragma('user_version', { simple: true }), SCHEMA_VERSION);
    for (const table of ['projects', 'project_observations', 'project_operations', 'request_catalog', 'registry_metadata']) {
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
    }
    const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='projects' AND sql IS NOT NULL").all() as Array<{ sql: string }>;
    assert.ok(indexes.some(row => /UNIQUE/i.test(row.sql) && /removed_at IS NULL/i.test(row.sql)));
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});

test('exclusive 2→3 upgrade preserves every Foundation row, cursor, outbox and lifecycle hash', async t => {
  const api = await upgrade();
  const f = await fixture(t);
  const before = snapshot(f.archive.path);
  api.upgradeRegistry(f.options);
  const after = snapshot(f.archive.path);
  (before.store as Array<{ schema_version: number }>)[0]!.schema_version = 3;
  assert.deepEqual(after, before);
  const database = new Database(f.archive.path, { readonly: true });
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 3);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.deepEqual(database.prepare('SELECT * FROM request_catalog').get(), {
      request_id: f.archive.requestId, scope: 'LIFECYCLE', action: 'start', payload_hash: 'a'.repeat(64),
    });
  } finally { database.close(); }
  api.upgradeRegistry(f.options);
  assert.deepEqual(snapshot(f.archive.path), after);
});

test('upgrade is not a readonly query and requires matching ownership and both exclusive lease scopes', async t => {
  const api = await upgrade();
  const f = await fixture(t);
  const before = snapshot(f.archive.path);
  for (const options of [
    { ...f.options, controlLease: f.options.daemonLease },
    { ...f.options, daemonLease: f.options.controlLease },
    { ...f.options, paths: { ...f.paths, ownerUid: process.getuid!() + 1 } },
    { ...f.options, paths: { ...f.paths, directory: '/foreign/archive' } },
  ]) assert.throws(() => api.upgradeRegistry(options), /UNAUTHORIZED|BLOCKED|STATE_INCOMPATIBLE/);
  assert.deepEqual(snapshot(f.archive.path), before);
  const names = await readdir(f.paths.directory);
  const offline = await openStorage({ path: f.archive.path, readonly: true });
  try {
    assert.equal((await offline.readSnapshot())?.store.schemaVersion, 2);
  } finally { await offline.close(); }
  assert.deepEqual(await readdir(f.paths.directory), names);
  assert.deepEqual(snapshot(f.archive.path), before);
});

test('failure injection before commit rolls back FULL/IO completely; postcommit remains a valid schema 3', async t => {
  const api = await upgrade();
  for (const code of ['SQLITE_FULL', 'SQLITE_IOERR', 'SQLITE_BUSY']) {
    await t.test(code, async sub => {
      const f = await fixture(sub);
      const before = snapshot(f.archive.path);
      assert.throws(() => api.upgradeRegistry({ ...f.options, checkpoint: point => {
        if (point === 'registry.upgrade.beforeCommit') throw Object.assign(new Error(code), { code });
      } }), /PERSISTENCE_UNAVAILABLE|EVENT_BACKPRESSURE|DEADLINE_EXCEEDED/);
      assert.deepEqual(snapshot(f.archive.path), before);
      const database = new Database(f.archive.path, { readonly: true });
      try { assert.equal(database.pragma('user_version', { simple: true }), 2); assert.deepEqual(database.pragma('foreign_key_check'), []); }
      finally { database.close(); }
    });
  }
  const f = await fixture(t);
  assert.throws(() => api.upgradeRegistry({ ...f.options, checkpoint: point => {
    if (point === 'registry.upgrade.committed') throw new Error('owned-postcommit-fault');
  } }), /owned-postcommit-fault|PERSISTENCE_UNAVAILABLE/);
  const database = new Database(f.archive.path, { readonly: true });
  try { assert.equal(database.pragma('user_version', { simple: true }), 3); assert.deepEqual(database.pragma('foreign_key_check'), []); }
  finally { database.close(); }
});

test('unknown versions, expired budget and a conflicting live writer never trigger migration', async t => {
  const api = await upgrade();
  const f = await fixture(t);
  assert.throws(() => api.upgradeRegistry({ ...f.options, deadline: makeDeadline(systemClock, 0) }), /DEADLINE_EXCEEDED/);
  const writer = new Database(f.archive.path);
  writer.exec('BEGIN IMMEDIATE');
  try {
    assert.throws(() => api.upgradeRegistry({ ...f.options, deadline: makeDeadline(systemClock, 100) }), /BLOCKED|DEADLINE_EXCEEDED|PERSISTENCE_UNAVAILABLE/);
  } finally { writer.exec('ROLLBACK'); writer.close(); }
  const database = new Database(f.archive.path);
  database.pragma('user_version=999'); database.close();
  const bytes = await readFile(f.archive.path);
  assert.throws(() => api.upgradeRegistry(f.options), /STATE_INCOMPATIBLE/);
  assert.deepEqual(await readFile(f.archive.path), bytes);
});

test('owned process crash pre/post upgrade commit leaves one complete valid schema', async t => {
  await upgrade();
  for (const point of ['registry.upgrade.beforeCommit', 'registry.upgrade.committed']) {
    await t.test(point, async sub => {
      const context = await createTestContext(sub);
      const directory = await realpath(context.directory);
      const archive = createFoundationV2(directory);
      const before = snapshot(archive.path);
      const child = context.spawnNode([new URL('../fixtures/project-upgrade-owner.js', import.meta.url).pathname, directory, point]);
      const exited = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
      const reached = await new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 3_000);
        child.on('message', message => {
          if ((message as { point?: string }).point === point) { clearTimeout(timer); resolve(true); }
        });
        child.once('exit', () => { clearTimeout(timer); resolve(false); });
      });
      if (reached) child.kill('SIGKILL');
      await exited;
      assert.equal(reached, true, 'fault checkpoint must actually be reached');
      const after = snapshot(archive.path);
      const expected = point.endsWith('beforeCommit') ? 2 : 3;
      (before.store as Array<{ schema_version: number }>)[0]!.schema_version = expected;
      assert.deepEqual(after, before);
      const database = new Database(archive.path);
      try { assert.equal(database.pragma('user_version', { simple: true }), expected); assert.equal(database.pragma('integrity_check', { simple: true }), 'ok'); assert.deepEqual(database.pragma('foreign_key_check'), []); }
      finally { database.close(); }
    });
  }
});
