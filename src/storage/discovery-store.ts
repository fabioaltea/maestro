import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { canonicalDiscoveryIntent, validateDiscoveryGrant } from '../domain/discovery/intent.js';
import { DISCOVERY_LIMITS, isDiscoveryFailure, type DiscoveryFailure, type DiscoveryGrant, type DiscoveryOperation, type DiscoveryResult } from '../domain/discovery/model.js';
import type { DiscoveryAdmission, DiscoveryAdmissionResult } from '../ports/discovery.js';
import { requireDiscoverySchema } from './discovery-schema.js';

type Row = Record<string, string | number | bigint | null>;
export interface DiscoveryMutation {
  <T>(body: () => T, input?: DiscoveryAdmission, terminal?: boolean): T;
}
export interface DiscoveryLedgerOptions { readonly nowMs?: () => number; readonly mutate?: DiscoveryMutation }

export function discoveryStorageFailure(error: unknown): { readonly ok: false; readonly code: DiscoveryFailure } {
  if (error instanceof SyntaxError || (error instanceof Error && error.message === 'INVALID_IDENTIFIER')) return { ok: false, code: 'INVALID_REQUEST' };
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    if (/^SQLITE_(BUSY|LOCKED)/.test(error.code)) return { ok: false, code: 'BUSY' };
    if (/^SQLITE_(CORRUPT|NOTADB)/.test(error.code)) return { ok: false, code: 'STATE_CORRUPT' };
    if (/^SQLITE_CONSTRAINT_(PRIMARYKEY|UNIQUE)/.test(error.code)) return { ok: false, code: 'IDEMPOTENCY_CONFLICT' };
    if (/^SQLITE_CONSTRAINT/.test(error.code)) return { ok: false, code: 'INVALID_REQUEST' };
  }
  return { ok: false, code: error instanceof Error && isDiscoveryFailure(error.message) ? error.message as DiscoveryFailure : 'PERSISTENCE_UNAVAILABLE' };
}
function operationResult(raw: Row[string] | undefined): DiscoveryOperation['result'] {
  if (raw == null) return null;
  const value: unknown = JSON.parse(String(raw));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('STATE_CORRUPT');
  for (const [key, field] of Object.entries(value)) {
    if (typeof field !== 'string' || !['pendingGrantId', 'snapshotId', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'approvalId', 'providerRevision', 'stateRevision'].includes(key)) throw new Error('STATE_CORRUPT');
    if (key.endsWith('Revision')) { requireDecimal(field); if (field === '0') throw new Error('STATE_CORRUPT'); } else requireUuid(field);
  }
  return value as DiscoveryOperation['result'];
}
function operation(row: Row): DiscoveryOperation {
  return { requestId: String(row.request_id), action: row.action as DiscoveryOperation['action'], payloadHash: String(row.payload_hash), canonicalIntent: String(row.canonical_intent),
    phase: row.phase as DiscoveryOperation['phase'], outcome: row.outcome as DiscoveryOperation['outcome'], acceptedAt: String(row.accepted_at), completedAt: row.completed_at === null ? null : String(row.completed_at),
    result: operationResult(row.result), discoveryId: row.discovery_id === null ? null : String(row.discovery_id), runId: row.run_id === null ? null : String(row.run_id), error: row.error === null ? null : isDiscoveryFailure(row.error) ? row.error as DiscoveryFailure : 'PERSISTENCE_UNAVAILABLE' };
}
/** Runs on the existing writer connection. Standalone transactions are for storage tests. */
export function createDiscoveryLedger(database: Database.Database, options: DiscoveryLedgerOptions = {}) {
  requireDiscoverySchema(Number(database.pragma('user_version', { simple: true })));
  const nowMs = options.nowMs ?? Date.now;
  const mutate: DiscoveryMutation = options.mutate ?? ((body) => database.transaction(body).immediate());
  const store = () => database.prepare('SELECT store_id,owner_uid,current_instance_id FROM store WHERE singleton=1').get() as Row;
  const get = (requestId: string) => {
    requireUuid(requestId);
    const row = database.prepare('SELECT * FROM discovery_operations WHERE request_id=?').get(requestId) as Row | undefined;
    return row ? operation(row) : null;
  };
  function validateIntent(canonical: string) {
    const value: unknown = JSON.parse(canonical);
    if (canonicalDiscoveryIntent(value) !== canonical || !value || typeof value !== 'object') throw new Error('INVALID_REQUEST');
    const intent = value as Record<string, unknown>, identity = store();
    if (intent.storeId !== identity.store_id || intent.ownerUid !== Number(identity.owner_uid)) throw new Error('APPROVAL_REQUIRED');
    return intent;
  }
  return {
    operation(requestId: string): DiscoveryOperation | null { return get(requestId); },
    saveGrant(grant: DiscoveryGrant): DiscoveryResult<void> {
      try {
        requireUuid(grant.grantId); const intent = validateIntent(grant.canonicalIntent);
        if (!['configure', 'start', 'answer', 'correct', 'approve', 'cancel'].includes(String(intent.action)) || grant.consumedByRequestId !== null
          || !Number.isSafeInteger(grant.expiresAtMs) || grant.expiresAtMs <= nowMs() || grant.expiresAtMs - nowMs() > DISCOVERY_LIMITS.grantMs) throw new Error('APPROVAL_REQUIRED');
        return mutate(() => {
          const existing = database.prepare('SELECT canonical_intent,expires_at_ms,consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(grant.grantId) as Row | undefined;
          if (existing) {
            if (existing.canonical_intent !== grant.canonicalIntent || Number(existing.expires_at_ms) !== grant.expiresAtMs || existing.consumed_by_request_id !== null) throw new Error('IDEMPOTENCY_CONFLICT');
            return { ok: true, value: undefined } as const;
          }
          // Reserve the32nd grant for cancellation. A newer intentional cancel
          // preparation revokes only unused cancel grants, never work or approvals.
          if (intent.action === 'cancel') database.prepare("DELETE FROM discovery_grants WHERE consumed_by_request_id IS NULL AND json_extract(canonical_intent,'$.action')='cancel'").run();
          const count = Number((database.prepare('SELECT count(*) AS n FROM discovery_grants WHERE consumed_by_request_id IS NULL AND expires_at_ms>?').get(nowMs()) as Row).n);
          if (count >= (intent.action === 'cancel' ? DISCOVERY_LIMITS.activeGrants : DISCOVERY_LIMITS.activeGrants - 1)) throw new Error('DISCOVERY_LIMIT');
          database.prepare('INSERT INTO discovery_grants(grant_id,canonical_intent,expires_at_ms,consumed_by_request_id) VALUES(?,?,?,NULL)').run(grant.grantId, grant.canonicalIntent, grant.expiresAtMs);
          return { ok: true, value: undefined } as const;
        }, undefined, intent.action === 'cancel');
      } catch (error) { return discoveryStorageFailure(error); }
    },
    admit(input: DiscoveryAdmission): DiscoveryResult<DiscoveryAdmissionResult> {
      try {
        requireUuid(input.requestId); requireUuid(input.instanceId);
        if (input.ownerUid !== Number(store().owner_uid)) throw new Error('APPROVAL_REQUIRED');
        // Resolve a replay before checking grant expiry, slot, or current state.
        const previous = get(input.requestId);
        if (previous) {
          if (previous.action !== input.action || previous.payloadHash !== input.payloadHash || previous.canonicalIntent !== input.canonicalIntent) throw new Error('IDEMPOTENCY_CONFLICT');
          if (input.startStage !== 'ACTIVATE' || previous.phase === 'FINALIZED') return { ok: true, value: { operation: previous, inserted: false } };
        }
        const intent = validateIntent(input.canonicalIntent), identity = store();
        if (input.payloadHash !== createHash('sha256').update(input.canonicalIntent).digest('hex') || input.action !== intent.action
          || input.ownerUid !== Number(identity.owner_uid) || identity.current_instance_id !== input.instanceId) throw new Error('INVALID_REQUEST');
        if (!Number.isSafeInteger(input.nowMs)) throw new Error('APPROVAL_REQUIRED');
        return mutate(() => {
          const original = get(input.requestId);
          if (original) {
            if (original.action !== input.action || original.payloadHash !== input.payloadHash || original.canonicalIntent !== input.canonicalIntent) throw new Error('IDEMPOTENCY_CONFLICT');
            if (input.startStage !== 'ACTIVATE' || original.phase === 'FINALIZED') return { ok: true, value: { operation: original, inserted: false } } as const;
            const owner = database.prepare('SELECT owning_instance_id FROM discovery_operations WHERE request_id=?').get(input.requestId) as Row;
            if (original.phase !== 'ACCEPTED' || original.outcome !== 'IN_PROGRESS' || original.result?.pendingGrantId !== input.grantId
              || owner.owning_instance_id !== input.instanceId) throw new Error('APPROVAL_REQUIRED');
          }
          if (input.startStage !== undefined && (!['PREPARE', 'ACTIVATE'].includes(input.startStage) || !['start', 'answer', 'correct'].includes(input.action))) throw new Error('INVALID_REQUEST');
          if (input.startStage === 'ACTIVATE' && !original) throw new Error('APPROVAL_REQUIRED');
          if (!original && database.prepare('SELECT 1 FROM request_catalog WHERE request_id=?').get(input.requestId)) throw new Error('IDEMPOTENCY_CONFLICT');
          const remote = !['preview', 'check', 'discard'].includes(input.action);
          if (remote) {
            if (!input.grantId) throw new Error('APPROVAL_REQUIRED'); requireUuid(input.grantId);
            const grant = database.prepare('SELECT * FROM discovery_grants WHERE grant_id=?').get(input.grantId) as Row | undefined;
            if (!grant) throw new Error('APPROVAL_REQUIRED');
            const consumption = validateDiscoveryGrant({ canonicalIntent: String(grant.canonical_intent), expiresAtMs: Number(grant.expires_at_ms), consumedByRequestId: grant.consumed_by_request_id === null ? null : String(grant.consumed_by_request_id) }, input.canonicalIntent, input.requestId, nowMs());
            if (consumption !== 'CONSUME' && !(input.action === 'answer' && input.startStage === 'ACTIVATE' && consumption === 'REPLAY')) throw new Error('APPROVAL_REQUIRED');
          } else if (input.grantId !== null || input.acquireSlot || input.run !== null) throw new Error('INVALID_REQUEST');
          if (input.action === 'preview') {
            const snapshots = Number((database.prepare('SELECT count(*) AS n FROM discovery_snapshots WHERE pinned=0 AND expires_at_ms>?').get(nowMs()) as Row).n);
            const pending = Number((database.prepare("SELECT count(*) AS n FROM discovery_operations WHERE action='preview' AND phase<>'FINALIZED'").get() as Row).n);
            if (snapshots + pending >= DISCOVERY_LIMITS.previews) throw new Error('DISCOVERY_LIMIT');
          }
          const discovery = input.discovery, run = input.run;
          if (input.startStage === 'PREPARE' || input.acquireSlot) {
            const pending = database.prepare("SELECT request_id FROM discovery_operations WHERE action IN ('start','correct') AND phase<>'FINALIZED' AND json_extract(result,'$.pendingGrantId') IS NOT NULL AND request_id<>? LIMIT 1").get(input.requestId);
            if (pending) throw new Error('DISCOVERY_BUSY');
          }
          if (input.startStage === 'PREPARE') {
            if (discovery !== null || run !== null || input.acquireSlot) throw new Error('INVALID_REQUEST');
            const slot = database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as Row;
            let discoveryId: string | null = null;
            if (input.action === 'start') { if (slot.discovery_id !== null) throw new Error('DISCOVERY_BUSY'); }
            else if (input.action === 'correct') {
              const d = database.prepare('SELECT * FROM discoveries WHERE discovery_id=?').get(String(intent.targetId)) as Row | undefined;
              const payload = intent.payload as Record<string, unknown>;
              if (!d || !['READY_FOR_REVIEW', 'APPROVED'].includes(String(d.state)) || String(d.state_revision) !== intent.stateRevision || input.expectedStateRevision !== intent.stateRevision || d.latest_document_revision_id !== payload.revisionId || slot.discovery_id !== null) throw new Error('APPROVAL_STALE');
              discoveryId = String(d.discovery_id);
            } else {
              const payload = intent.payload as Record<string, unknown>, q = database.prepare('SELECT * FROM discovery_questions WHERE question_id=?').get(String(payload.questionId)) as Row | undefined;
              const d = q ? database.prepare('SELECT * FROM discoveries WHERE discovery_id=?').get(q.discovery_id) as Row | undefined : undefined;
              if (!q || !d || intent.targetId !== q.question_id || String(q.question_revision) !== payload.questionRevision || d.state !== 'WAITING_USER' || slot.discovery_id !== d.discovery_id
                || String(d.state_revision) !== intent.stateRevision || input.expectedStateRevision !== intent.stateRevision || d.snapshot_id !== intent.snapshotId || String(d.config_revision) !== intent.configRevision || String(d.provider_revision) !== intent.providerRevision) throw new Error('APPROVAL_STALE');
              if (database.prepare("SELECT 1 FROM discovery_operations WHERE discovery_id=? AND action='answer' AND phase<>'FINALIZED'").get(d.discovery_id)) throw new Error('DISCOVERY_BUSY');
              discoveryId = String(d.discovery_id);
            }
            database.prepare("INSERT INTO discovery_operations(request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at,result,discovery_id) VALUES(?,?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?,?,?)")
              .run(input.requestId, input.action, input.payloadHash, input.canonicalIntent, input.ownerUid, input.instanceId, input.acceptedAt, JSON.stringify({ pendingGrantId: input.grantId }), discoveryId);
            if (input.action === 'answer') database.prepare('UPDATE discovery_grants SET consumed_by_request_id=? WHERE grant_id=? AND consumed_by_request_id IS NULL').run(input.requestId, input.grantId);
            return { ok: true, value: { operation: get(input.requestId)!, inserted: true } } as const;
          }
          if (input.startStage === 'ACTIVATE') {
            const provider = database.prepare('SELECT configuration FROM discovery_provider WHERE singleton=1').get() as Row | undefined;
            const c = provider ? JSON.parse(String(provider.configuration)) as Record<string, unknown> : null;
            if (!c || c.revision !== intent.providerRevision || c.qualificationDigest !== intent.providerProfileDigest || c.modelId !== intent.modelId) throw new Error('APPROVAL_STALE');
          }
          if (input.acquireSlot) {
            if (!discovery || !run || !input.grantId || !['start', 'answer', 'correct'].includes(input.action)) throw new Error('INVALID_REQUEST');
            requireUuid(discovery.discoveryId); requireUuid(discovery.sessionId); requireUuid(discovery.projectId); requireUuid(discovery.snapshotId);
            requireUuid(run.runId); requireUuid(run.generation);
            const slot = database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as Row;
            if (slot.discovery_id !== null && slot.discovery_id !== discovery.discoveryId) throw new Error('DISCOVERY_BUSY');
            const project = database.prepare('SELECT config_revision,removed_at FROM projects WHERE project_id=?').get(discovery.projectId) as Row | undefined;
            if (!project) throw new Error('PROJECT_NOT_FOUND'); if (project.removed_at !== null) throw new Error('PROJECT_REMOVED');
            const snapshot = database.prepare('SELECT * FROM discovery_snapshots WHERE snapshot_id=?').get(discovery.snapshotId) as Row | undefined;
            if (!snapshot || snapshot.state !== 'SEALED' || snapshot.project_id !== discovery.projectId || String(snapshot.config_revision) !== discovery.configRevision
              || String(project.config_revision) !== discovery.configRevision || snapshot.context_digest !== run.contextDigest || (Number(snapshot.pinned) === 0 && (snapshot.expires_at_ms === null || Number(snapshot.expires_at_ms) <= nowMs()))) throw new Error('CONTEXT_CHANGED');
            if (discovery.storeId !== identity.store_id || (input.action === 'start' && intent.targetId !== discovery.projectId) || (input.action === 'correct' && intent.targetId !== discovery.discoveryId) || intent.snapshotId !== discovery.snapshotId
              || intent.configRevision !== discovery.configRevision || intent.providerRevision !== run.providerRevision || intent.providerProfileDigest !== run.profileDigest
              || intent.modelId !== run.modelId || intent.contextDigest !== run.contextDigest || discovery.providerRevision !== run.providerRevision
              || !['RUNNING', 'UPDATING'].includes(discovery.state) || discovery.currentRunId !== run.runId || run.discoveryId !== discovery.discoveryId || run.requestId !== input.requestId || run.grantId !== input.grantId
              || discovery.error !== null || run.error !== null || run.startedAt !== null || run.endedAt !== null || run.phase !== 'SPAWN_INTENT' || run.outcome !== 'RUNNING') throw new Error('INVALID_REQUEST');
            const current = database.prepare('SELECT state,state_revision,session_id,snapshot_id,project_id FROM discoveries WHERE discovery_id=?').get(discovery.discoveryId) as Row | undefined;
            if (input.action === 'start') {
              if (current || input.expectedStateRevision !== null || discovery.state !== 'RUNNING' || discovery.stateRevision !== '1' || (intent.stateRevision !== null && intent.stateRevision !== '1') || run.turnIndex !== 1) throw new Error('IDEMPOTENCY_CONFLICT');
              const count = Number((database.prepare('SELECT count(*) AS n FROM discoveries').get() as Row).n);
              if (count >= DISCOVERY_LIMITS.archiveDiscoveries) throw new Error('DISCOVERY_LIMIT');
              database.prepare(`INSERT INTO discoveries(discovery_id,project_id,session_id,state,state_revision,snapshot_id,config_revision,provider_revision,current_run_id,latest_document_revision_id,created_at,updated_at,error)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(discovery.discoveryId, discovery.projectId, discovery.sessionId, discovery.state, discovery.stateRevision, discovery.snapshotId, discovery.configRevision, discovery.providerRevision, run.runId, discovery.latestDocumentRevisionId, discovery.createdAt, discovery.updatedAt, discovery.error);
            } else {
              if (!current || intent.stateRevision !== input.expectedStateRevision || String(current.state_revision) !== input.expectedStateRevision || current.session_id !== discovery.sessionId || current.snapshot_id !== discovery.snapshotId || current.project_id !== discovery.projectId) throw new Error('APPROVAL_STALE');
              if (input.action === 'answer') {
                const payload = intent.payload as Record<string, unknown>;
                const question = database.prepare('SELECT discovery_id,status FROM discovery_questions WHERE question_id=?').get(String(payload.questionId)) as Row | undefined;
                const saved = input.startStage === 'ACTIVATE' ? database.prepare('SELECT 1 FROM discovery_answers WHERE request_id=? AND question_id=? AND answer_id=? AND answer_revision=?').get(input.requestId, String(payload.questionId), String(payload.answerId), String(payload.answerRevision)) : null;
                if (intent.targetId !== payload.questionId || current.state !== 'WAITING_USER' || discovery.state !== 'RUNNING' || !question || question.discovery_id !== discovery.discoveryId || (input.startStage === 'ACTIVATE' ? !saved : question.status !== 'OPEN')) throw new Error('APPROVAL_STALE');
              } else if (!['READY_FOR_REVIEW', 'APPROVED'].includes(String(current.state)) || discovery.state !== 'UPDATING') throw new Error('APPROVAL_STALE');
              if (BigInt(discovery.stateRevision) !== BigInt(input.expectedStateRevision!) + 1n) throw new Error('INVALID_REQUEST');
              const previous = database.prepare('SELECT max(turn_index) AS turn FROM discovery_runs WHERE discovery_id=?').get(discovery.discoveryId) as Row;
              if (run.turnIndex !== Number(previous.turn) + 1 || run.turnIndex > DISCOVERY_LIMITS.turns) throw new Error('DISCOVERY_LIMIT');
              database.prepare('UPDATE discoveries SET state=?,state_revision=?,current_run_id=?,updated_at=? WHERE discovery_id=?').run(discovery.state, discovery.stateRevision, run.runId, discovery.updatedAt, discovery.discoveryId);
            }
          } else if (run !== null) throw new Error('INVALID_REQUEST');
          if (input.startStage === 'ACTIVATE') {
            database.prepare("UPDATE discovery_operations SET discovery_id=?,run_id=?,result=NULL WHERE request_id=?").run(discovery?.discoveryId ?? null, run?.runId ?? null, input.requestId);
          } else {
            database.prepare(`INSERT INTO discovery_operations(request_id,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,accepted_at,discovery_id,run_id)
              VALUES(?,?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?,?,?)`).run(input.requestId, input.action, input.payloadHash, input.canonicalIntent, input.ownerUid, input.instanceId, input.acceptedAt, discovery?.discoveryId ?? null, run?.runId ?? null);
          }
          if (remote) database.prepare('UPDATE discovery_grants SET consumed_by_request_id=? WHERE grant_id=? AND consumed_by_request_id IS NULL').run(input.requestId, input.grantId);
          if (run && discovery) {
            database.prepare(`INSERT INTO discovery_runs(run_id,discovery_id,generation,turn_index,grant_id,request_id,context_digest,input_digest,provider_id,provider_revision,profile_digest,model_id,phase,outcome,started_at,ended_at,output_watermark,error)
              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.runId, run.discoveryId, run.generation, run.turnIndex, run.grantId, run.requestId, run.contextDigest, run.inputDigest, run.providerId, run.providerRevision, run.profileDigest, run.modelId, run.phase, run.outcome, run.startedAt, run.endedAt, run.outputWatermark, run.error);
            database.prepare('UPDATE discovery_slot SET discovery_id=?,acquired_at=? WHERE singleton=1').run(discovery.discoveryId, input.acceptedAt);
            database.prepare('UPDATE discovery_snapshots SET pinned=1,expires_at_ms=NULL WHERE snapshot_id=?').run(discovery.snapshotId);
            if (input.startStage === 'ACTIVATE') database.prepare("UPDATE discovery_operations SET phase='FINALIZED',outcome='SUCCEEDED',completed_at=?,result=? WHERE request_id=?")
              .run(new Date(nowMs()).toISOString(), JSON.stringify({ discoveryId: discovery.discoveryId, sessionId: discovery.sessionId, runId: run.runId }), input.requestId);
          }
          return { ok: true, value: { operation: get(input.requestId)!, inserted: true } } as const;
        }, input);
      } catch (error) { return discoveryStorageFailure(error); }
    },
  };
}
