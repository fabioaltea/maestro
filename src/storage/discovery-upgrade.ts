import Database from './sqlite-driver.js';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DISCOVERY_SCHEMA_SQL, DISCOVERY_TABLES } from './discovery-schema.js';
import { STORE_SCHEMA_SQL } from './schema.js';
import { upgradeRegistry, type RegistryUpgradeOptions } from './registry-upgrade.js';
import type { ArchivePaths } from '../ports/platform.js';

function validate(paths: ArchivePaths) {
  const directory = lstatSync(paths.directory), file = lstatSync(paths.stateFile);
  if (paths.ownerUid !== process.getuid!() || realpathSync(paths.directory) !== paths.directory || !directory.isDirectory()
    || directory.isSymbolicLink() || directory.uid !== paths.ownerUid || (directory.mode & 0o777) !== 0o700
    || paths.stateFile !== join(paths.directory, 'state.sqlite') || !file.isFile() || file.isSymbolicLink()
    || file.nlink !== 1 || file.uid !== paths.ownerUid || (file.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
}
function version(database: Database.Database, paths: ArchivePaths): number {
  const value = Number(database.pragma('user_version', { simple: true }));
  if (![2, 3, 4, 5].includes(value)) throw new Error('STATE_INCOMPATIBLE');
  if (database.pragma('quick_check', { simple: true }) !== 'ok' || (database.pragma('foreign_key_check') as unknown[]).length) throw new Error('STATE_CORRUPT');
  const row = database.prepare('SELECT schema_version,owner_uid,canonical_path FROM store WHERE singleton=1').get() as {
    schema_version: number; owner_uid: number; canonical_path: string;
  } | undefined;
  if (!row || row.schema_version !== value) throw new Error('STATE_INCOMPATIBLE');
  if (row.owner_uid !== paths.ownerUid || row.canonical_path !== paths.directory) throw new Error('UNAUTHORIZED');
  return value;
}
export function needsDiscoveryUpgrade(paths: ArchivePaths): boolean {
  validate(paths);
  const database = new Database(paths.stateFile, { readonly: true, fileMustExist: true, timeout: 50 });
  try { return version(database, paths) < 4; } finally { database.close(); }
}
/** Only explicit controller start calls this while holding both ownership leases. */
export function upgradeDiscovery(options: RegistryUpgradeOptions): void {
  const { paths, controlLease, daemonLease, deadline } = options;
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  if (controlLease.scope !== 'control' || daemonLease.scope !== 'daemon'
    || controlLease.path !== join(paths.directory, 'control-lease.sqlite') || daemonLease.path !== join(paths.directory, 'daemon-lease.sqlite')
    || paths.controlLeaseFile !== controlLease.path || paths.daemonLeaseFile !== daemonLease.path) throw new Error('BLOCKED');
  validate(paths);
  // Keep the proven2→3 migration fixed at3; a crash between steps leaves readable3.
  upgradeRegistry(options);
  validate(paths); const before = lstatSync(paths.stateFile, { bigint: true });
  let database: Database.Database | undefined;
  try {
    database = new Database(paths.stateFile, { readonly: true, fileMustExist: true, timeout: 50 });
    if (version(database, paths) >= 4) {
      for (const name of DISCOVERY_TABLES) {
        if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) throw new Error('STATE_CORRUPT');
      }
      return;
    }
    database.close(); database = undefined;
    options.checkpoint?.('discovery.upgrade.preflight');
    validate(paths); const current = lstatSync(paths.stateFile, { bigint: true });
    if (before.dev !== current.dev || before.ino !== current.ino || before.birthtimeNs !== current.birthtimeNs) throw new Error('BLOCKED');
    if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
    database = new Database(paths.stateFile, { fileMustExist: true, timeout: Math.min(50, Math.floor(deadline.remainingMs())) });
    database.pragma('foreign_keys=ON'); database.pragma('synchronous=FULL');
    database.transaction(() => {
      if (version(database!, paths) !== 3) throw new Error('STATE_INCOMPATIBLE');
      const links = database!.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      const known = new Set(['store', 'instances', 'operations', 'controller_attempts', 'launch_tickets', 'managed_resources', 'event_outbox', 'journal_metadata', 'request_catalog', 'registry_metadata', 'projects', 'project_operations', 'project_observations']);
      if (links.length !== known.size || links.some(({ name }) => !known.has(name))) throw new Error('STATE_INCOMPATIBLE');
      for (const { name } of links) {
        if (!/^[a-z_]+$/.test(name)) throw new Error('STATE_INCOMPATIBLE');
        if ((database!.pragma(`foreign_key_list(${name})`) as { table: string }[]).some(row => row.table === 'store')) throw new Error('STATE_INCOMPATIBLE');
      }
      database!.exec(STORE_SCHEMA_SQL.replace('CREATE TABLE store (', 'CREATE TABLE store_v4 ('));
      database!.exec(`INSERT INTO store_v4 SELECT singleton,store_id,4,owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store`);
      database!.exec('DROP TABLE store'); database!.exec('ALTER TABLE store_v4 RENAME TO store');
      database!.exec(DISCOVERY_SCHEMA_SQL); database!.pragma('user_version=4');
      if (database!.pragma('integrity_check', { simple: true }) !== 'ok' || (database!.pragma('foreign_key_check') as unknown[]).length) throw new Error('STATE_CORRUPT');
      if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
      options.checkpoint?.('discovery.upgrade.beforeCommit');
    }).immediate();
    options.checkpoint?.('discovery.upgrade.committed');
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'BLOCKED', 'STATE_CORRUPT', 'STATE_INCOMPATIBLE', 'DEADLINE_EXCEEDED'].includes(error.message)) throw error;
    throw new Error('PERSISTENCE_UNAVAILABLE');
  } finally { database?.close(); }
}
