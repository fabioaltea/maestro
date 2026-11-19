import { FEATURE_TABLES } from './features-upgrade.js';
import { readFeatureState } from './features-store.js';
import type { FeatureQuery } from '../ports/workflow.js';
import { createDiscoveryArtifacts, enforceDiscoveryBudget } from './discovery-artifacts.js';
import type { DiscoveryArtifact } from '../ports/discovery.js';
import { createDiscoveryMetadata } from './discovery-metadata.js';
import type { DiscoveryMetadataChange, DiscoveryMetadataQuery } from '../ports/discovery.js';
import { createDiscoveryLedger } from './discovery-store.js';
import type { DiscoveryAdmission } from '../ports/discovery.js';
import type { DiscoveryGrant } from '../domain/discovery/model.js';
import { beforeDiagnosticMutation, diagnosticUsage, appendDiagnosticLog, allocated, MiB } from './diagnostic-budget.js';
import { createHash, randomUUID } from 'node:crypto';
import { openJournal } from './event-journal.js';
import { redactEventDraft } from '../protocol/events.js';
import { MAX_OUTBOX_BYTES, type EventDraft, type EventPage, type EventState } from '../protocol/messages.js';
import type { EventRecord } from '../ports/storage.js';
import Database from './sqlite-driver.js';
import { openReadonlyDatabase } from './readonly-database.js';
import { prepareOwnershipLeaseFiles } from '../platform/macos/lease.js';
import { constants, closeSync, existsSync, lstatSync, openSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { DISCOVERY_TABLES } from './discovery-schema.js';
import { initializeSchema, REGISTRY_SCHEMA_VERSION, SCHEMA_VERSION } from './schema.js';
import { requireUuid } from '../domain/identifiers.js';
import { transition, type Lifecycle, type Outcome } from '../domain/states.js';
import { canonicalProjectIntent, requireLocalBranch, normalizeProjectCommand } from '../domain/projects/intent.js';
import { canonicalRepositoryIdentity, canonicalReferenceCheckout } from '../domain/projects/repository-evidence.js';
import { PROJECT_ACTIONS, transitionProjectOperation, validateProjectOperationResult,
  normalizeProjectName, requireProjectRevision, type Project, type ProjectObservation, type ProjectOperation, type ProjectOperationResult, type ProjectPhase } from '../domain/projects/model.js';
import type { AcceptProjectOperation, RequestReservation, ProjectState, RegisterProjectCommit, ObservationProjectCommit, RegistryPage, UpdateProjectCommit, RemoveProjectCommit } from '../ports/registry.js';
import { projectDetail } from '../domain/projects/projection.js';
import { foundationError, type SafeError } from '../domain/errors.js';
import type { AcceptOperation, ControllerAttemptRecord, ControlPhase, InstanceRecord, LaunchTicket, ManagedResource, OperationRecord,
  StoreIdentity, StoreSnapshot } from '../ports/storage.js';

export interface StorageOptions { readonly path: string; readonly readonly?: boolean; readonly identity?: StoreIdentity;
  /** Private host attestation: both existing lease handles are held for this read. */
  readonly readonlyQuiescent?: boolean }
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
  private artifactStore: ReturnType<typeof createDiscoveryArtifacts> | undefined;
  private eventError: string | null = null;
  private archiveVersion = SCHEMA_VERSION;
  private releaseReadLeases: (() => void) | undefined;
  constructor(options: StorageOptions, private readonly hooks: {checkpoint?(point: string): void; newProjectId?(): string} = {}) {
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
      prepareOwnershipLeaseFiles(dirname(options.path));
      const fd = openSync(options.path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      closeSync(fd);
    }
    const info = lstatSync(options.path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid!()
      || (info.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
    const reader = this.readOnly ? openReadonlyDatabase(options.path, options.readonlyQuiescent) : undefined;
    this.releaseReadLeases = reader?.release;
    const database = reader?.database ?? new Database(options.path, { fileMustExist: true, timeout: 50 });
    this.database = database;
    try {
      if (!existed) initializeSchema(database, options.identity!);
      const version = Number(database.pragma('user_version', { simple: true }));
      if (![4, SCHEMA_VERSION].includes(version) && !(this.readOnly && [2, REGISTRY_SCHEMA_VERSION].includes(Number(version)))) throw new Error('STATE_INCOMPATIBLE');
      if (version >= 4) {
        for (const name of DISCOVERY_TABLES) {
          if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) throw new Error('STATE_CORRUPT');
        }
      }
      if (version === 5) for (const name of FEATURE_TABLES) if (!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) throw new Error('STATE_CORRUPT');
      this.archiveVersion = version;
      if (database.pragma('quick_check', { simple: true }) !== 'ok' || (database.pragma('foreign_key_check') as unknown[]).length !== 0) throw new Error('STATE_CORRUPT');
      const store = database.prepare('SELECT * FROM store WHERE singleton=1').get() as Row | undefined;
      if (!store || Number(store.schema_version) !== version || Number(store.owner_uid) !== process.getuid!()) {
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
    } catch (error) { database.close(); this.releaseReadLeases?.(); this.database = null; throw error; }
  }

  private writable(): Database.Database {
    if (this.readOnly || !this.database) throw new Error('UNAUTHORIZED');
    return this.database;
  }
  private registry(): Database.Database {
    if (!this.database) throw new Error('STATE_ABSENT');
    if (this.archiveVersion < REGISTRY_SCHEMA_VERSION) throw new Error('REGISTRY_NOT_INITIALIZED');
    return this.database;
  }
  private artifacts() {
    if (!this.database) throw new Error('STATE_ABSENT');
    return this.artifactStore ??= createDiscoveryArtifacts(this.database, { directory: this.directory, readonly: this.readOnly,
      checkpoint: point => this.hooks.checkpoint?.(point), mutate: (body, terminal) => this.mutate(() => { const value = body(); enforceDiscoveryBudget(this.database!, terminal); return value; }) });
  }
  reserveDiscoveryArtifact(kind: DiscoveryArtifact['kind'], bytes: number) { this.writable(); return this.artifacts().reserveDiscoveryArtifact(kind, bytes); }
  publishDiscoveryArtifact(id: string, bytes: Uint8Array) { this.writable(); return this.artifacts().publishDiscoveryArtifact(id, bytes); }
  readDiscoveryManifestPage(id: string, offset: number, limit: number) { return this.artifacts().readDiscoveryManifestPage(id, offset, limit); }
  readDiscoveryArtifact(id: string, offset: number, maximumBytes: number) { return this.artifacts().readDiscoveryArtifact(id, offset, maximumBytes); }
  reconcileDiscoveryArtifacts() { this.writable(); return this.artifacts().reconcileDiscoveryArtifacts(); }
  getDiscoveryBudget() { return this.artifacts().getDiscoveryBudget(); }
  discardDiscoveryPreview(id: string) { this.writable(); return this.artifacts().discardDiscoveryPreview(id); }
  private discoveryMetadata() {
    if (!this.database) throw new Error('STATE_ABSENT');
    return createDiscoveryMetadata(this.database, { mutate: (body, change) => {
      const drafts: EventDraft[] = [];
      return this.mutate(() => {
        const value = body();
        enforceDiscoveryBudget(this.database!, !['provider', 'configure', 'snapshot', 'questions', 'answer', 'revision', 'output'].includes(change?.kind ?? ''));
        if (!change || ['provider', 'snapshot', 'artifact'].includes(change.kind)) return value;
        let discoveryId: string | null = null, runId: string | null = null, operationId: string | null = null;
        if (change.kind === 'operation' || change.kind === 'operation-uncertain') operationId = change.requestId;
        else if (change.kind === 'configure') operationId = change.admission.requestId;
        else if (change.kind === 'state' || change.kind === 'questions' || change.kind === 'cancel') { discoveryId = change.discoveryId; if (change.kind === 'cancel') operationId = change.admission.requestId; }
        else if (change.kind === 'answer') {
          const question = this.database!.prepare('SELECT discovery_id FROM discovery_questions WHERE question_id=?').get(change.value.questionId) as Row | undefined;
          discoveryId = change.admission.discovery?.discoveryId ?? (question ? String(question.discovery_id) : null); operationId = change.value.requestId;
        }
        else if (change.kind === 'output-truncated') runId = change.runId;
        else if (change.kind === 'revision' || change.kind === 'approval' || change.kind === 'run') discoveryId = change.value.discoveryId;
        else if (change.kind === 'process' || change.kind === 'output') runId = change.value.runId;
        if (change.kind === 'approval') operationId = change.value.requestId;
        if (runId) { const run = this.database!.prepare('SELECT discovery_id,request_id FROM discovery_runs WHERE run_id=?').get(runId) as Row | undefined; discoveryId = run ? String(run.discovery_id) : null; operationId ??= run ? String(run.request_id) : null; }
        const d = discoveryId ? this.database!.prepare('SELECT project_id,session_id,current_run_id,state FROM discoveries WHERE discovery_id=?').get(discoveryId) as Row | undefined : undefined;
        runId ??= d?.current_run_id ? String(d.current_run_id) : null;
        if (!operationId && runId) { const run = this.database!.prepare('SELECT request_id FROM discovery_runs WHERE run_id=?').get(runId) as Row | undefined; operationId = run ? String(run.request_id) : null; }
        if (operationId) drafts.push({ type: 'discovery.changed', operationId, payload: { scope: 'discovery',
          ...(d ? { projectId: String(d.project_id), discoveryId, sessionId: String(d.session_id), state: String(d.state) } : {}),
          ...(runId ? { runId } : {}),
        } });
        if (operationId && drafts.length) {
          const payload = drafts[0]!.payload;
          if (change.kind === 'questions') drafts.push({ type: 'discovery.question.available', operationId, payload: { ...payload, count: change.values.length } });
          if (change.kind === 'output') drafts.push({ type: 'discovery.output.available', operationId, payload: { ...payload, watermark: change.value.seq } });
          if (change.kind === 'output-truncated') drafts.push({ type: 'discovery.output.available', operationId, payload: { ...payload, watermark: change.expectedWatermark, truncated: true } });
          if (change.kind === 'revision') drafts.push({ type: 'discovery.document.changed', operationId, payload: { ...payload, revisionId: change.value.revisionId } });
          if (change.kind === 'approval') drafts.push({ type: 'discovery.approval.changed', operationId, payload: { ...payload, revisionId: change.value.revisionId } });
        }
        return value;
      }, drafts);
    } });
  }
  readFeatureState(query: FeatureQuery) { if (!this.database) throw new Error('STATE_ABSENT'); return readFeatureState(this.database, query); }
  readDiscoveryMetadata<Q extends DiscoveryMetadataQuery>(query: Q) { return this.discoveryMetadata().read(query); }
  commitDiscoveryMetadata(change: DiscoveryMetadataChange) { this.writable(); return this.discoveryMetadata().commit(change); }
  private discoveryLedger() {
    if (!this.database) throw new Error('STATE_ABSENT');
    return createDiscoveryLedger(this.database, { mutate: (body, input, terminal) => this.mutate(() => { const value = body(); enforceDiscoveryBudget(this.database!, terminal === true || input?.action === 'cancel'); return value; }, input ? [{
      type: 'operation.accepted', instanceId: input.instanceId, operationId: input.requestId,
      payload: { scope: 'discovery', action: input.action, ...(input.discovery ? {
        projectId: input.discovery.projectId, discoveryId: input.discovery.discoveryId, sessionId: input.discovery.sessionId,
        ...(input.run ? { runId: input.run.runId } : {}),
      } : {}) },
    }] : []) });
  }
  admitDiscoveryOperation(input: DiscoveryAdmission) { this.writable(); return this.discoveryLedger().admit(input); }
  getDiscoveryRunOwner(runId: string): string | null {
    requireUuid(runId); if (!this.database || this.archiveVersion < 4) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const row = this.database.prepare('SELECT o.owning_instance_id FROM discovery_runs r JOIN discovery_operations o ON o.request_id=r.request_id WHERE r.run_id=?').get(runId) as Row | undefined;
    return row ? String(row.owning_instance_id) : null;
  }
  getDiscoveryOperation(requestId: string) {
    const operation = this.discoveryLedger().operation(requestId);
    if (!operation) return null;
    const { canonicalIntent: _canonical, payloadHash: _hash, ...view } = operation;
    return view;
  }
  saveDiscoveryGrant(grant: DiscoveryGrant) { this.writable(); return this.discoveryLedger().saveGrant(grant); }
  private catalog(requestId: string, scope: 'LIFECYCLE' | 'PROJECT', action: string, payloadHash: string): boolean {
    const row = this.registry().prepare('SELECT scope,action,payload_hash FROM request_catalog WHERE request_id=?').get(requestId) as Row | undefined;
    if (!row) return false;
    if (row.scope !== scope || row.action !== action || row.payload_hash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
    return true;
  }
  getRequestReservation(requestId: string): RequestReservation | null {
    requestId = requireUuid(requestId);
    let row = this.registry().prepare('SELECT scope,action,payload_hash FROM request_catalog WHERE request_id=?').get(requestId) as Row | undefined;
    if (this.archiveVersion >= 4) {
      const discovery = this.registry().prepare("SELECT 'DISCOVERY' AS scope,action,payload_hash FROM discovery_operations WHERE request_id=?").get(requestId) as Row | undefined;
      if (row && discovery) throw new Error('STATE_CORRUPT');
      row ??= discovery;
    }
    return row ? { scope: row.scope as RequestReservation['scope'], action: String(row.action), payloadHash: String(row.payload_hash) } : null;
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
    if (page.highWater !== pending.at(-1)!.seq) throw new Error('STATE_CORRUPT');
    appendDiagnosticLog(this.directory, pending, point => this.hooks.checkpoint?.(point));
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
    if (drafts.some(draft => draft.payload.scope === 'project' && draft.type === 'operation.completed')) {
      this.hooks.checkpoint?.('project.committed');
      this.hooks.checkpoint?.('project.beforeDrain');
    }
    try { this.drainEvents(); } catch (error) { this.eventError = error instanceof Error && ['STATE_CORRUPT', 'EVENT_BACKPRESSURE', 'UNAUTHORIZED', 'ENDPOINT_COLLISION'].includes(error.message) ? error.message : 'PERSISTENCE_UNAVAILABLE'; }
    return value;
  }
  recordEvents(drafts: readonly EventDraft[]): void { this.mutate(() => {}, drafts, true); }
  captureEventState(): EventState {
    if (!this.database) throw new Error('STATE_CORRUPT');
    // Same SQLite writer serialization as event publication; no transaction survives this call.
    return this.database.transaction(() => this.getEventState(true)).immediate();
  }
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
  listEvents(options: {highWater?: string; after?: string; limit?: number; maxBytes?: number} = {}): EventPage {
    if (!this.database) return {records: [], firstAvailable: '1', highWater: '0', truncated: false, nextAfter: '0'};
    return this.database.transaction(() => {
      const meta = this.database!.prepare('SELECT high_water FROM journal_metadata WHERE singleton=1').get() as Row;
      const highWater = options.highWater ?? String(meta.high_water);
      if (BigInt(highWater) > BigInt(String(meta.high_water))) throw new Error('INVALID_REQUEST');
      return this.eventsJournal().list({...options, highWater});
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
    this.writable();
    const resolveExisting = () => {
      if (!this.catalog(intent.requestId, 'LIFECYCLE', intent.action, intent.payloadHash)) return null;
      const existing = this.getOperation(intent.requestId);
      if (!existing || existing.ownerUid !== intent.ownerUid || existing.targetInstanceId !== intent.targetInstanceId) throw new Error('IDEMPOTENCY_CONFLICT');
      return { operation: existing, accepted: false };
    };
    const historical = resolveExisting();
    if (historical) return historical;
    return this.mutate(database => {
      const existing = resolveExisting();
      if (existing) return existing;
      if (database.prepare("SELECT 1 FROM operations WHERE outcome IN ('IN_PROGRESS','BLOCKED')").get()) throw new Error('BUSY');
      database.prepare("INSERT INTO request_catalog(request_id,scope,action,payload_hash) VALUES(?,'LIFECYCLE',?,?)")
        .run(intent.requestId, intent.action, intent.payloadHash);
      database.prepare(`INSERT INTO operations(request_id,action,payload_hash,owner_uid,target_instance_id,phase,outcome,accepted_at)
        VALUES (?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?)`).run(intent.requestId, intent.action, intent.payloadHash, intent.ownerUid, intent.targetInstanceId, intent.acceptedAt);
      return { operation: this.getOperation(intent.requestId)!, accepted: true };
    }, [{type: 'operation.accepted', operationId: intent.requestId, payload: {action: intent.action}}]);
  }
  private projectOperation(row: Row): ProjectOperation {
    return { requestId: String(row.request_id), action: row.action as ProjectOperation['action'],
      payloadHash: String(row.payload_hash), canonicalIntent: String(row.canonical_intent), projectId: row.project_id as string | null,
      expectedConfigRevision: row.expected_config_revision === null ? null : String(row.expected_config_revision),
      owningInstanceId: String(row.owning_instance_id), ownerUid: Number(row.owner_uid), phase: row.phase as ProjectPhase,
      outcome: row.outcome as ProjectOperation['outcome'], acceptedAt: String(row.accepted_at), deadlineAt: String(row.deadline_at),
      completedAt: row.completed_at as string | null, result: row.result === null ? null : JSON.parse(String(row.result)) as ProjectOperationResult };
  }
  getProjectOperation(requestId: string): ProjectOperation | null {
    requestId = requireUuid(requestId);
    const row = this.registry().prepare('SELECT * FROM project_operations WHERE request_id=?').get(requestId) as Row | undefined;
    return row ? this.projectOperation(row) : null;
  }
  getProject(projectId: string): ProjectState | null {
    projectId = requireUuid(projectId);
    const database = this.registry();
    return database.transaction(() => {
      const row = database.prepare('SELECT * FROM projects WHERE project_id=?').get(projectId) as Row | undefined;
      if (!row) return null;
      const project: Project = { projectId, displayName: String(row.display_name), repositoryKey: String(row.repository_key),
        repositoryIdentity: JSON.parse(String(row.repository_identity)) as Project['repositoryIdentity'],
        referenceCheckout: JSON.parse(String(row.reference_checkout)) as Project['referenceCheckout'], baseBranch: row.base_branch as string | null,
        configRevision: String(row.config_revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at), removedAt: row.removed_at as string | null };
      const observed = database.prepare('SELECT * FROM project_observations WHERE project_id=?').get(projectId) as Row | undefined;
      const observation = observed ? { ...JSON.parse(String(observed.evidence)) as ProjectObservation, projectId,
        observationRevision: String(observed.observation_revision), observedConfigRevision: String(observed.observed_config_revision),
        requestId: String(observed.request_id), observedInstanceId: String(observed.observed_instance_id),
        startedAt: String(observed.started_at), completedAt: String(observed.completed_at) } : null;
      return { project, observation };
    })();
  }
  listProjects(options: { readonly limit?: number; readonly cursor?: string } = {}): RegistryPage {
    const limit = options.limit ?? 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('INVALID_REQUEST');
    const database = this.registry();
    return database.transaction(() => {
      const storeId = this.readSnapshot()!.store.storeId;
      const registryRevision = String((database.prepare('SELECT registry_revision FROM registry_metadata WHERE singleton=1').get() as Row).registry_revision);
      let after = '';
      if (options.cursor !== undefined) {
        let cursor: { storeId: string; registryRevision: string; lastProjectId: string };
        try {
          if (!/^[A-Za-z0-9_-]{1,512}$/.test(options.cursor)) throw new Error();
          cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8')) as typeof cursor;
          if (Object.keys(cursor).sort().join(',') !== 'lastProjectId,registryRevision,storeId') throw new Error();
          requireUuid(cursor.storeId); requireUuid(cursor.lastProjectId);
          if (!/^(0|[1-9][0-9]*)$/.test(cursor.registryRevision)) throw new Error();
        } catch { throw new Error('INVALID_REQUEST'); }
        if (cursor.storeId !== storeId) throw new Error('WRONG_STORE');
        if (cursor.registryRevision !== registryRevision) throw new Error('REGISTRY_CHANGED');
        after = cursor.lastProjectId;
      }
      const rows = database.prepare('SELECT project_id FROM projects WHERE removed_at IS NULL AND project_id>? ORDER BY project_id LIMIT ?').all(after, limit + 1) as Row[];
      const projects: RegistryPage['projects'][number][] = [];
      const cursorFor = (id: string) => Buffer.from(JSON.stringify({ storeId, registryRevision, lastProjectId: id })).toString('base64url');
      for (const row of rows.slice(0, limit)) {
        const detail = projectDetail(this.getProject(String(row.project_id))!);
        // Reserve envelope/cursor overhead; never split a record or hold a snapshot between pages.
        if (Buffer.byteLength(JSON.stringify({ projects: [...projects, detail], registryRevision, nextCursor: cursorFor(detail.projectId) })) > 60 * 1024 - 1024) {
          if (!projects.length) throw new Error('OUTPUT_LIMIT');
          break;
        }
        projects.push(detail);
      }
      return { projects, registryRevision, nextCursor: rows.length > projects.length ? cursorFor(projects.at(-1)!.projectId) : null };
    })();
  }
  commitProjectObservation(input: ObservationProjectCommit): ProjectOperationResult {
    requireUuid(input.requestId); requireUuid(input.instanceId); requireUuid(input.projectId);
    const evidence = input.observation;
    if (!Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.completedAt))
      || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)
      || evidence.fileStatusScope !== 'REFERENCE_CHECKOUT_DIRECT_ENTRIES'
      || [evidence.hasCommits, evidence.trackedChanges, evidence.untrackedChanges, evidence.conflicts].some(flag => flag !== null && typeof flag !== 'boolean')
      || !['UNCONFIGURED', 'VALID', 'INVALID', 'UNVERIFIED'].includes(evidence.baseState)) throw new Error('INVALID_REQUEST');
    const drafts: EventDraft[] = [];
    return this.mutate(database => {
      const operation = this.getProjectOperation(input.requestId);
      if (!operation || operation.action !== 'VERIFY' || operation.projectId !== input.projectId || operation.outcome !== 'IN_PROGRESS') throw new Error('INVALID_TRANSITION');
      const instance = this.readSnapshot()?.instance;
      if (!instance || instance.instanceId !== input.instanceId || operation.owningInstanceId !== input.instanceId || instance.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
      const state = this.getProject(input.projectId);
      if (!state) throw new Error('PROJECT_NOT_FOUND');
      if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
      if (state.project.configRevision !== input.expectedConfigRevision || (state.observation?.observationRevision ?? null) !== input.expectedObservationRevision) throw new Error('OBSERVATION_SUPERSEDED');
      if (evidence.referencePath !== state.project.referenceCheckout.root.canonicalPath
        || (state.project.baseBranch === null && (evidence.baseState !== 'UNCONFIGURED' || evidence.baseOid !== null))) throw new Error('INVALID_REQUEST');
      const observationRevision = String(BigInt(state.observation?.observationRevision ?? '0') + 1n);
      const saved = { ...evidence, error: evidence.error ? foundationError(evidence.error.code, { persisted: true, operationId: input.requestId }) : null };
      database.prepare(`INSERT INTO project_observations(project_id,observation_revision,observed_config_revision,request_id,observed_instance_id,started_at,completed_at,evidence)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET observation_revision=excluded.observation_revision,
        observed_config_revision=excluded.observed_config_revision,request_id=excluded.request_id,observed_instance_id=excluded.observed_instance_id,
        started_at=excluded.started_at,completed_at=excluded.completed_at,evidence=excluded.evidence`).run(input.projectId, observationRevision,
        state.project.configRevision, input.requestId, input.instanceId, evidence.startedAt, evidence.completedAt, JSON.stringify(saved));
      database.prepare('UPDATE registry_metadata SET registry_revision=registry_revision+1 WHERE singleton=1').run();
      const result: ProjectOperationResult = { action: 'VERIFY', requestId: input.requestId, projectId: input.projectId, outcome: 'SUCCEEDED', effect: 'OBSERVED',
        configRevision: state.project.configRevision, observationRevision, completedAt: input.completedAt, error: null };
      validateProjectOperationResult(result);
      database.prepare("UPDATE project_operations SET phase='FINALIZED',outcome='SUCCEEDED',completed_at=?,result=? WHERE request_id=?")
        .run(input.completedAt, JSON.stringify(result), input.requestId);
      drafts.push({ type: 'operation.completed', operationId: input.requestId, instanceId: input.instanceId,
        payload: { scope: 'project', action: 'VERIFY', outcome: 'SUCCEEDED', effect: 'OBSERVED', projectId: input.projectId,
          configRevision: state.project.configRevision, observationRevision } });
      this.hooks.checkpoint?.('project.beforeCommit');
      return result;
    }, drafts);
  }
  commitProjectRemoval(input: RemoveProjectCommit): ProjectOperationResult {
    requireUuid(input.requestId); requireUuid(input.instanceId); requireUuid(input.projectId); requireProjectRevision(input.expectedConfigRevision);
    const drafts: EventDraft[] = [];
    return this.mutate(database => {
      const operation = this.getProjectOperation(input.requestId);
      if (!operation || operation.action !== 'REMOVE' || operation.outcome !== 'IN_PROGRESS') throw new Error('INVALID_TRANSITION');
      const instance = this.readSnapshot()?.instance;
      if (!instance || instance.instanceId !== input.instanceId || operation.owningInstanceId !== input.instanceId || instance.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
      const command = normalizeProjectCommand('REMOVE', (JSON.parse(operation.canonicalIntent) as { params: unknown }).params);
      if (command.action !== 'REMOVE' || command.params.projectId !== input.projectId || operation.projectId !== input.projectId
        || command.params.expectedRevision !== input.expectedConfigRevision || operation.expectedConfigRevision !== input.expectedConfigRevision) throw new Error('INVALID_REQUEST');
      const state = this.getProject(input.projectId);
      if (!state) throw new Error('PROJECT_NOT_FOUND');
      if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
      if (state.project.configRevision !== input.expectedConfigRevision) throw new Error('REVISION_CONFLICT');
      const configRevision = String(BigInt(state.project.configRevision) + 1n);
      this.hooks.checkpoint?.('project.remove.beforeWrite');
      const changed = database.prepare('UPDATE projects SET removed_at=?,updated_at=?,config_revision=? WHERE project_id=? AND config_revision=? AND removed_at IS NULL')
        .run(input.completedAt, input.completedAt, configRevision, input.projectId, input.expectedConfigRevision);
      if (changed.changes !== 1) throw new Error('REVISION_CONFLICT');
      database.prepare('UPDATE registry_metadata SET registry_revision=registry_revision+1 WHERE singleton=1').run();
      this.hooks.checkpoint?.('project.remove.written');
      const result: ProjectOperationResult = { requestId: input.requestId, action: 'REMOVE', projectId: input.projectId, outcome: 'SUCCEEDED', effect: 'REMOVED',
        configRevision, observationRevision: state.observation?.observationRevision ?? null, completedAt: input.completedAt, error: null };
      validateProjectOperationResult(result);
      this.hooks.checkpoint?.('project.remove.beforeFinalize');
      database.prepare("UPDATE project_operations SET phase='FINALIZED',outcome='SUCCEEDED',completed_at=?,result=? WHERE request_id=?")
        .run(input.completedAt, JSON.stringify(result), input.requestId);
      drafts.push({ type: 'operation.completed', operationId: input.requestId, instanceId: input.instanceId,
        payload: { scope: 'project', action: 'REMOVE', projectId: input.projectId, outcome: 'SUCCEEDED', effect: 'REMOVED',
          configRevision, observationRevision: result.observationRevision } });
      this.hooks.checkpoint?.('project.beforeCommit');
      return result;
    }, drafts);
  }
  commitProjectUpdate(input: UpdateProjectCommit): ProjectOperationResult {
    requireUuid(input.requestId); requireUuid(input.instanceId); requireUuid(input.projectId); requireProjectRevision(input.expectedConfigRevision);
    const drafts: EventDraft[] = [];
    return this.mutate(database => {
      const operation = this.getProjectOperation(input.requestId);
      if (!operation || operation.action !== 'UPDATE' || operation.projectId !== input.projectId || operation.outcome !== 'IN_PROGRESS') throw new Error('INVALID_TRANSITION');
      const instance = this.readSnapshot()?.instance;
      if (!instance || instance.instanceId !== input.instanceId || operation.owningInstanceId !== input.instanceId || instance.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
      const command = normalizeProjectCommand('UPDATE', (JSON.parse(operation.canonicalIntent) as { params: unknown }).params);
      if (command.action !== 'UPDATE' || command.params.projectId !== input.projectId
        || command.params.expectedRevision !== input.expectedConfigRevision || operation.expectedConfigRevision !== input.expectedConfigRevision) throw new Error('INVALID_REQUEST');
      const state = this.getProject(input.projectId);
      if (!state) throw new Error('PROJECT_NOT_FOUND');
      if (state.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
      if (state.project.configRevision !== input.expectedConfigRevision) throw new Error('REVISION_CONFLICT');
      const { patch } = command.params;
      if (typeof patch.baseBranch === 'string') {
        const proof = input.baseEvidence;
        if (!proof) throw new Error('INVALID_BASE_BRANCH');
        if (canonicalRepositoryIdentity(proof.identity) !== canonicalRepositoryIdentity(state.project.repositoryIdentity)
          || canonicalReferenceCheckout(proof.reference) !== canonicalReferenceCheckout(state.project.referenceCheckout)) throw new Error('REPOSITORY_CHANGED');
        const observation = proof.observation;
        const oidLength = observation.objectFormat === 'sha1' ? 40 : observation.objectFormat === 'sha256' ? 64 : 0;
        if (proof.proposedBaseBranch !== patch.baseBranch || observation.baseState !== 'VALID' || !observation.baseOid
          || !oidLength || !new RegExp(`^[0-9a-f]{${oidLength}}$`).test(observation.baseOid)
          || observation.repositoryIdentityStatus !== 'VERIFIED' || observation.checkoutAvailability !== 'VERIFIED'
          || observation.referencePath !== state.project.referenceCheckout.root.canonicalPath) throw new Error('INVALID_BASE_BRANCH');
      } else if (input.baseEvidence !== undefined) throw new Error('INVALID_REQUEST');
      const displayName = patch.name ?? state.project.displayName;
      const baseBranch = Object.hasOwn(patch, 'baseBranch') ? patch.baseBranch! : state.project.baseBranch;
      const changed = displayName !== state.project.displayName || baseBranch !== state.project.baseBranch;
      const configRevision = changed ? String(BigInt(state.project.configRevision) + 1n) : state.project.configRevision;
      this.hooks.checkpoint?.('project.update.beforeWrite');
      if (changed) {
        database.prepare('UPDATE projects SET display_name=?,base_branch=?,config_revision=?,updated_at=? WHERE project_id=? AND config_revision=? AND removed_at IS NULL')
          .run(displayName, baseBranch, configRevision, input.completedAt, input.projectId, input.expectedConfigRevision);
        database.prepare('UPDATE registry_metadata SET registry_revision=registry_revision+1 WHERE singleton=1').run();
      }
      this.hooks.checkpoint?.('project.update.written');
      const result: ProjectOperationResult = { requestId: input.requestId, action: 'UPDATE', projectId: input.projectId, outcome: 'SUCCEEDED',
        effect: changed ? 'UPDATED' : 'NONE', configRevision, observationRevision: state.observation?.observationRevision ?? null,
        completedAt: input.completedAt, error: null };
      validateProjectOperationResult(result);
      database.prepare("UPDATE project_operations SET phase='FINALIZED',outcome='SUCCEEDED',completed_at=?,result=? WHERE request_id=?")
        .run(input.completedAt, JSON.stringify(result), input.requestId);
      drafts.push({ type: 'operation.completed', operationId: input.requestId, instanceId: input.instanceId,
        payload: { scope: 'project', action: 'UPDATE', projectId: input.projectId, outcome: 'SUCCEEDED', effect: result.effect,
          configRevision, observationRevision: result.observationRevision } });
      this.hooks.checkpoint?.('project.beforeCommit');
      return result;
    }, drafts);
  }
  commitProjectRegistration(input: RegisterProjectCommit): ProjectOperationResult {
    requireUuid(input.requestId); requireUuid(input.instanceId);
    const displayName = normalizeProjectName(input.displayName);
    const identity = canonicalRepositoryIdentity(input.repositoryIdentity), reference = canonicalReferenceCheckout(input.referenceCheckout);
    if (createHash('sha256').update(identity).digest('hex') !== input.repositoryKey) throw new Error('INVALID_REQUEST');
    const evidence = input.observation;
    if (input.baseBranch !== null) {
      requireLocalBranch(input.baseBranch);
      if (evidence.baseState !== 'VALID' || !evidence.baseOid) throw new Error('INVALID_BASE_BRANCH');
    } else if (evidence.baseState !== 'UNCONFIGURED' || evidence.baseOid !== null) throw new Error('INVALID_BASE_BRANCH');
    if (evidence.checkoutAvailability !== 'VERIFIED' || evidence.repositoryIdentityStatus !== 'VERIFIED'
      || evidence.referencePath !== input.referenceCheckout.root.canonicalPath
      || evidence.fileStatusScope !== 'REFERENCE_CHECKOUT_DIRECT_ENTRIES'
      || !Number.isFinite(Date.parse(evidence.startedAt)) || !Number.isFinite(Date.parse(evidence.completedAt))
      || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) throw new Error('REPOSITORY_CHANGED');
    for (const flag of [evidence.hasCommits, evidence.trackedChanges, evidence.untrackedChanges, evidence.conflicts]) {
      if (flag !== null && typeof flag !== 'boolean') throw new Error('INVALID_REQUEST');
    }
    const oidLength = evidence.objectFormat === 'sha1' ? 40 : evidence.objectFormat === 'sha256' ? 64 : 0;
    if (!oidLength || !['BRANCH', 'DETACHED', 'UNBORN'].includes(evidence.headKind)
      || [evidence.headOid, evidence.baseOid].some(oid => oid !== null && !new RegExp(`^[0-9a-f]{${oidLength}}$`).test(oid))) throw new Error('REPOSITORY_UNSUPPORTED');
    const error = evidence.error ? foundationError(evidence.error.code, { persisted: true, operationId: input.requestId }) : null;
    const savedEvidence = { ...evidence, error };
    const drafts: EventDraft[] = [];
    return this.mutate(database => {
      const operation = this.getProjectOperation(input.requestId);
      if (!operation || operation.action !== 'REGISTER' || operation.outcome !== 'IN_PROGRESS') throw new Error('INVALID_TRANSITION');
      const instance = this.readSnapshot()?.instance;
      if (!instance || instance.instanceId !== input.instanceId || operation.owningInstanceId !== input.instanceId || instance.lifecycle !== 'RUNNING') throw new Error('BLOCKED');
      const common = input.repositoryIdentity.commonDirectory;
      const candidates = database.prepare(`SELECT project_id,repository_identity FROM projects WHERE removed_at IS NULL AND
        (repository_key=? OR json_extract(repository_identity,'$.commonDirectory.canonicalPath')=? OR
        (json_extract(repository_identity,'$.commonDirectory.device')=? AND json_extract(repository_identity,'$.commonDirectory.inode')=?
        AND json_extract(repository_identity,'$.commonDirectory.birthtimeNs')=?))`).all(input.repositoryKey, common.canonicalPath, common.device, common.inode, common.birthtimeNs) as Row[];
      if (candidates.some(candidate => candidate.repository_identity !== identity)) throw new Error('REPOSITORY_CHANGED');
      let projectId: string, effect: 'CREATED' | 'EXISTING';
      if (candidates.length) { projectId = String(candidates[0]!.project_id); effect = 'EXISTING'; }
      else {
        projectId = requireUuid(this.hooks.newProjectId?.() ?? randomUUID()); effect = 'CREATED';
        database.prepare(`INSERT INTO projects(project_id,display_name,repository_key,repository_identity,reference_checkout,
          base_branch,config_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)`).run(projectId, displayName, input.repositoryKey,
          identity, reference, input.baseBranch, input.completedAt, input.completedAt);
        database.prepare(`INSERT INTO project_observations(project_id,observation_revision,observed_config_revision,request_id,
          observed_instance_id,started_at,completed_at,evidence) VALUES(?,1,1,?,?,?,?,?)`).run(projectId, input.requestId, input.instanceId,
          evidence.startedAt, evidence.completedAt, JSON.stringify(savedEvidence));
        database.prepare('UPDATE registry_metadata SET registry_revision=registry_revision+1 WHERE singleton=1').run();
      }
      const state = this.getProject(projectId)!;
      const result: ProjectOperationResult = { requestId: input.requestId, action: 'REGISTER', projectId, outcome: 'SUCCEEDED', effect,
        configRevision: state.project.configRevision, observationRevision: state.observation!.observationRevision,
        completedAt: input.completedAt, error: null };
      validateProjectOperationResult(result);
      database.prepare("UPDATE project_operations SET project_id=?,phase='FINALIZED',outcome='SUCCEEDED',completed_at=?,result=? WHERE request_id=?")
        .run(projectId, result.completedAt, JSON.stringify(result), input.requestId);
      drafts.push({ type: 'operation.completed', operationId: input.requestId, instanceId: input.instanceId,
        payload: { scope: 'project', action: 'REGISTER', outcome: 'SUCCEEDED', projectId, effect,
          configRevision: result.configRevision, observationRevision: result.observationRevision } });
      this.hooks.checkpoint?.('project.beforeCommit');
      return result;
    }, drafts);
  }
  listPendingProjectOperations(): readonly ProjectOperation[] {
    return (this.registry().prepare("SELECT * FROM project_operations WHERE outcome='IN_PROGRESS' ORDER BY accepted_at,request_id").all() as Row[])
      .map(row => this.projectOperation(row));
  }
  acceptProjectOperation(intent: AcceptProjectOperation): { accepted: boolean; operation: ProjectOperation } {
    this.writable(); this.registry();
    if (intent.ownerUid !== process.getuid!()) throw new Error('UNAUTHORIZED');
    requireUuid(intent.requestId);
    if (!PROJECT_ACTIONS.includes(intent.action) || !/^[a-f0-9]{64}$/.test(intent.payloadHash)) throw new Error('INVALID_REQUEST');
    const resolveExisting = () => {
      if (!this.catalog(intent.requestId, 'PROJECT', intent.action, intent.payloadHash)) return null;
      const operation = this.getProjectOperation(intent.requestId);
      if (!operation || operation.ownerUid !== intent.ownerUid || operation.canonicalIntent !== intent.canonicalIntent) throw new Error('IDEMPOTENCY_CONFLICT');
      return { accepted: false, operation };
    };
    const existing = resolveExisting();
    if (existing) return existing;
    if (typeof intent.canonicalIntent !== 'string' || Buffer.byteLength(intent.canonicalIntent) > 64 * 1024) throw new Error('INVALID_REQUEST');
    let original: { version?: unknown; scope?: unknown; storeId: string; action?: unknown; params: unknown };
    try { original = JSON.parse(intent.canonicalIntent) as typeof original; }
    catch { throw new Error('INVALID_REQUEST'); }
    const snapshot = this.readSnapshot()!;
    if (!original || original.version !== 1 || original.scope !== 'PROJECT' || original.storeId !== snapshot.store.storeId
      || original.action !== intent.action || canonicalProjectIntent(original.storeId, intent.action, original.params) !== intent.canonicalIntent
      || createHash('sha256').update(intent.canonicalIntent).digest('hex') !== intent.payloadHash) throw new Error('INVALID_REQUEST');
    requireUuid(intent.owningInstanceId);
    if (snapshot.instance?.instanceId !== intent.owningInstanceId) throw new Error('UNAUTHORIZED');
    const params = original.params as { projectId?: string; expectedRevision?: string };
    const knownProjectId = params.projectId && this.registry().prepare('SELECT 1 FROM projects WHERE project_id=?').get(params.projectId)
      ? params.projectId : null;
    if (intent.projectId !== knownProjectId || intent.expectedConfigRevision !== (params.expectedRevision ?? null)) throw new Error('INVALID_REQUEST');
    const start = Date.parse(intent.acceptedAt), end = Date.parse(intent.deadlineAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 28_000) throw new Error('INVALID_REQUEST');
    return this.mutate(database => {
      const historical = resolveExisting();
      if (historical) return historical;
      if (this.listPendingProjectOperations().length >= 32) throw new Error('BUSY');
      database.prepare("INSERT INTO request_catalog(request_id,scope,action,payload_hash) VALUES(?,'PROJECT',?,?)")
        .run(intent.requestId, intent.action, intent.payloadHash);
      database.prepare(`INSERT INTO project_operations(request_id,action,payload_hash,canonical_intent,project_id,
        expected_config_revision,owning_instance_id,owner_uid,phase,outcome,accepted_at,deadline_at)
        VALUES(?,?,?,?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?,?)`).run(intent.requestId, intent.action, intent.payloadHash,
        intent.canonicalIntent, intent.projectId, intent.expectedConfigRevision === null ? null : BigInt(intent.expectedConfigRevision),
        intent.owningInstanceId, intent.ownerUid, intent.acceptedAt, intent.deadlineAt);
      return { accepted: true, operation: this.getProjectOperation(intent.requestId)! };
    }, [{ type: 'operation.accepted', operationId: intent.requestId, instanceId: intent.owningInstanceId,
      payload: { scope: 'project', action: intent.action, outcome: 'IN_PROGRESS', ...(intent.projectId ? { projectId: intent.projectId } : {}) } }]);
  }
  setProjectOperationPhase(requestId: string, phase: Exclude<ProjectPhase, 'FINALIZED'>): void {
    requestId = requireUuid(requestId);
    this.registry();
    this.mutate(database => {
      const operation = this.getProjectOperation(requestId);
      if (!operation || operation.outcome !== 'IN_PROGRESS') throw new Error('INVALID_TRANSITION');
      if (operation.phase === phase) return;
      transitionProjectOperation(operation.phase, phase, 'IN_PROGRESS');
      database.prepare('UPDATE project_operations SET phase=? WHERE request_id=?').run(phase, requestId);
    });
  }
  completeProjectOperation(requestId: string, result: ProjectOperationResult): void {
    requestId = requireUuid(requestId);
    this.registry();
    validateProjectOperationResult(result);
    // Successful effects are finalized only by a story's atomic project commit.
    if (result.outcome === 'SUCCEEDED' || result.requestId !== requestId) throw new Error('INVALID_REQUEST');
    if (result.error) {
      const safe = foundationError(result.error.code, { persisted: result.error.persisted, cause: result.error.cause,
        ...(result.error.operationId ? { operationId: result.error.operationId } : {}) });
      if (JSON.stringify(safe) !== JSON.stringify(result.error)) throw new Error('INVALID_REQUEST');
    }
    const pending = this.getProjectOperation(requestId);
    this.mutate(database => {
      const operation = this.getProjectOperation(requestId);
      if (!operation || operation.action !== result.action || operation.projectId !== result.projectId) throw new Error('INVALID_REQUEST');
      transitionProjectOperation(operation.phase, 'FINALIZED', result.outcome);
      database.prepare("UPDATE project_operations SET phase='FINALIZED',outcome=?,completed_at=?,result=? WHERE request_id=?")
        .run(result.outcome, result.completedAt, JSON.stringify(result), requestId);
    }, [{ type: result.outcome === 'BLOCKED' ? 'operation.blocked' : 'operation.failed',
      operationId: requestId, instanceId: this.readSnapshot()?.instance?.instanceId ?? pending?.owningInstanceId ?? null,
      payload: { scope: 'project', action: result.action, outcome: result.outcome, effect: result.effect,
        ...(result.projectId ? { projectId: result.projectId } : {}),
        ...(result.configRevision ? { configRevision: result.configRevision } : {}),
        ...(result.observationRevision ? { observationRevision: result.observationRevision } : {}),
        ...(result.error ? { code: result.error.code } : {}) } }]);
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
      if (existing && ['owningInstanceId', 'kind', 'policyScope', 'generation', 'endpoint', 'credentialRef']
        .some(key => existing[key as keyof ManagedResource] !== resource[key as keyof ManagedResource])) throw new Error('STALE_TARGET');
      if (existing && existing.pid !== resource.pid) {
        const capturedLaunch = existing.pid === null && resource.pid !== null && existing.observation === 'UNKNOWN'
          && existing.releaseState === 'OWNED' && resource.observation === 'UNKNOWN' && resource.releaseState === 'OWNED';
        const lostProof = existing.pid !== null && resource.pid === null && resource.observation === 'UNKNOWN' && resource.releaseState === 'BLOCKED';
        if (!capturedLaunch && !lostProof) throw new Error('STALE_TARGET');
      }
      if (resource.pid !== null && database.prepare('SELECT 1 FROM controller_attempts WHERE pid=? AND ended_at IS NULL').get(resource.pid)) throw new Error('UNAUTHORIZED');
      return database.prepare(`INSERT INTO managed_resources VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(resource_id) DO UPDATE SET pid=excluded.pid,observation=excluded.observation,release_state=excluded.release_state`)
      .run(resource.resourceId, resource.owningInstanceId, resource.kind, resource.policyScope, resource.generation,
        resource.pid, resource.endpoint, resource.credentialRef, resource.observation, resource.releaseState);
    }, resource.releaseState === 'BLOCKED' ? [{type: 'resource.blocked', instanceId: resource.owningInstanceId, payload: {resourceId: resource.resourceId}}] : []);
  }
  listResourceSummaries(instanceId: string, options: { readonly unreleasedOnly?: boolean } = {}) {
    requireUuid(instanceId);
    if (Object.keys(options).some(key => key !== 'unreleasedOnly') || (options.unreleasedOnly !== undefined && typeof options.unreleasedOnly !== 'boolean')) throw new Error('INVALID_REQUEST');
    const rows = this.database?.prepare(`SELECT resource_id,kind,observation,release_state FROM managed_resources WHERE owning_instance_id=?${options.unreleasedOnly ? " AND release_state<>'RELEASED'" : ''} ORDER BY resource_id LIMIT 21`).all(instanceId) as Row[] | undefined;
    return { resources: (rows ?? []).slice(0, 20).map(row => ({ resourceId: String(row.resource_id), kind: row.kind as ManagedResource['kind'], observation: row.observation as ManagedResource['observation'], releaseState: row.release_state as ManagedResource['releaseState'] })), truncated: (rows?.length ?? 0) > 20 };
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
  close(): void { try { this.database?.close(); this.database = null; } finally { this.releaseReadLeases?.(); } }
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
