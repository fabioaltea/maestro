import Database from './sqlite-driver.js';
import { lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { ArchivePaths, LeaseHandle } from '../ports/platform.js';
import type { Deadline } from '../ports/clock.js';
import { REGISTRY_SCHEMA_V3_SQL, REGISTRY_SCHEMA_VERSION, SCHEMA_VERSION, STORE_SCHEMA_V3_SQL } from './schema.js';

export interface RegistryUpgradeOptions {
  readonly paths: ArchivePaths;
  readonly controlLease: LeaseHandle;
  readonly daemonLease: LeaseHandle;
  readonly deadline: Deadline;
  readonly checkpoint?: (point: string) => void;
}
function validateArchive(paths: ArchivePaths): void {
  const directory = lstatSync(paths.directory);
  const file = lstatSync(paths.stateFile);
  if (paths.ownerUid !== process.getuid!() || realpathSync(paths.directory) !== paths.directory
    || !directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== paths.ownerUid || (directory.mode & 0o777) !== 0o700
    || paths.stateFile !== join(paths.directory, 'state.sqlite') || !file.isFile() || file.isSymbolicLink()
    || file.nlink !== 1 || file.uid !== paths.ownerUid || (file.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
}
function version(database: Database.Database, paths: ArchivePaths): number {
  const version = database.pragma('user_version', { simple: true });
  if (![2, REGISTRY_SCHEMA_VERSION, 4, 5, 6, SCHEMA_VERSION].includes(Number(version))) throw new Error('STATE_INCOMPATIBLE');
  if (database.pragma('quick_check', { simple: true }) !== 'ok'
    || (database.pragma('foreign_key_check') as unknown[]).length) throw new Error('STATE_CORRUPT');
  const store = database.prepare('SELECT schema_version,owner_uid,canonical_path FROM store WHERE singleton=1').get() as {
    schema_version: number; owner_uid: number; canonical_path: string;
  } | undefined;
  if (!store || store.schema_version !== version) throw new Error('STATE_INCOMPATIBLE');
  if (store.owner_uid !== paths.ownerUid || store.canonical_path !== paths.directory) throw new Error('UNAUTHORIZED');
  return version;
}
/** Read-only preflight; never opens a writer, acquires leases or creates an archive. */
export function needsRegistryUpgrade(paths: ArchivePaths): boolean {
  validateArchive(paths);
  const database = new Database(paths.stateFile, { readonly: true, fileMustExist: true, timeout: 50 });
  try { return version(database, paths) === 2; } finally { database.close(); }
}
/** Trusted composition passes the two live platform lease handles, held throughout commit. */
export function upgradeRegistry(options: RegistryUpgradeOptions): void {
  const { paths, deadline, controlLease, daemonLease } = options;
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  if (controlLease.scope !== 'control' || daemonLease.scope !== 'daemon'
    || controlLease.path !== paths.controlLeaseFile || daemonLease.path !== paths.daemonLeaseFile
    || paths.controlLeaseFile !== join(paths.directory, 'control-lease.sqlite')
    || paths.daemonLeaseFile !== join(paths.directory, 'daemon-lease.sqlite')) throw new Error('BLOCKED');
  validateArchive(paths);
  const before = lstatSync(paths.stateFile, { bigint: true });
  let database: Database.Database | undefined;
  try {
    database = new Database(paths.stateFile, { readonly: true, fileMustExist: true, timeout: 50 });
    const initialVersion = version(database, paths);
    if (initialVersion >= REGISTRY_SCHEMA_VERSION) {
      for (const table of ['projects', 'project_observations', 'project_operations', 'request_catalog', 'registry_metadata']) {
        if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('STATE_CORRUPT');
      }
      return;
    }
    database.close(); database = undefined;
    if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
    options.checkpoint?.('registry.upgrade.preflight');
    validateArchive(paths);
    const current = lstatSync(paths.stateFile, { bigint: true });
    if (before.dev !== current.dev || before.ino !== current.ino || before.birthtimeNs !== current.birthtimeNs) throw new Error('BLOCKED');
    database = new Database(paths.stateFile, { fileMustExist: true, timeout: Math.min(50, Math.floor(deadline.remainingMs())) });
    database.pragma('foreign_keys=ON');
    database.pragma('synchronous=FULL');
    database.transaction(() => {
      if (version(database!, paths) !== 2) throw new Error('STATE_INCOMPATIBLE');
      const allowedTables = new Set(['store', 'instances', 'operations', 'controller_attempts', 'launch_tickets', 'managed_resources', 'event_outbox', 'journal_metadata']);
      const tables = database!.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
      if (tables.length !== allowedTables.size || tables.some(row => !allowedTables.has(row.name))) throw new Error('STATE_INCOMPATIBLE');
      // Qualified v2 has store → instances and no reverse reference to store.
      // Reject an unknown dependency rather than disabling foreign keys for it.
      for (const table of allowedTables) {
        const links = database!.pragma(`foreign_key_list(${table})`) as { table: string }[];
        if (links.some(link => link.table === 'store')) throw new Error('STATE_INCOMPATIBLE');
      }
      database!.exec(STORE_SCHEMA_V3_SQL.replace('CREATE TABLE store (', 'CREATE TABLE store_v3 ('));
      database!.exec(`INSERT INTO store_v3(singleton,store_id,schema_version,owner_uid,canonical_path,revision,next_event_seq,current_instance_id)
        SELECT singleton,store_id,3,owner_uid,canonical_path,revision,next_event_seq,current_instance_id FROM store`);
      database!.exec('DROP TABLE store');
      database!.exec('ALTER TABLE store_v3 RENAME TO store');
      database!.exec(REGISTRY_SCHEMA_V3_SQL);
      database!.exec("INSERT INTO request_catalog(request_id,scope,action,payload_hash) SELECT request_id,'LIFECYCLE',action,payload_hash FROM operations");
      database!.pragma(`user_version=${REGISTRY_SCHEMA_VERSION}`);
      if (database!.pragma('integrity_check', { simple: true }) !== 'ok'
        || (database!.pragma('foreign_key_check') as unknown[]).length) throw new Error('STATE_CORRUPT');
      if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
      options.checkpoint?.('registry.upgrade.beforeCommit');
    }).immediate();
    options.checkpoint?.('registry.upgrade.committed');
  } catch (error) {
    if (error instanceof Error && ['UNAUTHORIZED', 'BLOCKED', 'STATE_CORRUPT', 'STATE_INCOMPATIBLE', 'DEADLINE_EXCEEDED'].includes(error.message)) throw error;
    throw new Error('PERSISTENCE_UNAVAILABLE');
  } finally { database?.close(); }
}
