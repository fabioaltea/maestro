import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PublicResult } from '../../src/protocol/messages.js';
import { loadContract } from '../fixtures/load-contract.js';
import { createDiscoveryMetadataFixture } from '../fixtures/discovery-metadata.js';
import { value } from '../fixtures/discovery-artifacts.js';

interface Validation {
  validateDiscoveryParams(method: string, input: unknown): void;
  requireDiscoveryCapability(capabilities: unknown): void;
  validateDiscoveryAdmission(input: unknown): void;
  decodeDiscoveryOperationView(input: unknown): unknown;
}
const validation = () => loadContract<Validation>('protocol/validation.js', ['validateDiscoveryParams', 'requireDiscoveryCapability', 'validateDiscoveryAdmission', 'decodeDiscoveryOperationView']);
test('Discovery read DTOs are closed, target IDs strict and pages/envelopes bounded', async () => {
  const api = await validation(), id = randomUUID();
  for (const [method, params] of [['discovery.get', { discoveryId: id }], ['discovery.list', { projectId: id, limit: 20 }], ['discovery.questions.list', { discoveryId: id, limit: 20 }], ['discovery.output.list', { runId: id }], ['discovery.document.get', { revisionId: id }], ['discovery.operation.get', { requestId: id }], ['discovery.provider.get', {}], ['discovery.preview.get', { snapshotId: id }]] as const) {
    assert.doesNotThrow(() => api.validateDiscoveryParams(method, params));
    assert.throws(() => api.validateDiscoveryParams(method, { ...params, path: '/private/escape', sql: 'SELECT secret' }), /INVALID_REQUEST/);
  }
  for (const params of [{ projectId: id, limit: 21 }, { projectId: id, cursor: '' }, { projectId: '../escape' }, { projectId: id, cursor: 'x'.repeat(4097) }]) assert.throws(() => api.validateDiscoveryParams('discovery.list', params), /INVALID_REQUEST/);
  assert.throws(() => api.validateDiscoveryParams('discovery.get', { discoveryId: id, text: 'x'.repeat(32768) }), /INVALID_REQUEST|CONTEXT_LIMIT/);
  assert.throws(() => api.validateDiscoveryParams('discovery.shell', { command: 'echo unsafe' }), /UNSUPPORTED_VERSION|INVALID_REQUEST/);
});
test('capability is explicit and admission never means provider completion or document approval', async () => {
  const api = await validation();
  for (const input of [undefined, {}, { projectRegistryVersion: 1 }, { discoveryVersion: 2 }]) assert.throws(() => api.requireDiscoveryCapability(input), /UNSUPPORTED_VERSION/);
  assert.doesNotThrow(() => api.requireDiscoveryCapability({ discoveryVersion: 1 }));
  const admission = { accepted: true, requestId: randomUUID(), discoveryId: randomUUID(), sessionId: randomUUID(), runId: randomUUID(), stateRevision: '1' };
  assert.doesNotThrow(() => api.validateDiscoveryAdmission(admission));
  for (const extra of [{ approved: true }, { completed: true }, { stateRevision: '0' }, { runId: 'invalid' }]) assert.throws(() => api.validateDiscoveryAdmission({ ...admission, ...extra }), /INVALID_REQUEST/);
});
test('public operations contain only bounded safe results and omit private intents, hashes and process references', async () => {
  const api = await validation();
  const operation = { requestId: randomUUID(), action: 'start', phase: 'FINALIZED', outcome: 'SUCCEEDED', acceptedAt: '2026-11-17T10:00:00.000Z', completedAt: '2026-11-17T10:00:01.000Z', result: { discoveryId: randomUUID() }, error: null };
  assert.deepEqual(api.decodeDiscoveryOperationView(operation), operation);
  for (const extra of [{ canonicalIntent: 'SECRET' }, { payloadHash: 'a'.repeat(64) }, { credentialRef: '/private/key' }, { error: { message: 'raw stderr' } }, { result: { text: 'SECRET' } }, { completedAt: null }]) assert.throws(() => api.decodeDiscoveryOperationView({ ...operation, ...extra }), /INVALID_REQUEST/);
});
test('an alternate client cannot substitute a UI confirmation flag for the core grant', async t => {
  const f = await createDiscoveryMetadataFixture(t), requestId = randomUUID(), grantId = randomUUID(), nextRunId = randomUUID();
  const base = f.prepare('start', f.projectId, '1', { snapshotId: f.snapshot.snapshotId }, requestId, grantId);
  const candidate = { ...base, grantId: null, discovery: { ...f.discovery, discoveryId: randomUUID(), sessionId: randomUUID(), currentRunId: nextRunId }, run: null, expectedStateRevision: null, acquireSlot: true, approved: true };
  const result = f.store.admitDiscoveryOperation(candidate);
  assert.deepEqual(result, { ok: false, code: 'APPROVAL_REQUIRED' });
  assert.equal(f.store.getDiscoveryOperation(requestId), null); assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_runs').get() as { n: number }).n), 1);
});
test('question pages fit the encoded envelope and cursors bind store, target and revision', async t => {
  const f = await createDiscoveryMetadataFixture(t); f.exit(f.run);
  f.commit({ kind: 'questions', discoveryId: f.discovery.discoveryId, runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', values: Array.from({ length: 20 }, () => ({ questionId: randomUUID(), discoveryId: f.discovery.discoveryId, runId: f.run.runId, revision: '1', text: 'Q'.repeat(4096), reason: 'R'.repeat(4096), section: 'purpose-and-features', status: 'OPEN' as const })) });
  const { createDiscoveryReader } = await loadContract<{ createDiscoveryReader(options: { storage: object; storeId: string; offline: boolean }): (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }>('core/discovery/read.js', ['createDiscoveryReader']);
  const read = createDiscoveryReader({ storage: f.store, storeId: f.storeId, offline: false });
  const page = await read('discovery.questions.list', { discoveryId: f.discovery.discoveryId, limit: 20 });
  assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768); assert.ok((page.items as unknown[]).length > 0 && (page.items as unknown[]).length < 20); assert.equal(typeof page.nextCursor, 'string');
  await assert.rejects(createDiscoveryReader({ storage: f.store, storeId: randomUUID(), offline: false })('discovery.questions.list', { discoveryId: f.discovery.discoveryId, cursor: page.nextCursor }), /WRONG_STORE/);
  await assert.rejects(read('discovery.questions.list', { discoveryId: randomUUID(), cursor: page.nextCursor }), /INVALID_REQUEST/);
  const next = await read('discovery.questions.list', { discoveryId: f.discovery.discoveryId, cursor: page.nextCursor });
  assert.notDeepEqual(next.items, page.items);
  value(f.store.commitDiscoveryMetadata({ kind: 'state', discoveryId: f.discovery.discoveryId, expectedRevision: '2', next: 'CANCELLED', exitVerified: false }));
  await assert.rejects(read('discovery.questions.list', { discoveryId: f.discovery.discoveryId, cursor: page.nextCursor }), /CURSOR_EXPIRED|REVISION_CONFLICT/);
});
test('all Discovery failures have static public messages and next actions', async () => {
  const { DISCOVERY_FAILURE_CODES } = await import('../../src/domain/discovery/model.js');
  const { foundationError } = await loadContract<{ foundationError(code: string): { code: string; message: string; nextAction: string } }>('domain/errors.js', ['foundationError']);
  for (const code of DISCOVERY_FAILURE_CODES) { const error = foundationError(code); assert.equal(error.code, code); assert.ok(error.message.length > 0); assert.ok(error.nextAction.length > 0); }
});
test('document bytes use hash-validated 8KiB pages and an encoded envelope below32KiB', async t => {
  const { mkdir, writeFile } = await import('node:fs/promises'), { join } = await import('node:path'), { createHash } = await import('node:crypto');
  const f = await createDiscoveryMetadataFixture(t), root = join(f.directory, 'discovery');
  await mkdir(root, { mode: 0o700 }); await mkdir(join(root, 'objects'), { mode: 0o700 }); await mkdir(join(root, 'staging'), { mode: 0o700 });
  for (const id of [f.snapshot.manifestArtifactId!, f.snapshot.corpusArtifactId!]) { await writeFile(join(root, 'objects', id), 'fixture', { mode: 0o600 }); f.database.prepare('UPDATE discovery_artifacts SET sha256=? WHERE artifact_id=?').run(createHash('sha256').update('fixture').digest('hex'), id); }
  const body = Buffer.alloc(20000, 100), reserved = value(f.store.reserveDiscoveryArtifact('DOCUMENT', body.length)), published = value(f.store.publishDiscoveryArtifact(reserved.artifactId, body)); f.exit(f.run);
  const revisionId = randomUUID();
  f.commit({ kind: 'revision', runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', value: { revisionId, discoveryId: f.discovery.discoveryId, revisionNumber: '1', parentRevisionId: null, snapshotId: f.snapshot.snapshotId, contextDigest: f.run.contextDigest, artifactId: published.artifactId, bundleDigest: published.sha256!, bytes: body.length, provenanceValidated: true, status: 'READY_FOR_REVIEW' } });
  const { createDiscoveryReader } = await loadContract<{ createDiscoveryReader(options: { storage: object; storeId: string; offline: boolean }): (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }>('core/discovery/read.js', ['createDiscoveryReader']);
  const read = createDiscoveryReader({ storage: f.store, storeId: f.storeId, offline: false }), page = await read('discovery.document.get', { revisionId, content: true });
  const chunk = page.chunk as { data: string; byteLength: number; sha256: string };
  assert.equal(chunk.byteLength, 8192); assert.equal(chunk.sha256, published.sha256); assert.deepEqual(Buffer.from(chunk.data, 'base64'), body.subarray(0, 8192)); assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768);
  const { inspectDiscovery } = await import('../../src/core/inspect-main.js');
  const offline = await inspectDiscovery(f.directory, 'discovery.document.get', { revisionId, content: true });
  assert.equal(offline.result, 'OK'); assert.equal((offline.data.chunk as { byteLength: number }).byteLength, 8192); assert.equal(typeof offline.data.nextCursor, 'string');
  await writeFile(join(root, 'objects', published.artifactId), Buffer.alloc(body.length, 120));
  await assert.rejects(read('discovery.document.get', { revisionId, content: true, cursor: page.nextCursor }), /ARTIFACT_CORRUPT/);
});
test('Discovery dispatch rejects non-client roles and unimplemented actions before reading private metadata', async t => {
  const { createDiscoveryDispatch, DISCOVERY_METHODS } = await import('../../src/core/discovery/dispatch.js');
  const f = await createDiscoveryMetadataFixture(t), dispatch = createDiscoveryDispatch({ storage: {
    readDiscoveryMetadata: async q => f.store.readDiscoveryMetadata(q), getDiscoveryOperation: async id => f.store.getDiscoveryOperation(id),
    readDiscoveryArtifact: async (id, offset, max) => f.store.readDiscoveryArtifact(id, offset, max), readDiscoveryManifestPage: async (id, offset, limit) => f.store.readDiscoveryManifestPage(id, offset, limit), getProject: async id => f.store.getProject(id),
  } });
  const request = { protocolVersion: 1 as const, correlationId: randomUUID(), method: 'discovery.get', params: { discoveryId: f.discovery.discoveryId } }, peer = { role: 'client' as const, identity: f.instanceId, credentialId: 'owned-fixture' };
  const unauthorized = await dispatch(request, { ...peer, role: 'controller' }, f.store.readSnapshot()!); assert.equal((unauthorized.data as { code: string }).code, 'UNAUTHORIZED');
  const ok = await dispatch(request, peer, f.store.readSnapshot()!); assert.equal(ok.result, 'OK'); assert.ok(Buffer.byteLength(JSON.stringify(ok)) <= 32768);
  assert.equal(DISCOVERY_METHODS.includes('discovery.start'), false);
  const unsupported = await dispatch({ ...request, method: 'discovery.start', params: { discoveryId: f.discovery.discoveryId, approved: true } }, peer, f.store.readSnapshot()!); assert.equal((unsupported.data as { code: string }).code, 'UNSUPPORTED_VERSION');
});
test('Discovery journal increments carry only metadata accepted by the current desktop decoder', async t => {
  const f = await createDiscoveryMetadataFixture(t); let current = f.run;
  for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING'] as const) { const next = { ...current, phase }; f.commit({ kind: 'run', value: next, expectedPhase: current.phase, exitVerified: false }); current = next; }
  f.commit({ kind: 'output', generation: f.run.generation, expectedWatermark: '0', value: { runId: f.run.runId, seq: '1', artifactId: f.artifact('OUTPUT'), sha256: 'a'.repeat(64), bytes: 12, kind: 'PROGRESS', createdAt: f.at, truncated: false } });
  const module = await import(new URL('../../../apps/desktop/src/shared/activity-contract.ts', import.meta.url).href) as { decodeUiEvent(value: unknown, storeId: string): unknown };
  const event = f.store.listEvents().records.find(entry => entry.type === 'discovery.output.available'); assert.ok(event); assert.equal(event.payload.watermark, '1'); assert.equal(event.payload.runId, f.run.runId);
  assert.doesNotThrow(() => module.decodeUiEvent(event, f.storeId)); assert.doesNotMatch(JSON.stringify(event), /artifactId|credentialRef|canonicalIntent|corpus|prompt/);
});
