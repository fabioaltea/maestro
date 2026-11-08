import Database from 'better-sqlite3';
import { constants, closeSync, existsSync, lstatSync, openSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { initializeSchema, SCHEMA_VERSION } from './schema.js';
import { requireUuid } from '../domain/identifiers.js';
import { transition, type Lifecycle, type Outcome } from '../domain/states.js';
import type { SafeError } from '../domain/errors.js';
import type { AcceptOperation, ControlPhase, InstanceRecord, LaunchTicket, ManagedResource, OperationRecord,
  StoreIdentity, StoreSnapshot } from '../ports/storage.js';

export interface StorageOptions { readonly path: string; readonly readonly?: boolean; readonly identity?: StoreIdentity }
type Row = Record<string, string | number | bigint | null>;
const parseError = (raw: Row[string] | undefined): SafeError | null => typeof raw === 'string' ? JSON.parse(raw) as SafeError : null;

export class SQLiteStore {
  private database: Database.Database | null = null;
  private readonly readOnly: boolean;
  constructor(options: StorageOptions) {
    this.readOnly = options.readonly ?? false;
    if (!isAbsolute(options.path)) throw new Error('INVALID_REQUEST');
    const existed = existsSync(options.path);
    if (!existed && this.readOnly) return;
    const parent = lstatSync(dirname(options.path));
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid!()
      || (parent.mode & 0o777) !== 0o700) throw new Error('UNAUTHORIZED');
    if (!existed) {
      if (!options.identity) throw new Error('PERSISTENCE_UNAVAILABLE');
      const fd = openSync(options.path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      closeSync(fd);
    }
    const info = lstatSync(options.path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid!()
      || (info.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
    const database = new Database(options.path, { readonly: this.readOnly, fileMustExist: true, timeout: 50 });
    this.database = database;
    try {
      if (!existed) initializeSchema(database, options.identity!);
      if (database.pragma('user_version', { simple: true }) !== SCHEMA_VERSION) throw new Error('STATE_INCOMPATIBLE');
      if (database.pragma('quick_check', { simple: true }) !== 'ok') throw new Error('STATE_CORRUPT');
      const store = database.prepare('SELECT * FROM store WHERE singleton=1').get() as Row | undefined;
      if (!store || Number(store.schema_version) !== SCHEMA_VERSION || Number(store.owner_uid) !== process.getuid!()) {
        throw new Error('STATE_INCOMPATIBLE');
      }
      if (options.identity && (store.store_id !== options.identity.storeId || store.canonical_path !== options.identity.canonicalPath)) {
        throw new Error('STATE_INCOMPATIBLE');
      }
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 50');
      if (!this.readOnly) {
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
      }
      database.defaultSafeIntegers(true);
    } catch (error) { database.close(); this.database = null; throw error; }
  }

  private writable(): Database.Database {
    if (this.readOnly || !this.database) throw new Error('UNAUTHORIZED');
    return this.database;
  }
  private mutate<T>(action: (database: Database.Database) => T): T {
    const database = this.writable();
    return database.transaction(() => {
      const before = (database.prepare('SELECT total_changes() AS count').get() as {count: bigint}).count;
      const value = action(database);
      const after = (database.prepare('SELECT total_changes() AS count').get() as {count: bigint}).count;
      if (before !== after) database.prepare('UPDATE store SET revision=revision+1 WHERE singleton=1').run();
      return value;
    }).immediate();
  }
  private operation(row: Row): OperationRecord {
    return { requestId: String(row.request_id), action: row.action as OperationRecord['action'],
      payloadHash: String(row.payload_hash), ownerUid: Number(row.owner_uid),
      targetInstanceId: row.target_instance_id as string | null, successorInstanceId: row.successor_instance_id as string | null,
      phase: row.phase as ControlPhase, outcome: row.outcome as Outcome, acceptedAt: String(row.accepted_at),
      completedAt: row.completed_at as string | null, error: parseError(row.error) };
  }
  private ticket(row: Row): LaunchTicket {
    return { ticketId: String(row.ticket_id), requestId: String(row.request_id), instanceId: String(row.instance_id),
      generation: String(row.generation), status: row.status as LaunchTicket['status'],
      claimedPid: row.claimed_pid === null ? null : Number(row.claimed_pid) };
  }
  private instance(row: Row): InstanceRecord {
    return { instanceId: String(row.instance_id), pid: Number(row.pid), generation: String(row.generation),
      lifecycle: row.lifecycle as Lifecycle, startedAt: String(row.started_at),
      shutdownPrepared: row.shutdown_prepared === 1n, lastError: parseError(row.last_error) };
  }

  readSnapshot(): StoreSnapshot | null {
    if (!this.database) return null;
    return this.database.transaction(() => {
      const row = this.database!.prepare('SELECT * FROM store WHERE singleton=1').get() as Row;
      const instance = row.current_instance_id === null ? undefined : this.database!.prepare('SELECT * FROM instances WHERE instance_id=?').get(row.current_instance_id) as Row | undefined;
      const pending = this.database!.prepare("SELECT * FROM operations WHERE outcome IN ('IN_PROGRESS','BLOCKED') LIMIT 1").get() as Row | undefined;
      return { store: { storeId: String(row.store_id), schemaVersion: Number(row.schema_version),
        ownerUid: Number(row.owner_uid), canonicalPath: String(row.canonical_path), revision: String(row.revision) },
        instance: instance ? this.instance(instance) : null, pendingOperation: pending ? this.operation(pending) : null };
    })();
  }
  getOperation(requestId: string): OperationRecord | null {
    requireUuid(requestId);
    const row = this.database?.prepare('SELECT * FROM operations WHERE request_id=?').get(requestId) as Row | undefined;
    return row ? this.operation(row) : null;
  }
  acceptOperation(intent: AcceptOperation): { operation: OperationRecord; accepted: boolean } {
    requireUuid(intent.requestId);
    if (!['start', 'stop', 'restart'].includes(intent.action) || !/^[a-f0-9]{64}$/.test(intent.payloadHash)
      || intent.ownerUid !== process.getuid!()) throw new Error('INVALID_REQUEST');
    if (intent.targetInstanceId !== null) requireUuid(intent.targetInstanceId);
    return this.mutate(database => {
      const existing = this.getOperation(intent.requestId);
      if (existing) {
        if (existing.payloadHash !== intent.payloadHash || existing.action !== intent.action
          || existing.ownerUid !== intent.ownerUid || existing.targetInstanceId !== intent.targetInstanceId) {
          throw new Error('IDEMPOTENCY_CONFLICT');
        }
        return { operation: existing, accepted: false };
      }
      if (database.prepare("SELECT 1 FROM operations WHERE outcome IN ('IN_PROGRESS','BLOCKED')").get()) throw new Error('BUSY');
      database.prepare(`INSERT INTO operations(request_id,action,payload_hash,owner_uid,target_instance_id,phase,outcome,accepted_at)
        VALUES (?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?)`).run(intent.requestId, intent.action, intent.payloadHash, intent.ownerUid, intent.targetInstanceId, intent.acceptedAt);
      return { operation: this.getOperation(intent.requestId)!, accepted: true };
    });
  }
  setOperationPhase(requestId: string, phase: ControlPhase): void {
    requireUuid(requestId);
    this.mutate(database => {
      const record = this.getOperation(requestId);
      if (!record || !['IN_PROGRESS', 'BLOCKED'].includes(record.outcome)) throw new Error('STALE_TARGET');
      database.prepare('UPDATE operations SET phase=? WHERE request_id=?').run(phase, requestId);
    });
  }
  completeOperation(requestId: string, outcome: Outcome, completedAt: string, error: SafeError | null): void {
    requireUuid(requestId);
    if (outcome === 'IN_PROGRESS') throw new Error('INVALID_REQUEST');
    this.mutate(database => {
      const previous = this.getOperation(requestId);
      if (!previous) throw new Error('STALE_TARGET');
      if (!['IN_PROGRESS', 'BLOCKED'].includes(previous.outcome)) {
        if (previous.outcome !== outcome) throw new Error('STALE_TARGET');
        return;
      }
      database.prepare('UPDATE operations SET outcome=?,phase=?,completed_at=?,error=? WHERE request_id=?')
        .run(outcome, outcome === 'BLOCKED' ? previous.phase : 'FINALIZED', completedAt, error ? JSON.stringify(error) : null, requestId);
    });
  }
  issueTicket(ticket: Omit<LaunchTicket, 'status' | 'claimedPid'>): LaunchTicket {
    requireUuid(ticket.ticketId); requireUuid(ticket.requestId); requireUuid(ticket.instanceId);
    if (!/^[0-9]{1,19}$/.test(ticket.generation)) throw new Error('INVALID_IDENTIFIER');
    return this.mutate(database => {
      const operation = this.getOperation(ticket.requestId);
      if (!operation || !['IN_PROGRESS', 'BLOCKED'].includes(operation.outcome)) throw new Error('STALE_TARGET');
      if (database.prepare("SELECT 1 FROM launch_tickets WHERE request_id=? AND status IN ('ISSUED','CLAIMED')").get(ticket.requestId)) {
        throw new Error('BLOCKED');
      }
      database.prepare("INSERT INTO launch_tickets(ticket_id,request_id,instance_id,generation,status) VALUES (?,?,?,?,'ISSUED')")
        .run(ticket.ticketId, ticket.requestId, ticket.instanceId, ticket.generation);
      database.prepare('UPDATE operations SET successor_instance_id=? WHERE request_id=?').run(ticket.instanceId, ticket.requestId);
      return this.getTicket(ticket.ticketId)!;
    });
  }
  claimTicket(ticketId: string, generation: string, pid: number): boolean {
    requireUuid(ticketId);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('INVALID_REQUEST');
    return this.mutate(database => database.prepare(`UPDATE launch_tickets SET status='CLAIMED',claimed_pid=?
      WHERE ticket_id=? AND generation=? AND status='ISSUED' AND request_id IN
      (SELECT request_id FROM operations WHERE outcome='IN_PROGRESS')`).run(pid, ticketId, generation).changes === 1);
  }
  cancelTicket(ticketId: string): boolean {
    requireUuid(ticketId);
    return this.mutate(database => database.prepare("UPDATE launch_tickets SET status='CANCELLED' WHERE ticket_id=? AND status='ISSUED'").run(ticketId).changes === 1);
  }
  getTicket(ticketId: string): LaunchTicket | null {
    requireUuid(ticketId);
    const row = this.database?.prepare('SELECT * FROM launch_tickets WHERE ticket_id=?').get(ticketId) as Row | undefined;
    return row ? this.ticket(row) : null;
  }
  recordInstance(instance: InstanceRecord): void {
    requireUuid(instance.instanceId);
    this.mutate(database => {
      const claim = database.prepare("SELECT 1 FROM launch_tickets WHERE instance_id=? AND generation=? AND claimed_pid=? AND status='CLAIMED'")
        .get(instance.instanceId, instance.generation, instance.pid);
      if (!claim) throw new Error('STALE_TARGET');
      const current = this.readSnapshot()?.instance;
      if (current && current.instanceId !== instance.instanceId && current.lifecycle !== 'STOPPED') throw new Error('BUSY');
      database.prepare(`INSERT INTO instances(instance_id,pid,generation,lifecycle,started_at,shutdown_prepared,last_error)
        VALUES (?,?,?,?,?,?,?)`).run(instance.instanceId, instance.pid, instance.generation, instance.lifecycle,
        instance.startedAt, instance.shutdownPrepared ? 1 : 0, instance.lastError ? JSON.stringify(instance.lastError) : null);
      database.prepare('UPDATE store SET current_instance_id=? WHERE singleton=1').run(instance.instanceId);
    });
  }
  transitionInstance(instanceId: string, next: Lifecycle): void {
    requireUuid(instanceId);
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== instanceId) throw new Error('STALE_TARGET');
      transition(current.lifecycle, next);
      database.prepare('UPDATE instances SET lifecycle=?,shutdown_prepared=? WHERE instance_id=?')
        .run(next, next === 'STOPPING' ? 1 : 0, instanceId);
    });
  }
  saveResource(resource: ManagedResource): void {
    requireUuid(resource.resourceId); requireUuid(resource.owningInstanceId);
    if (resource.policyScope !== 'foundation') throw new Error('INVALID_REQUEST');
    this.mutate(database => database.prepare(`INSERT INTO managed_resources VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(resource_id) DO UPDATE SET observation=excluded.observation,release_state=excluded.release_state`)
      .run(resource.resourceId, resource.owningInstanceId, resource.kind, resource.policyScope, resource.generation,
        resource.pid, resource.endpoint, resource.credentialRef, resource.observation, resource.releaseState));
  }
  listResources(instanceId: string): readonly ManagedResource[] {
    requireUuid(instanceId);
    const rows = this.database?.prepare('SELECT * FROM managed_resources WHERE owning_instance_id=?').all(instanceId) as Row[] | undefined;
    return (rows ?? []).map(row => ({ resourceId: String(row.resource_id), owningInstanceId: String(row.owning_instance_id),
      kind: row.kind as ManagedResource['kind'], policyScope: 'foundation', generation: String(row.generation),
      pid: row.pid === null ? null : Number(row.pid), endpoint: row.endpoint as string | null,
      credentialRef: row.credential_ref as string | null, observation: row.observation as ManagedResource['observation'],
      releaseState: row.release_state as ManagedResource['releaseState'] }));
  }
  close(): void { this.database?.close(); this.database = null; }
}
