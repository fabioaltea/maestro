import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { createTestContext } from '../fixtures/test-context.js';
import { createFoundationV2 } from '../fixtures/foundation-schema-v2.js';
import { createRegistryV3 } from '../fixtures/discovery-schema-v3.js';
import { loadContract } from '../fixtures/load-contract.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { RegistryUpgradeOptions } from '../../src/storage/registry-upgrade.js';
import { initializeSchema, SCHEMA_VERSION } from '../../src/storage/schema.js';
import { openStorage } from '../../src/storage/worker.js';
const upgrade = () => loadContract<{ upgradeDiscovery(options: RegistryUpgradeOptions): void; needsDiscoveryUpgrade(paths: RegistryUpgradeOptions['paths']): boolean }>('storage/discovery-upgrade.js', ['upgradeDiscovery', 'needsDiscoveryUpgrade']);
const snapshot = (path: string) => {
  const database = new Database(path, { readonly: true });
  try {
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'discovery_%' AND name<>'discoveries' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.map(({ name }) => [name, database.prepare(`SELECT * FROM ${name} ORDER BY 1`).all()]));
  } finally { database.close(); }
};
async function fixture(t: Parameters<typeof createTestContext>[0], version = 3) {
  const context = await createTestContext(t); const directory = await realpath(context.directory);
  const archive = version === 2 ? createFoundationV2(directory) : createRegistryV3(directory);
  const paths = (await createPlatformPaths().resolveArchive(directory, 'write'))!;
  const leases = createOwnershipLease();
  const control = leases.tryAcquire(paths.controlLeaseFile, 'control'), daemon = leases.tryAcquire(paths.daemonLeaseFile, 'daemon');
  if (control.status !== 'HELD' || daemon.status !== 'HELD') throw new Error('OWNED_FIXTURE_LEASE_UNAVAILABLE');
  t.after(() => { daemon.handle.release(); control.handle.release(); });
  return { context, archive, options: { paths, controlLease: control.handle, daemonLease: daemon.handle, deadline: makeDeadline(systemClock, 3000) } };
}
test('fresh current schema retains Discovery and leaves managed_resources scoped only to Foundation', () => {
  assert.equal(SCHEMA_VERSION, 5);
  const database = new Database(':memory:');
  try {
    initializeSchema(database, { storeId: randomUUID(), ownerUid: process.getuid!(), canonicalPath: '/fixture', schemaVersion: SCHEMA_VERSION, revision: '0' });
    for (const table of ['discoveries', 'discovery_provider', 'discovery_snapshots', 'discovery_slot', 'discovery_runs', 'discovery_processes', 'discovery_operations', 'discovery_grants', 'discovery_questions', 'discovery_answers', 'discovery_revisions', 'discovery_approvals', 'discovery_output', 'discovery_artifacts', 'discovery_budget']) {
      assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), table);
    }
    const row = database.prepare("SELECT sql FROM sqlite_master WHERE name='managed_resources'").get() as { sql: string };
    assert.match(row.sql, /policy_scope = 'foundation'/);
    assert.deepEqual(database.pragma('foreign_key_check'), []);
  } finally { database.close(); }
});
test('exclusive3→4 preserves Foundation/registry data, identity, journal and readonly reader support', async t => {
  const api = await upgrade(); const f = await fixture(t); const before = snapshot(f.archive.path);
  const bytes = await readFile(f.archive.path), names = await readdir(f.options.paths.directory);
  assert.equal(api.needsDiscoveryUpgrade(f.options.paths), true);
  const reader = await openStorage({ path: f.archive.path, readonly: true });
  try { assert.equal((await reader.readSnapshot())?.store.schemaVersion, 3); } finally { await reader.close(); }
  assert.deepEqual(await readFile(f.archive.path), bytes); assert.deepEqual(await readdir(f.options.paths.directory), names);
  api.upgradeDiscovery(f.options);
  (before.store as { schema_version: number }[])[0]!.schema_version = 4;
  assert.deepEqual(snapshot(f.archive.path), before);
  assert.equal(api.needsDiscoveryUpgrade(f.options.paths), false);
  api.upgradeDiscovery(f.options); assert.deepEqual(snapshot(f.archive.path), before);
  const upgraded = await openStorage({ path: f.archive.path, readonly: true });
  try { assert.equal((await upgraded.readSnapshot())?.store.schemaVersion, 4); } finally { await upgraded.close(); }
});
test('2→3→4 keeps the historical migration fixed at3 before Discovery upgrade', async t => {
  const api = await upgrade(); const f = await fixture(t, 2); const before = snapshot(f.archive.path);
  api.upgradeDiscovery(f.options);
  const after = snapshot(f.archive.path);
  (before.store as { schema_version: number }[])[0]!.schema_version = 4;
  for (const key of Object.keys(before)) assert.deepEqual(after[key], before[key]);
  const database = new Database(f.archive.path, { readonly: true });
  try {
    assert.equal(database.pragma('user_version', { simple: true }), 4);
    assert.equal(database.pragma('integrity_check', { simple: true }), 'ok');
    assert.deepEqual(database.pragma('foreign_key_check'), []);
    assert.equal((database.prepare('SELECT scope FROM request_catalog WHERE request_id=?').get(f.archive.requestId) as { scope: string }).scope, 'LIFECYCLE');
  } finally { database.close(); }
});
test('upgrade requires current owner, both lease scopes, deadline and no conflicting writer', async t => {
  const api = await upgrade(); const f = await fixture(t); const before = snapshot(f.archive.path);
  assert.throws(() => api.upgradeDiscovery({ ...f.options, controlLease: f.options.daemonLease }), /BLOCKED/);
  assert.throws(() => api.upgradeDiscovery({ ...f.options, deadline: makeDeadline(systemClock, 0) }), /DEADLINE_EXCEEDED/);
  const writer = new Database(f.archive.path); writer.exec('BEGIN IMMEDIATE');
  try { assert.throws(() => api.upgradeDiscovery(f.options), /PERSISTENCE_UNAVAILABLE|BLOCKED|DEADLINE_EXCEEDED/); }
  finally { writer.exec('ROLLBACK'); writer.close(); }
  assert.deepEqual(snapshot(f.archive.path), before);
});
test('fault before commit rolls back; fault after commit leaves complete schema4', async t => {
  const api = await upgrade();
  for (const point of ['discovery.upgrade.beforeCommit', 'discovery.upgrade.committed']) {
    const f = await fixture(t); const before = snapshot(f.archive.path);
    assert.throws(() => api.upgradeDiscovery({ ...f.options, checkpoint: current => { if (current === point) throw new Error('OWNED_FAULT'); } }));
    const expected = point.endsWith('committed') ? 4 : 3;
    (before.store as { schema_version: number }[])[0]!.schema_version = expected;
    assert.deepEqual(snapshot(f.archive.path), before);
    const database = new Database(f.archive.path, { readonly: true });
    try { assert.equal(database.pragma('user_version', { simple: true }), expected); assert.deepEqual(database.pragma('foreign_key_check'), []); }
    finally { database.close(); }
  }
});
test('owned SIGKILL at pre/post commit leaves one valid complete schema', async t => {
  await upgrade();
  for (const point of ['discovery.upgrade.beforeCommit', 'discovery.upgrade.committed']) {
    const context = await createTestContext(t); const directory = await realpath(context.directory);
    const archive = createRegistryV3(directory); const before = snapshot(archive.path);
    const child = context.spawnNode([new URL('../fixtures/discovery-upgrade-owner.js', import.meta.url).pathname, directory, point]);
    const exited = new Promise<void>((resolve, reject) => { child.once('exit', () => resolve()); child.once('error', reject); });
    const reached = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 4000);
      child.once('message', () => { clearTimeout(timer); resolve(true); });
      child.once('exit', () => { clearTimeout(timer); resolve(false); });
    });
    if (reached) child.kill('SIGKILL'); await exited;
    assert.equal(reached, true, 'OWNED_CRASH_CHECKPOINT_NOT_REACHED');
    (before.store as { schema_version: number }[])[0]!.schema_version = point.endsWith('committed') ? 4 : 3;
    assert.deepEqual(snapshot(archive.path), before);
  }
});

test('upgrade rejects unknown schema3 tables and a schema4 missing any Discovery table', async t => {
  const api = await upgrade(); const unknown = await fixture(t);
  const extra = new Database(unknown.archive.path); extra.exec('CREATE TABLE unexpected_private_table(value TEXT)'); extra.close();
  const before = await readFile(unknown.archive.path);
  assert.throws(() => api.upgradeDiscovery(unknown.options), /STATE_INCOMPATIBLE/);
  assert.deepEqual(await readFile(unknown.archive.path), before);
  const broken = await fixture(t); api.upgradeDiscovery(broken.options);
  const database = new Database(broken.archive.path); database.exec('DROP TABLE discovery_approvals'); database.close();
  assert.throws(() => api.upgradeDiscovery(broken.options), /STATE_CORRUPT/);
  await assert.rejects(openStorage({ path: broken.archive.path, readonly: true }), /STATE_CORRUPT/);
});
