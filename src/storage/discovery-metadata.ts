import type Database from 'better-sqlite3';
import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { validateDiscoveryText } from '../domain/discovery/intent.js';
import { DISCOVERY_LIMITS, isDiscoveryFailure, type DiscoveryRecord, type DiscoveryResult, type DiscoveryRun } from '../domain/discovery/model.js';
import { transitionDiscovery, transitionRunPhase, holdsDiscoverySlot } from '../domain/discovery/state.js';
import type { DiscoveryMetadataQuery, DiscoveryMetadataReply, DiscoveryMetadataChange, DiscoverySnapshot, DiscoveryArtifact } from '../ports/discovery.js';
import type { ProviderConfiguration } from '../ports/provider.js';
import { createDiscoveryLedger, discoveryStorageFailure } from './discovery-store.js';
import { requireDiscoverySchema } from './discovery-schema.js';

type Row = Record<string, string | number | bigint | null>;
const MAX_PAGE_BYTES = DISCOVERY_LIMITS.envelopeBytes - 4096;
function fail(code = 'INVALID_REQUEST'): never { throw new Error(code); }
function errorResult(error: unknown): { readonly ok: false; readonly code: import('../domain/discovery/model.js').DiscoveryFailure } {
  if (error instanceof SyntaxError || error instanceof RangeError || (error instanceof Error && error.message === 'INVALID_IDENTIFIER')) return { ok: false, code: 'INVALID_REQUEST' };
  return discoveryStorageFailure(error);
}
const json = (value: unknown, max = 32768) => { const text = JSON.stringify(value); if (Buffer.byteLength(text) > max) fail('CONTEXT_LIMIT'); return text; };
const cleanCode = (value: unknown) => value === null ? null : isDiscoveryFailure(value) ? value : 'PERSISTENCE_UNAVAILABLE';
const nullable = (value: unknown) => value === null ? null : String(value);
const positive = (value: string) => { requireDecimal(value); if (value === '0') fail(); };
function exact(value: object, keys: readonly string[]) { if (Object.keys(value).some(key => !keys.includes(key))) fail(); }
function digest(value: string) { if (!/^[a-f0-9]{64}$/.test(value)) fail(); }
function utc(value: string) { if (new Date(value).toISOString() !== value) fail(); }
function discovery(row: Row, storeId: string): DiscoveryRecord {
  return { storeId, projectId: String(row.project_id), discoveryId: String(row.discovery_id), sessionId: String(row.session_id),
    state: row.state as DiscoveryRecord['state'], stateRevision: String(row.state_revision), snapshotId: String(row.snapshot_id),
    configRevision: String(row.config_revision), providerRevision: String(row.provider_revision), currentRunId: nullable(row.current_run_id),
    latestDocumentRevisionId: nullable(row.latest_document_revision_id), createdAt: String(row.created_at), updatedAt: String(row.updated_at), error: cleanCode(row.error) };
}
function run(row: Row): DiscoveryRun {
  return { runId: String(row.run_id), discoveryId: String(row.discovery_id), generation: String(row.generation), turnIndex: Number(row.turn_index),
    grantId: String(row.grant_id), requestId: String(row.request_id), contextDigest: String(row.context_digest), inputDigest: String(row.input_digest),
    providerId: String(row.provider_id), providerRevision: String(row.provider_revision), profileDigest: String(row.profile_digest), modelId: String(row.model_id),
    phase: row.phase as DiscoveryRun['phase'], outcome: row.outcome as DiscoveryRun['outcome'], startedAt: nullable(row.started_at), endedAt: nullable(row.ended_at), outputWatermark: String(row.output_watermark), error: cleanCode(row.error) };
}
export interface DiscoveryMetadataMutation { <T>(body: () => T, change?: DiscoveryMetadataChange): T }
export interface DiscoveryMetadataOptions { readonly mutate?: DiscoveryMetadataMutation; readonly nowMs?: () => number }
/** Closed private DTOs on the existing writer; no filesystem, provider or project execution. */
export function createDiscoveryMetadata(database: Database.Database, options: DiscoveryMetadataOptions = {}) {
  requireDiscoverySchema(Number(database.pragma('user_version', { simple: true })));
  const mutate: DiscoveryMetadataMutation = options.mutate ?? (body => database.transaction(body).immediate());
  const identity = () => database.prepare('SELECT store_id,owner_uid FROM store WHERE singleton=1').get() as Row;
  const one = (table: string, key: string, id: string): Row | undefined => database.prepare(`SELECT * FROM ${table} WHERE ${key}=?`).get(requireUuid(id)) as Row | undefined;
  function current(id: string, revision: string) {
    const row = one('discoveries', 'discovery_id', id);
    if (!row || String(row.state_revision) !== revision) fail('APPROVAL_STALE');
    return row;
  }
  function correlate(discoveryId: string, runId: string, generation: string) {
    const row = one('discovery_runs', 'run_id', runId);
    if (!row || row.discovery_id !== discoveryId || row.generation !== generation) fail('STALE_TARGET');
    return row;
  }
  function reference(artifactId: string, kind: string, sha?: string) {
    const row = one('discovery_artifacts', 'artifact_id', artifactId);
    if (!row || !['PUBLISHED', 'REFERENCED'].includes(String(row.state)) || row.kind !== kind || (sha && row.sha256 !== sha)) fail('ARTIFACT_CORRUPT');
    database.prepare("UPDATE discovery_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(artifactId);
    return row;
  }
  function changeState(row: Row, next: DiscoveryRecord['state'], exitVerified: boolean, approvalValidated = false) {
    transitionDiscovery(row.state as DiscoveryRecord['state'], next, { exitVerified, approvalValidated });
    database.prepare('UPDATE discoveries SET state=?,state_revision=state_revision+1,updated_at=? WHERE discovery_id=?').run(next, new Date().toISOString(), row.discovery_id);
    if (!holdsDiscoverySlot(next)) database.prepare('UPDATE discovery_slot SET discovery_id=NULL,acquired_at=NULL WHERE discovery_id=?').run(row.discovery_id);
  }
  function mapped(kind: string, row: Row): unknown {
    const storeId = String(identity().store_id);
    if (kind === 'discovery' || kind === 'discoveries') return discovery(row, storeId);
    if (kind === 'run') return run(row);
    if (kind === 'snapshot') return { ...JSON.parse(String(row.metadata)), snapshotId: String(row.snapshot_id), projectId: String(row.project_id), configRevision: String(row.config_revision),
      state: row.state, contextDigest: row.context_digest, manifestArtifactId: row.manifest_artifact_id, corpusArtifactId: row.corpus_artifact_id, createdAt: row.created_at, expiresAtMs: row.expires_at_ms === null ? null : Number(row.expires_at_ms), pinned: Number(row.pinned) === 1 };
    if (kind === 'artifact') return { artifactId: row.artifact_id, kind: row.kind, relativeKey: row.relative_key, sha256: row.sha256, allocatedBytes: Number(row.allocated_bytes), state: row.state, referenceCount: Number(row.ref_count) };
    if (kind === 'process' || kind === 'processes') return { runId: row.run_id, generation: row.generation, owningInstanceId: row.owning_instance_id, hostPid: row.host_pid === null ? null : Number(row.host_pid), providerPid: row.provider_pid === null ? null : Number(row.provider_pid), hostEndpoint: row.host_endpoint, credentialRef: row.credential_ref, observation: row.observation, releaseState: row.release_state, policy: row.policy };
    if (kind === 'questions') return { questionId: row.question_id, discoveryId: row.discovery_id, runId: row.originating_run_id, revision: String(row.question_revision), text: row.text, reason: row.reason, section: row.section, status: row.status };
    if (kind === 'answers') return { answerId: row.answer_id, questionId: row.question_id, questionRevision: String(row.question_revision), revision: String(row.answer_revision), requestId: row.request_id, kind: row.kind, text: row.value, confirmedAt: row.user_confirmed_at };
    if (kind === 'revision' || kind === 'revisions') return { revisionId: row.revision_id, discoveryId: row.discovery_id, revisionNumber: String(row.revision_number), parentRevisionId: row.parent_revision_id, snapshotId: row.snapshot_id, contextDigest: row.context_digest, artifactId: row.bundle_artifact_id, bundleDigest: row.bundle_digest, bytes: Number(row.bytes), provenanceValidated: Number(row.provenance_validated) === 1, status: row.status };
    if (kind === 'approval') return { approvalId: row.approval_id, requestId: row.request_id, storeId, discoveryId: row.discovery_id, revisionId: row.revision_id, projectId: row.project_id, configRevision: String(row.config_revision), bundleDigest: row.bundle_digest, contextDigest: row.context_digest, acceptedUnknownIds: JSON.parse(String(row.accepted_unknown_ids)), ownerUid: Number(row.owner_uid), approvedAt: row.approved_at, checkedAt: row.checked_at };
    if (kind === 'output') return { runId: row.run_id, seq: String(row.seq), artifactId: row.artifact_id, sha256: row.sha256, bytes: Number(row.bytes), kind: row.kind, createdAt: row.created_at, truncated: Number(row.truncated) === 1 };
    return fail();
  }
  return {
    read<Q extends DiscoveryMetadataQuery>(query: Q): DiscoveryResult<DiscoveryMetadataReply<Q>> {
      try {
        const singular: Record<string, [string, string]> = { snapshot: ['discovery_snapshots', 'snapshot_id'], discovery: ['discoveries', 'discovery_id'], run: ['discovery_runs', 'run_id'], process: ['discovery_processes', 'run_id'], revision: ['discovery_revisions', 'revision_id'], approval: ['discovery_approvals', 'revision_id'], artifact: ['discovery_artifacts', 'artifact_id'] };
        const plural: Record<string, [string, string, string]> = { discoveries: ['discoveries', 'project_id', 'created_at,discovery_id'], questions: ['discovery_questions', 'discovery_id', 'question_id'], answers: ['discovery_answers a JOIN discovery_questions q ON q.question_id=a.question_id', 'q.discovery_id', 'a.question_id,a.answer_revision,a.answer_id'], revisions: ['discovery_revisions', 'discovery_id', 'revision_number'], processes: ['discovery_processes', '', 'run_id'], output: ['discovery_output', 'run_id', 'seq'] };
        let data: unknown;
        if (query.kind === 'provider') { exact(query, ['kind']); const row = database.prepare('SELECT configuration FROM discovery_provider WHERE singleton=1').get() as Row | undefined; data = row ? JSON.parse(String(row.configuration)) : null; }
        else if (Object.hasOwn(singular, query.kind)) {
          exact(query, ['kind', 'id']); const [table, key] = singular[query.kind]!;
          const row = one(table, key, (query as { id: string }).id); data = row ? mapped(query.kind, row) : null;
        } else if (Object.hasOwn(plural, query.kind)) {
          exact(query, ['kind', 'id', 'offset', 'limit']);
          const q = query as { id?: string; offset?: number; limit?: number }, offset = q.offset ?? 0, limit = q.limit ?? 20;
          if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 20) fail();
          const [table, key, order] = plural[query.kind]!; if (key) requireUuid(q.id!); else if (q.id !== undefined) fail();
          const rows = database.prepare(`SELECT ${query.kind === 'answers' ? 'a.*' : '*'} FROM ${table}${key ? ` WHERE ${key}=?` : ''} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...(key ? [q.id!] : []), limit + 1, offset) as Row[];
          const items: unknown[] = [];
          for (const row of rows.slice(0, limit)) { const value = mapped(query.kind, row); if (Buffer.byteLength(JSON.stringify({ items: [...items, value], nextOffset: offset + items.length + 1 })) > MAX_PAGE_BYTES) break; items.push(value); }
          if (rows.length && !items.length) fail('CONTEXT_LIMIT');
          data = { items, nextOffset: rows.length > items.length ? offset + items.length : null };
        } else fail();
        json(data, MAX_PAGE_BYTES);
        return { ok: true, value: { kind: query.kind, data } as DiscoveryMetadataReply<Q> };
      } catch (error) { return errorResult(error); }
    },
    commit(change: DiscoveryMetadataChange): DiscoveryResult<void> {
      try {
        mutate(() => {
          if (change.kind === 'provider') {
            exact(change, ['kind', 'configuration', 'expectedRevision']); const c = change.configuration;
            exact(c, ['providerId', 'revision', 'binaryRealpath', 'binarySha256', 'binaryVersion', 'modelId', 'authProfileRef', 'policyVersion', 'qualificationDigest', 'configuredAt']);
            positive(c.revision); digest(c.binarySha256); digest(c.qualificationDigest); utc(c.configuredAt);
            for (const value of Object.values(c)) { if (typeof value !== 'string' || !value.length) fail(); validateDiscoveryText(value, 4096); }
            const old = database.prepare('SELECT config_revision FROM discovery_provider WHERE singleton=1').get() as Row | undefined;
            if ((old ? String(old.config_revision) : null) !== change.expectedRevision || BigInt(c.revision) !== BigInt(change.expectedRevision ?? '0') + 1n) fail('APPROVAL_STALE');
            database.prepare('INSERT INTO discovery_provider(singleton,config_revision,configuration) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET config_revision=excluded.config_revision,configuration=excluded.configuration').run(c.revision, json(c, 8192));
          } else if (change.kind === 'artifact') {
            exact(change, ['kind', 'value']); const a = change.value; requireUuid(a.artifactId); if (a.relativeKey !== a.artifactId) fail(); if (a.sha256) digest(a.sha256);
            const old = one('discovery_artifacts', 'artifact_id', a.artifactId);
            if (old && (old.relative_key !== a.relativeKey || old.kind !== a.kind || (old.state !== 'RESERVED' && (old.sha256 !== a.sha256 || Number(old.allocated_bytes) !== a.allocatedBytes)))) fail('ARTIFACT_CORRUPT');
            database.prepare(`INSERT INTO discovery_artifacts(artifact_id,kind,relative_key,sha256,allocated_bytes,state,ref_count) VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(artifact_id) DO UPDATE SET sha256=excluded.sha256,allocated_bytes=excluded.allocated_bytes,state=excluded.state,ref_count=excluded.ref_count`).run(a.artifactId, a.kind, a.relativeKey, a.sha256, a.allocatedBytes, a.state, a.referenceCount);
          } else if (change.kind === 'snapshot') {
            exact(change, ['kind', 'value']); const s: DiscoverySnapshot = change.value; requireUuid(s.snapshotId); requireUuid(s.projectId); positive(s.configRevision); utc(s.createdAt);
            if (s.selectors.length > 16 || s.fileCount > 200 || s.byteCount > 1024 * 1024 || s.fileCount < 0 || s.byteCount < 0) fail('CONTEXT_LIMIT');
            const metadata = json({ selectors: s.selectors, fileCount: s.fileCount, byteCount: s.byteCount, omissions: s.omissions });
            const old = one('discovery_snapshots', 'snapshot_id', s.snapshotId);
            if (old?.state === 'SEALED') { if (old.context_digest !== s.contextDigest || old.manifest_artifact_id !== s.manifestArtifactId || old.corpus_artifact_id !== s.corpusArtifactId || old.metadata !== metadata) fail('CONTEXT_CHANGED'); return; }
            const project = one('projects', 'project_id', s.projectId); if (!project || project.removed_at !== null || String(project.config_revision) !== s.configRevision) fail('CONTEXT_CHANGED');
            if (!old && s.pinned) fail();
            if (!Array.isArray(s.selectors) || !Array.isArray(s.omissions) || !s.selectors.length || s.omissions.length > 32 || !Number.isInteger(s.fileCount) || !Number.isInteger(s.byteCount)) fail();
            for (const selector of s.selectors) validateDiscoveryText(selector, 4096);
            for (const omission of s.omissions) validateDiscoveryText(omission, 128);
            if (!s.pinned && (s.expiresAtMs === null || s.expiresAtMs <= (options.nowMs ?? Date.now)() || s.expiresAtMs - (options.nowMs ?? Date.now)() > DISCOVERY_LIMITS.previewMs)) fail();
            if (!old && Number((database.prepare('SELECT count(*) AS n FROM discovery_snapshots WHERE pinned=0 AND expires_at_ms>?').get((options.nowMs ?? Date.now)()) as Row).n) >= 4) fail('DISCOVERY_LIMIT');
            if (s.state === 'SEALED') { digest(s.contextDigest!); reference(s.manifestArtifactId!, 'MANIFEST'); reference(s.corpusArtifactId!, 'CORPUS'); }
            database.prepare(`INSERT INTO discovery_snapshots(snapshot_id,project_id,config_revision,state,context_digest,manifest_artifact_id,corpus_artifact_id,created_at,expires_at_ms,pinned,metadata) VALUES(?,?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(snapshot_id) DO UPDATE SET state=excluded.state,context_digest=excluded.context_digest,manifest_artifact_id=excluded.manifest_artifact_id,corpus_artifact_id=excluded.corpus_artifact_id,expires_at_ms=excluded.expires_at_ms,pinned=excluded.pinned,metadata=excluded.metadata`).run(s.snapshotId, s.projectId, s.configRevision, s.state, s.contextDigest, s.manifestArtifactId, s.corpusArtifactId, s.createdAt, s.expiresAtMs, s.pinned ? 1 : 0, metadata);
          } else if (change.kind === 'process') {
            exact(change, ['kind', 'value']); const p = change.value; const r = one('discovery_runs', 'run_id', p.runId); if (!r || r.generation !== p.generation) fail('STALE_TARGET');
            if (p.releaseState === 'RELEASED' && p.observation !== 'ABSENT') fail('RESOURCE_IDENTITY_UNKNOWN');
            const old = one('discovery_processes', 'run_id', p.runId); if (old && (old.generation !== p.generation || old.owning_instance_id !== p.owningInstanceId || old.host_endpoint !== p.hostEndpoint || old.credential_ref !== p.credentialRef || old.policy !== p.policy)) fail('STALE_TARGET');
            database.prepare(`INSERT INTO discovery_processes(run_id,generation,owning_instance_id,host_pid,provider_pid,host_endpoint,credential_ref,observation,release_state,policy) VALUES(?,?,?,?,?,?,?,?,?,?)
              ON CONFLICT(run_id) DO UPDATE SET host_pid=excluded.host_pid,provider_pid=excluded.provider_pid,observation=excluded.observation,release_state=excluded.release_state`).run(p.runId, p.generation, p.owningInstanceId, p.hostPid, p.providerPid, p.hostEndpoint, p.credentialRef, p.observation, p.releaseState, p.policy);
          } else if (change.kind === 'run') {
            exact(change, ['kind', 'value', 'expectedPhase', 'exitVerified']); const r = change.value; if (r.error !== null && !isDiscoveryFailure(r.error)) fail(); const old = correlate(r.discoveryId, r.runId, r.generation);
            if (old.phase !== change.expectedPhase) fail('STALE_TARGET'); transitionRunPhase(change.expectedPhase, r.phase, { exitVerified: change.exitVerified });
            if (r.phase !== 'EXIT_OBSERVED' && r.phase !== 'FINALIZED' && r.outcome !== 'RUNNING') fail();
            database.prepare('UPDATE discovery_runs SET phase=?,outcome=?,started_at=?,ended_at=?,error=? WHERE run_id=?').run(r.phase, r.outcome, r.startedAt, r.endedAt, r.error, r.runId);
          } else if (change.kind === 'state') {
            exact(change, ['kind', 'discoveryId', 'expectedRevision', 'next', 'exitVerified']); if (change.next === 'APPROVED') fail('APPROVAL_REQUIRED');
            changeState(current(change.discoveryId, change.expectedRevision), change.next, change.exitVerified);
          } else if (change.kind === 'questions') {
            exact(change, ['kind', 'discoveryId', 'runId', 'generation', 'expectedRevision', 'values']); const d = current(change.discoveryId, change.expectedRevision), r = correlate(change.discoveryId, change.runId, change.generation);
            if (r.phase !== 'EXIT_OBSERVED' || r.outcome !== 'SUCCEEDED' || d.current_run_id !== change.runId) fail('STALE_TARGET');
            const count = Number((database.prepare('SELECT count(*) AS n FROM discovery_questions WHERE discovery_id=?').get(change.discoveryId) as Row).n);
            if (!change.values.length || count + change.values.length > 20) fail('DISCOVERY_LIMIT');
            for (const q of change.values) { requireUuid(q.questionId); if (q.discoveryId !== change.discoveryId || q.runId !== change.runId || q.revision !== '1' || q.status !== 'OPEN') fail(); validateDiscoveryText(q.text, 4096); validateDiscoveryText(q.reason, 4096);
              database.prepare('INSERT INTO discovery_questions(question_id,discovery_id,originating_run_id,question_revision,text,reason,section,status) VALUES(?,?,?,?,?,?,?,?)').run(q.questionId, q.discoveryId, q.runId, q.revision, q.text, q.reason, q.section, q.status); }
            database.prepare("UPDATE discovery_runs SET phase='FINALIZED' WHERE run_id=?").run(change.runId); changeState(d, 'WAITING_USER', true);
          } else if (change.kind === 'answer') {
            exact(change, ['kind', 'value', 'admission']); const a = change.value; requireUuid(a.answerId); validateDiscoveryText(a.text, 4096); utc(a.confirmedAt);
            if (a.requestId !== change.admission.requestId || change.admission.action !== 'answer') fail();
            const payload = (JSON.parse(change.admission.canonicalIntent) as { payload: Record<string, unknown> }).payload;
            if (payload.answerId !== a.answerId || payload.questionId !== a.questionId || payload.questionRevision !== a.questionRevision || payload.answerRevision !== a.revision || payload.kind !== a.kind || payload.text !== a.text) fail('ANSWER_CONFLICT');
            const admitted = createDiscoveryLedger(database, { mutate: body => body(), ...(options.nowMs ? { nowMs: options.nowMs } : {}) }).admit(change.admission);
            if (!admitted.ok) fail(admitted.code); if (!admitted.value.inserted) return;
            database.prepare('INSERT INTO discovery_answers(answer_id,question_id,question_revision,request_id,answer_revision,value,kind,user_confirmed_at) VALUES(?,?,?,?,?,?,?,?)').run(a.answerId, a.questionId, a.questionRevision, a.requestId, a.revision, a.text, a.kind, a.confirmedAt);
            const update = database.prepare("UPDATE discovery_questions SET status=? WHERE question_id=? AND question_revision=? AND status='OPEN'").run(a.kind === 'UNKNOWN' ? 'UNKNOWN_ACCEPTED' : 'ANSWERED', a.questionId, a.questionRevision); if (Number(update.changes) !== 1) fail('ANSWER_CONFLICT');
          } else if (change.kind === 'revision') {
            exact(change, ['kind', 'value', 'runId', 'generation', 'expectedRevision']); const v = change.value, d = current(v.discoveryId, change.expectedRevision), r = correlate(v.discoveryId, change.runId, change.generation);
            requireUuid(v.revisionId); digest(v.bundleDigest); if (r.phase !== 'EXIT_OBSERVED' || r.outcome !== 'SUCCEEDED' || d.current_run_id !== change.runId || d.snapshot_id !== v.snapshotId || r.context_digest !== v.contextDigest || !v.provenanceValidated || v.status !== 'READY_FOR_REVIEW') fail('APPROVAL_STALE');
            const previous = database.prepare('SELECT revision_id,revision_number FROM discovery_revisions WHERE discovery_id=? ORDER BY revision_number DESC LIMIT 1').get(v.discoveryId) as Row | undefined;
            if (BigInt(v.revisionNumber) !== BigInt(previous?.revision_number ?? 0) + 1n || (previous?.revision_id ?? null) !== v.parentRevisionId) fail('APPROVAL_STALE');
            const artifact = reference(v.artifactId, 'DOCUMENT', v.bundleDigest); if (Number(artifact.allocated_bytes) < v.bytes) fail('ARTIFACT_CORRUPT');
            database.prepare('INSERT INTO discovery_revisions(revision_id,discovery_id,revision_number,parent_revision_id,snapshot_id,context_digest,bundle_artifact_id,bundle_digest,bytes,provenance_validated,status) VALUES(?,?,?,?,?,?,?,?,?,1,?)').run(v.revisionId, v.discoveryId, v.revisionNumber, v.parentRevisionId, v.snapshotId, v.contextDigest, v.artifactId, v.bundleDigest, v.bytes, v.status);
            database.prepare('UPDATE discoveries SET latest_document_revision_id=? WHERE discovery_id=?').run(v.revisionId, v.discoveryId);
            database.prepare("UPDATE discovery_runs SET phase='FINALIZED' WHERE run_id=?").run(change.runId); changeState(d, 'READY_FOR_REVIEW', true);
          } else if (change.kind === 'approval') {
            exact(change, ['kind', 'value', 'expectedRevision', 'requiredUnknownIds']); const a = change.value, d = current(a.discoveryId, change.expectedRevision); const op = one('discovery_operations', 'request_id', a.requestId);
            if (a.storeId !== identity().store_id || a.ownerUid !== Number(identity().owner_uid) || !op || op.action !== 'approve' || op.phase === 'FINALIZED' || op.outcome !== 'IN_PROGRESS') fail('APPROVAL_REQUIRED');
            const intent = JSON.parse(String(op.canonical_intent)) as { targetId: string; stateRevision: string; payload: { revisionId?: string; bundleDigest?: string; acceptedUnknownIds?: string[] } };
            if (intent.targetId !== a.discoveryId || intent.stateRevision !== change.expectedRevision || intent.payload.revisionId !== a.revisionId || intent.payload.bundleDigest !== a.bundleDigest || json(intent.payload.acceptedUnknownIds ?? []) !== json(a.acceptedUnknownIds)) fail('APPROVAL_REQUIRED');
            for (const id of change.requiredUnknownIds) if (!a.acceptedUnknownIds.includes(id)) fail('APPROVAL_REQUIRED');
            const open = database.prepare("SELECT question_id FROM discovery_questions WHERE discovery_id=? AND status='OPEN'").all(a.discoveryId) as Row[];
            if (open.some(q => !a.acceptedUnknownIds.includes(String(q.question_id)))) fail('APPROVAL_REQUIRED');
            utc(a.approvedAt); utc(a.checkedAt);
            const project = one('projects', 'project_id', a.projectId); if (!project || project.removed_at !== null || String(project.config_revision) !== a.configRevision) fail('APPROVAL_STALE');
            database.prepare('INSERT INTO discovery_approvals(approval_id,request_id,revision_id,discovery_id,project_id,config_revision,bundle_digest,context_digest,accepted_unknown_ids,owner_uid,approved_at,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(a.approvalId, a.requestId, a.revisionId, a.discoveryId, a.projectId, a.configRevision, a.bundleDigest, a.contextDigest, json(a.acceptedUnknownIds), a.ownerUid, a.approvedAt, a.checkedAt);
            for (const q of open) database.prepare("UPDATE discovery_questions SET status='UNKNOWN_ACCEPTED' WHERE question_id=?").run(q.question_id);
            changeState(d, 'APPROVED', true, true);
          } else if (change.kind === 'output') {
            exact(change, ['kind', 'value', 'generation', 'expectedWatermark']); const o = change.value, r = one('discovery_runs', 'run_id', o.runId);
            if (!r || r.generation !== change.generation || r.outcome !== 'RUNNING' || r.phase !== 'PROVIDER_RUNNING' || String(r.output_watermark) !== change.expectedWatermark || BigInt(o.seq) !== BigInt(change.expectedWatermark) + 1n) fail('STALE_TARGET');
            const d = one('discoveries', 'discovery_id', String(r.discovery_id)); if (!d || d.current_run_id !== o.runId) fail('STALE_TARGET');
            const bytes = Number((database.prepare('SELECT coalesce(sum(bytes),0) AS n FROM discovery_output WHERE run_id=?').get(o.runId) as Row).n);
            if (bytes + o.bytes > 4 * 1024 * 1024) fail('PROVIDER_OUTPUT_LIMIT'); reference(o.artifactId, 'OUTPUT', o.sha256);
            database.prepare('INSERT INTO discovery_output(run_id,seq,artifact_id,sha256,bytes,kind,created_at,truncated) VALUES(?,?,?,?,?,?,?,?)').run(o.runId, o.seq, o.artifactId, o.sha256, o.bytes, o.kind, o.createdAt, o.truncated ? 1 : 0);
            database.prepare('UPDATE discovery_runs SET output_watermark=? WHERE run_id=?').run(o.seq, o.runId);
          } else if (change.kind === 'operation') {
            exact(change, ['kind', 'requestId', 'outcome', 'completedAt', 'result', 'error']); utc(change.completedAt); if (change.error !== null && !isDiscoveryFailure(change.error)) fail();
            const old = one('discovery_operations', 'request_id', change.requestId); if (!old) fail('OPERATION_NOT_FOUND');
            if (change.result) for (const [key, value] of Object.entries(change.result)) { if (!['snapshotId', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'approvalId', 'providerRevision', 'stateRevision'].includes(key)) fail(); if (key.endsWith('Revision')) positive(value); else requireUuid(value); }
            const result = change.result === null ? null : json(change.result, 8192);
            if (old.phase === 'FINALIZED') { if (old.outcome !== change.outcome || old.result !== result || old.error !== change.error) fail('IDEMPOTENCY_CONFLICT'); return; }
            database.prepare("UPDATE discovery_operations SET phase='FINALIZED',outcome=?,completed_at=?,result=?,error=? WHERE request_id=?").run(change.outcome, change.completedAt, result, change.error, change.requestId);
          } else fail();
        }, change);
        return { ok: true, value: undefined };
      } catch (error) { return errorResult(error); }
    },
  };
}
