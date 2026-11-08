import { beforeDiagnosticMutation, diagnosticUsage, appendDiagnosticLog, allocated, MiB } from './diagnostic-budget.js';
import { randomUUID } from 'node:crypto';
import { openJournal } from './event-journal.js';
import { redactEventDraft } from '../protocol/events.js';
import { MAX_OUTBOX_BYTES, type EventDraft, type EventPage, type EventState } from '../protocol/messages.js';
import type { EventRecord } from '../ports/storage.js';
import Database from 'better-sqlite3';
import { constants, closeSync, existsSync, lstatSync, openSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { initializeSchema, SCHEMA_VERSION } from './schema.js';
import { requireUuid } from '../domain/identifiers.js';
import { transition, type Lifecycle, type Outcome } from '../domain/states.js';
import { foundationError, type SafeError } from '../domain/errors.js';
import type { AcceptOperation, ControllerAttemptRecord, ControlPhase, InstanceRecord, LaunchTicket, ManagedResource, OperationRecord,
  StoreIdentity, StoreSnapshot } from '../ports/storage.js';

export interface StorageOptions { readonly path: string; readonly readonly?: boolean; readonly identity?: StoreIdentity }
type Row = Record<string, string | number | bigint | null>;
const parseError = (raw: Row[string] | undefined): SafeError | null => {
  if (typeof raw !== 'string') return null;
  const saved = JSON.parse(raw) as SafeError;
  return foundationError(saved.code, { persisted: saved.persisted, cause: saved.cause ?? null, ...(saved.operationId ? {operationId: saved.operationId} : {}) });
};

export class SQLiteStore {
  private database: Database.Database | null = null;
  private readonly readOnly: boolean;
  private readonly directory: string;
  private journal: ReturnType<typeof openJournal> | undefined;
  private eventError: string | null = null;
  constructor(options: StorageOptions, private readonly hooks: {checkpoint?(point: string): void} = {}) {
    this.directory = dirname(options.path);
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
      if (database.pragma('quick_check', { simple: true }) !== 'ok' || (database.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('STATE_CORRUPT');
      const store = database.prepare('SELECT * FROM store WHERE singleton=1').get() as Row | undefined;
      if (!store || Number(store.schema_version) !== SCHEMA_VERSION || Number(store.owner_uid) !== process.getuid!()) {
        throw new Error('STATE_INCOMPATIBLE');
      }
      if (store.canonical_path !== dirname(options.path)) throw new Error('UNAUTHORIZED');
      if (options.identity && (store.store_id !== options.identity.storeId || store.canonical_path !== options.identity.canonicalPath)) {
        throw new Error('STATE_INCOMPATIBLE');
      }
      database.pragma('foreign_keys = ON');
      database.pragma('busy_timeout = 50');
      if (!this.readOnly) {
        database.pragma('journal_mode = WAL');
        database.pragma('synchronous = FULL');
      database.pragma('wal_autocheckpoint = 0');
      }
      database.defaultSafeIntegers(true);
    } catch (error) { database.close(); this.database = null; throw error; }
  }

  private writable(): Database.Database {
    if (this.readOnly || !this.database) throw new Error('UNAUTHORIZED');
    return this.database;
  }
  private eventsJournal() {
    if (!this.journal) this.journal = openJournal({directory: join(this.directory, 'events'), readonly: this.readOnly,
      storeId: this.readSnapshot()!.store.storeId, checkpoint: point => this.hooks.checkpoint?.(point)});
    return this.journal;
  }
  private drainInTransaction(): void {
    const database = this.writable();
    const pending = JSON.parse((database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records: string}).records) as EventRecord[];
    if (!pending.length) return;
    this.eventsJournal().recover(pending);
    const page = this.eventsJournal().list({limit: 1});
    appendDiagnosticLog(this.directory, pending);
    database.prepare('UPDATE journal_metadata SET high_water=?,retention_floor=?,degraded_code=NULL WHERE singleton=1').run(BigInt(pending.at(-1)!.seq), BigInt(page.firstAvailable));
    database.prepare("UPDATE event_outbox SET records='[]' WHERE singleton=1").run();
    this.hooks.checkpoint?.('event.cleared');
  }
  drainEvents(): void {
    const database = this.writable();
    beforeDiagnosticMutation(this.directory, database);
    database.transaction(() => {
      if (allocated(join(this.directory, 'state.sqlite-wal')) >= MiB) throw new Error('EVENT_BACKPRESSURE');
      this.drainInTransaction();
    }).immediate(); this.eventError = null;
  }
  private enqueue(drafts: readonly EventDraft[]): void {
    const database = this.writable();
    const snapshot = this.readSnapshot()!;
    const identity = snapshot.store;
    let seq = (database.prepare('SELECT next_event_seq FROM store WHERE singleton=1').get() as {next_event_seq: bigint}).next_event_seq;
    const records: EventRecord[] = drafts.map(raw => {
      const draft = redactEventDraft(raw);
      if (seq >= 9_223_372_036_854_775_807n) throw new Error('EVENT_BACKPRESSURE');
      return {protocolVersion: 1, storeId: identity.storeId, eventId: randomUUID(), seq: String(seq++), occurredAt: new Date().toISOString(),
        type: draft.type, instanceId: draft.instanceId ?? null, operationId: draft.operationId ?? snapshot.pendingOperation?.requestId ?? null, payload: draft.payload};
    });
    if (Buffer.byteLength(JSON.stringify(records)) > MAX_OUTBOX_BYTES) throw new Error('EVENT_BACKPRESSURE');
    database.prepare('UPDATE event_outbox SET records=? WHERE singleton=1').run(JSON.stringify(records));
    database.prepare('UPDATE store SET next_event_seq=? WHERE singleton=1').run(seq);
  }
  private mutate<T>(action: (database: Database.Database) => T, drafts: readonly EventDraft[] = [], forceEvents = false): T {
    const database = this.writable();
    beforeDiagnosticMutation(this.directory, database);
    const value = database.transaction(() => {
      if (allocated(join(this.directory, 'state.sqlite-wal')) >= MiB) throw new Error('EVENT_BACKPRESSURE');
      try { this.drainInTransaction(); } catch { throw new Error('EVENT_BACKPRESSURE'); }
      const before = (database.prepare('SELECT total_changes() AS count').get() as {count: bigint}).count;
      const value = action(database);
      const after = (database.prepare('SELECT total_changes() AS count').get() as {count: bigint}).count;
      if (before !== after) database.prepare('UPDATE store SET revision=revision+1 WHERE singleton=1').run();
      if ((before !== after || forceEvents) && drafts.length) this.enqueue(drafts);
      this.hooks.checkpoint?.('event.beforeCommit');
      return value;
    }).immediate();
    this.hooks.checkpoint?.('event.committed');
    try { this.drainEvents(); } catch (error) { this.eventError = error instanceof Error && ['STATE_CORRUPT', 'EVENT_BACKPRESSURE', 'UNAUTHORIZED', 'ENDPOINT_COLLISION'].includes(error.message) ? error.message : 'PERSISTENCE_UNAVAILABLE'; }
    return value;
  }
  recordEvents(drafts: readonly EventDraft[]): void { this.mutate(() => {}, drafts, true); }
  getEventState(verify = false): EventState {
    if (!this.database) return {highWater: '0', firstAvailable: '1', pendingBytes: 0, degraded: false, errorCode: null};
    const meta = this.database.prepare('SELECT * FROM journal_metadata WHERE singleton=1').get() as Row;
    const raw = (this.database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records: string}).records;
    let errorCode = this.eventError;
    let firstAvailable = String(meta.retention_floor);
    try { if (verify) firstAvailable = this.eventsJournal().list({highWater: String(meta.high_water), limit: 1}).firstAvailable; }
    catch (error) { errorCode = error instanceof Error && ['STATE_CORRUPT', 'EVENT_BACKPRESSURE', 'UNAUTHORIZED', 'ENDPOINT_COLLISION'].includes(error.message) ? error.message : 'PERSISTENCE_UNAVAILABLE'; }
    const usage = diagnosticUsage(this.directory, this.database);
    return {usage, highWater: String(meta.high_water), firstAvailable, pendingBytes: raw === '[]' ? 0 : Buffer.byteLength(raw), degraded: raw !== '[]' || errorCode !== null, errorCode};
  }
  listEvents(options: {after?: string; limit?: number; maxBytes?: number} = {}): EventPage {
    if (!this.database) return {records: [], firstAvailable: '1', highWater: '0', truncated: false, nextAfter: '0'};
    return this.database.transaction(() => {
      const meta = this.database!.prepare('SELECT high_water FROM journal_metadata WHERE singleton=1').get() as Row;
      return this.eventsJournal().list({...options, highWater: String(meta.high_water)});
    })();
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
    }, [{type: 'operation.accepted', operationId: intent.requestId, payload: {action: intent.action}}]);
  }
  listTickets(requestId: string): readonly LaunchTicket[] {
    requireUuid(requestId);
    return ((this.database?.prepare('SELECT * FROM launch_tickets WHERE request_id=? ORDER BY rowid').all(requestId) ?? []) as Row[]).map(row => this.ticket(row));
  }
  reopenOperation(requestId: string): OperationRecord {
    requireUuid(requestId);
    return this.mutate(database => {
      const op = this.getOperation(requestId);
      if (!op || !['IN_PROGRESS', 'BLOCKED'].includes(op.outcome)) throw new Error('STALE_TARGET');
      database.prepare("UPDATE operations SET outcome='IN_PROGRESS',phase='PRECHECK',completed_at=NULL,error=NULL WHERE request_id=?").run(requestId);
      return this.getOperation(requestId)!;
    }, [{type: 'recovery.started', operationId: requestId, payload: {}}]);
  }
  retireTicket(ticketId: string, generation: string, claimedPid: number): void {
    requireUuid(ticketId);
    this.mutate(database => {
      if (database.prepare("UPDATE launch_tickets SET status='CANCELLED',claimed_pid=NULL WHERE ticket_id=? AND generation=? AND claimed_pid=? AND status='CLAIMED'")
        .run(ticketId, generation, claimedPid).changes !== 1) throw new Error('STALE_TARGET');
    });
  }
  reconcileInstanceAbsent(instanceId: string, generation: string): void {
    requireUuid(instanceId);
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== instanceId || current.generation !== generation) throw new Error('STALE_TARGET');
      if (this.listResources(instanceId).some(r => r.releaseState !== 'RELEASED')) throw new Error('BLOCKED');
      database.prepare("UPDATE instances SET lifecycle='STOPPED' WHERE instance_id=? AND generation=?").run(instanceId, generation);
    }, [{type: 'recovery.completed', instanceId, payload: {to: 'STOPPED', generation}}]);
  }
  resumeBlocked(requestId: string, targetInstanceId: string | null): OperationRecord {
    requireUuid(requestId);
    return this.mutate(database => {
      const op = this.getOperation(requestId);
      const current = this.readSnapshot()?.instance;
      if (!op || op.outcome !== 'BLOCKED' || op.targetInstanceId !== targetInstanceId
        || (current?.instanceId ?? null) !== targetInstanceId) throw new Error('STALE_TARGET');
      if (op.successorInstanceId !== null) throw new Error('BLOCKED');
      database.prepare("UPDATE operations SET outcome='IN_PROGRESS',phase='PRECHECK',completed_at=NULL,error=NULL WHERE request_id=?").run(requestId);
      return this.getOperation(requestId)!;
    });
  }
  cancelIssuedTickets(requestId: string): void {
    requireUuid(requestId);
    this.mutate(database => {
      const op = this.getOperation(requestId);
      if (!op || op.outcome !== 'IN_PROGRESS') throw new Error('STALE_TARGET');
      database.prepare("UPDATE launch_tickets SET status='CANCELLED' WHERE request_id=? AND status='ISSUED'").run(requestId);
    });
  }
  prepareShutdown(instanceId: string, generation: string): void {
    requireUuid(instanceId);
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== instanceId || current.generation !== generation) throw new Error('STALE_TARGET');
      if (current.lifecycle !== 'STOPPING' || this.listResources(instanceId).some(r => r.releaseState !== 'RELEASED')) throw new Error('BLOCKED');
      database.prepare('UPDATE instances SET shutdown_prepared=1 WHERE instance_id=?').run(instanceId);
    });
  }
  recordInstanceError(instanceId: string, error: SafeError): void {
    requireUuid(instanceId);
    this.mutate(database => {
      if (this.readSnapshot()?.instance?.instanceId !== instanceId) throw new Error('STALE_TARGET');
      database.prepare('UPDATE instances SET last_error=? WHERE instance_id=?').run(JSON.stringify(error), instanceId);
    });
  }
  blockInstance(instanceId: string, error: SafeError): void {
    requireUuid(instanceId);
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== instanceId) throw new Error('STALE_TARGET');
      if (current.lifecycle !== 'BLOCKED') transition(current.lifecycle, 'BLOCKED');
      database.prepare("UPDATE instances SET lifecycle='BLOCKED',shutdown_prepared=0,last_error=? WHERE instance_id=?")
        .run(JSON.stringify(error), instanceId);
    }, [{type: 'lifecycle.changed', instanceId, payload: {to: 'BLOCKED', code: error.code}}]);
  }
  setOperationPhase(requestId: string, phase: ControlPhase): void {
    requireUuid(requestId);
    this.mutate(database => {
      const record = this.getOperation(requestId);
      if (!record || !['IN_PROGRESS', 'BLOCKED'].includes(record.outcome)) throw new Error('STALE_TARGET');
      const edges: Partial<Record<ControlPhase, readonly ControlPhase[]>> = {
        ACCEPTED: ['PRECHECK', 'SPAWN_INTENT', 'STOP_REQUESTED'],
        PRECHECK: ['SPAWN_INTENT', 'STOP_REQUESTED'], SPAWN_INTENT: ['WAIT_READY'],
        STOP_REQUESTED: ['DRAINING', 'WAIT_EXIT'], DRAINING: ['WAIT_EXIT'],
        WAIT_EXIT: record.action === 'restart' ? ['SPAWN_INTENT'] : [],
      };
      if (record.phase === phase) return;
      if (!edges[record.phase]?.includes(phase)) throw new Error('INVALID_TRANSITION');
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
    }, [{type: outcome === 'BLOCKED' ? 'operation.blocked' : outcome === 'FAILED' ? 'operation.failed' : 'operation.completed', operationId: requestId, payload: {outcome, ...(error ? {code: error.code} : {})}}]);
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
      const previous = database.prepare('SELECT lifecycle,generation FROM instances WHERE instance_id=?').get(instance.instanceId) as Row | undefined;
      if (previous && (previous.lifecycle !== 'STOPPED' || BigInt(String(previous.generation)) >= BigInt(instance.generation))) throw new Error('STALE_TARGET');
      const current = this.readSnapshot()?.instance;
      if (current && current.instanceId !== instance.instanceId && current.lifecycle !== 'STOPPED') throw new Error('BUSY');
      database.prepare(`INSERT INTO instances(instance_id,pid,generation,lifecycle,started_at,shutdown_prepared,last_error)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(instance_id) DO UPDATE SET pid=excluded.pid,generation=excluded.generation,
          lifecycle=excluded.lifecycle,started_at=excluded.started_at,shutdown_prepared=excluded.shutdown_prepared,last_error=excluded.last_error
          WHERE instances.lifecycle='STOPPED' AND CAST(instances.generation AS INTEGER)<CAST(excluded.generation AS INTEGER)`).run(instance.instanceId, instance.pid, instance.generation, instance.lifecycle,
        instance.startedAt, instance.shutdownPrepared ? 1 : 0, instance.lastError ? JSON.stringify(instance.lastError) : null);
      database.prepare('UPDATE store SET current_instance_id=? WHERE singleton=1').run(instance.instanceId);
    }, [{type: 'lifecycle.changed', instanceId: instance.instanceId, payload: {to: instance.lifecycle, generation: instance.generation, pid: instance.pid}}]);
  }
  transitionInstance(instanceId: string, next: Lifecycle): void {
    requireUuid(instanceId);
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== instanceId) throw new Error('STALE_TARGET');
      transition(current.lifecycle, next);
      if (next === 'STOPPED' && (!current.shutdownPrepared || this.listResources(instanceId).some(r => r.releaseState !== 'RELEASED'))) throw new Error('BLOCKED');
      database.prepare('UPDATE instances SET lifecycle=?,shutdown_prepared=? WHERE instance_id=?')
        .run(next, next === 'STOPPED' && current.shutdownPrepared ? 1 : 0, instanceId);
    }, [{type: 'lifecycle.changed', instanceId, payload: {to: next}}]);
  }
  saveResource(resource: ManagedResource): void {
    requireUuid(resource.resourceId); requireUuid(resource.owningInstanceId);
    if (resource.policyScope !== 'foundation') throw new Error('INVALID_REQUEST');
    this.mutate(database => {
      const current = this.readSnapshot()?.instance;
      if (!current || current.instanceId !== resource.owningInstanceId) throw new Error('STALE_TARGET');
      const owner = database.prepare('SELECT owning_instance_id FROM managed_resources WHERE resource_id=?').get(resource.resourceId) as Row | undefined;
      if (owner && owner.owning_instance_id !== resource.owningInstanceId) throw new Error('STALE_TARGET');
      const existing = this.listResources(resource.owningInstanceId).find(r => r.resourceId === resource.resourceId);
      if (!existing && current.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
      if (existing && ['owningInstanceId', 'kind', 'policyScope', 'generation', 'pid', 'endpoint', 'credentialRef']
        .some(key => existing[key as keyof ManagedResource] !== resource[key as keyof ManagedResource])) throw new Error('STALE_TARGET');
      if (resource.pid !== null && database.prepare('SELECT 1 FROM controller_attempts WHERE pid=? AND ended_at IS NULL').get(resource.pid)) throw new Error('UNAUTHORIZED');
      return database.prepare(`INSERT INTO managed_resources VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(resource_id) DO UPDATE SET observation=excluded.observation,release_state=excluded.release_state`)
      .run(resource.resourceId, resource.owningInstanceId, resource.kind, resource.policyScope, resource.generation,
        resource.pid, resource.endpoint, resource.credentialRef, resource.observation, resource.releaseState);
    }, resource.releaseState === 'BLOCKED' ? [{type: 'resource.blocked', instanceId: resource.owningInstanceId, payload: {resourceId: resource.resourceId}}] : []);
  }
  listResources(instanceId: string): readonly ManagedResource[] {
    requireUuid(instanceId);
    const rows = this.database?.prepare('SELECT * FROM managed_resources WHERE owning_instance_id=?').all(instanceId) as Row[] | undefined;
    return (rows ?? []).map(row => ({ resourceId: String(row.resource_id), owningInstanceId: String(row.owning_instance_id),
      kind: row.kind as ManagedResource['kind'], policyScope: row.policy_scope as ManagedResource['policyScope'], generation: String(row.generation),
      pid: row.pid === null ? null : Number(row.pid), endpoint: row.endpoint as string | null,
      credentialRef: row.credential_ref as string | null, observation: row.observation as ManagedResource['observation'],
      releaseState: row.release_state as ManagedResource['releaseState'] }));
  }
  close(): void { this.database?.close(); this.database = null; }
  recordControllerAttempt(attempt: ControllerAttemptRecord): void {
    requireUuid(attempt.attemptId); requireUuid(attempt.requestId);
    this.mutate(database => database.prepare('INSERT INTO controller_attempts VALUES (?,?,?,?,?,?,?)')
      .run(attempt.attemptId, attempt.requestId, attempt.pid, attempt.generation, attempt.startedAt, attempt.endedAt, attempt.result));
  }
  getControllerAttempt(requestId: string): ControllerAttemptRecord | null {
    requireUuid(requestId);
    const row = this.database?.prepare('SELECT * FROM controller_attempts WHERE request_id=? ORDER BY rowid DESC LIMIT 1').get(requestId) as Row | undefined;
    return row ? { attemptId: String(row.attempt_id), requestId: String(row.request_id), pid: Number(row.pid),
      generation: String(row.generation), startedAt: String(row.started_at), endedAt: row.ended_at as string | null,
      result: row.result as string | null } : null;
  }
  finishControllerAttempt(attemptId: string, endedAt: string, result: string): void {
    requireUuid(attemptId);
    this.mutate(database => database.prepare('UPDATE controller_attempts SET ended_at=?,result=? WHERE attempt_id=?')
      .run(endedAt, result.slice(0, 64), attemptId));
  }
}
