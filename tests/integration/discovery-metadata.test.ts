import type { DiscoveryMetadataReply } from '../../src/ports/discovery.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Metadata {
  commit(change: Record<string, unknown>): { ok: boolean; code?: string };
  read(query: Record<string, unknown>): { ok: boolean; value?: { data: unknown }; code?: string };
}
async function fixture(t: Parameters<typeof createRegistryStore>[0]) {
  const f = await createRegistryStore(t);
  const { createDiscoveryMetadata } = await loadContract<{ createDiscoveryMetadata(database: Database.Database): Metadata }>('storage/discovery-metadata.js', ['createDiscoveryMetadata']);
  const database = new Database(f.path); database.pragma('foreign_keys=ON'); t.after(() => database.close());
  return { ...f, database, metadata: createDiscoveryMetadata(database) };
}
test('provider configuration uses revision CAS, persists no unrecognized secret fields', async t => {
  const f = await fixture(t);
  const configuration = { providerId: 'fixture', revision: '1', binaryRealpath: '/trusted/provider', binarySha256: 'a'.repeat(64), binaryVersion: 'fixture', modelId: 'configured',
    authProfileRef: 'official-keyring', policyVersion: 'test', qualificationDigest: 'b'.repeat(64), configuredAt: '2026-11-16T10:00:00.000Z' };
  assert.equal(f.metadata.commit({ kind: 'provider', expectedRevision: null, configuration }).ok, true);
  assert.deepEqual(f.metadata.read({ kind: 'provider' }), { ok: true, value: { kind: 'provider', data: configuration } });
  assert.equal(f.metadata.commit({ kind: 'provider', expectedRevision: null, configuration: { ...configuration, revision: '2' } }).ok, false);
  assert.equal(f.metadata.commit({ kind: 'provider', expectedRevision: '1', configuration: { ...configuration, revision: '2', token: 'MUST_NOT_PERSIST' } }).ok, false);
  assert.equal(JSON.stringify(f.metadata.read({ kind: 'provider' })).includes('MUST_NOT_PERSIST'), false);
});
test('read queries and all mutation kinds are closed rather than accepting SQL or paths', async t => {
  const f = await fixture(t);
  assert.equal(f.metadata.commit({ kind: 'sql', sql: 'DELETE FROM projects' }).ok, false);
  assert.equal(f.metadata.read({ kind: 'provider', path: '/private/file' }).ok, false);
  assert.equal(f.metadata.read({ kind: 'questions', discoveryId: '../escape' }).ok, false);
  assert.equal(f.metadata.read({ kind: 'discoveries', projectId: randomUUID(), offset: -1 }).ok, false);
});

test('run generation and proven exit guard questions, persistent waiting retains its logical slot', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t);
  const question = { questionId: randomUUID(), discoveryId: f.discovery.discoveryId, runId: f.run.runId, revision: '1', text: 'Deployment?', reason: 'Not in source', section: 'conventions-and-operations', status: 'OPEN' as const };
  const mutation = { kind: 'questions' as const, discoveryId: f.discovery.discoveryId, runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', values: [question] };
  assert.equal(f.store.commitDiscoveryMetadata(mutation).ok, false);
  f.exit(f.run);
  assert.equal(f.store.commitDiscoveryMetadata({ ...mutation, generation: randomUUID() }).ok, false);
  f.commit(mutation);
  const state = f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.discovery.discoveryId }); assert.ok(state.ok && state.value.data);
  if (!state.ok || !state.value.data) return;
  assert.equal(state.value.data.state, 'WAITING_USER'); assert.equal(state.value.data.stateRevision, '2');
  assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot').get() as { discovery_id: string }).discovery_id, f.discovery.discoveryId);
  assert.equal(f.store.commitDiscoveryMetadata(mutation).ok, false);
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_questions').get() as { n: number }).n), 1);
});
test('answer and new run commit together, replay cannot append the answer twice', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t); f.exit(f.run);
  const questionId = randomUUID(); f.commit({ kind: 'questions', discoveryId: f.discovery.discoveryId, runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', values: [{ questionId, discoveryId: f.discovery.discoveryId, runId: f.run.runId, revision: '1', text: 'Deployment?', reason: 'Missing', section: 'conventions-and-operations', status: 'OPEN' }] });
  const answerId = randomUUID(), requestId = randomUUID(), grantId = randomUUID(), runId = randomUUID();
  const value = { answerId, questionId, questionRevision: '1', revision: '1', requestId, kind: 'ANSWER' as const, text: 'Local only', confirmedAt: f.at };
  const admission = { ...f.prepare('answer', questionId, '2', { questionId, questionRevision: '1', answerId, answerRevision: '1', kind: 'ANSWER', text: value.text }, requestId, grantId),
    discovery: { ...f.discovery, stateRevision: '3', currentRunId: runId }, run: { ...f.run, runId, generation: randomUUID(), requestId, grantId, turnIndex: 2 }, expectedStateRevision: '2', acquireSlot: true };
  f.commit({ kind: 'answer', value, admission }); f.commit({ kind: 'answer', value, admission });
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_answers').get() as { n: number }).n), 1);
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_runs').get() as { n: number }).n), 2);
  const answers = f.store.readDiscoveryMetadata({ kind: 'answers', id: f.discovery.discoveryId }); assert.ok(answers.ok);
  if (answers.ok) assert.equal(answers.value.data.items.length, 1);
});
test('document revisions are append-only and approval needs its own exact consumed grant', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t); f.exit(f.run);
  const revisionId = randomUUID(), artifactId = f.artifact('DOCUMENT');
  const revision = { revisionId, discoveryId: f.discovery.discoveryId, revisionNumber: '1', parentRevisionId: null, snapshotId: f.snapshot.snapshotId, contextDigest: f.run.contextDigest, artifactId, bundleDigest: 'a'.repeat(64), bytes: 128, provenanceValidated: true, status: 'READY_FOR_REVIEW' as const };
  f.commit({ kind: 'revision', value: revision, runId: f.run.runId, generation: f.run.generation, expectedRevision: '1' });
  assert.throws(() => f.database.prepare('UPDATE discovery_revisions SET bundle_digest=? WHERE revision_id=?').run('b'.repeat(64), revisionId), /INVALID_TRANSITION/);
  assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot').get() as { discovery_id: string | null }).discovery_id, null);
  const requestId = randomUUID(), grantId = randomUUID();
  const approval = { approvalId: randomUUID(), requestId, storeId: f.storeId, projectId: f.projectId, discoveryId: f.discovery.discoveryId, revisionId, bundleDigest: 'a'.repeat(64), configRevision: '1', contextDigest: f.run.contextDigest, acceptedUnknownIds: [], ownerUid: process.getuid!(), approvedAt: f.at, checkedAt: f.at };
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'approval', value: approval, expectedRevision: '2', requiredUnknownIds: [] }).ok, false);
  const admitted = f.store.admitDiscoveryOperation({ ...f.prepare('approve', f.discovery.discoveryId, '2', { revisionId, bundleDigest: approval.bundleDigest, acceptedUnknownIds: [] }, requestId, grantId), discovery: { ...f.discovery, state: 'READY_FOR_REVIEW', stateRevision: '2', latestDocumentRevisionId: revisionId }, run: null, expectedStateRevision: '2', acquireSlot: false }); assert.equal(admitted.ok, true);
  f.commit({ kind: 'approval', value: approval, expectedRevision: '2', requiredUnknownIds: [] });
  const state = f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.discovery.discoveryId }); assert.ok(state.ok && state.value.data);
  if (state.ok && state.value.data) assert.equal(state.value.data.state, 'APPROVED');
  assert.throws(() => f.database.prepare('DELETE FROM discovery_approvals WHERE approval_id=?').run(approval.approvalId), /INVALID_TRANSITION/);
});
test('output watermark and object reference commit together; stale generations cannot publish', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t);
  let running = f.run;
  for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING'] as const) { const next = { ...running, phase, startedAt: f.at }; f.commit({ kind: 'run', value: next, expectedPhase: running.phase, exitVerified: false }); running = next; }
  const artifactId = f.artifact('OUTPUT');
  const output = { runId: f.run.runId, seq: '1', artifactId, sha256: 'a'.repeat(64), bytes: 12, kind: 'AGENT_TEXT' as const, createdAt: f.at, truncated: false };
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'output', value: output, generation: randomUUID(), expectedWatermark: '0' }).ok, false);
  f.commit({ kind: 'output', value: output, generation: f.run.generation, expectedWatermark: '0' });
  assert.equal(String((f.database.prepare('SELECT output_watermark FROM discovery_runs WHERE run_id=?').get(f.run.runId) as { output_watermark: number }).output_watermark), '1');
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'output', value: output, generation: f.run.generation, expectedWatermark: '0' }).ok, false);
  const events = f.store.listEvents().records.filter(event => event.type === 'discovery.changed'); assert.ok(events.length > 0);
  assert.equal(JSON.stringify(events).includes('Local only'), false);
});
test('process metadata stays outside Foundation and cannot release unknown ownership', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t);
  const process = { runId: f.run.runId, generation: f.run.generation, owningInstanceId: f.instanceId, hostPid: 12345, providerPid: null, hostEndpoint: 'private-endpoint', credentialRef: 'private-reference', observation: 'UNKNOWN' as const, releaseState: 'RELEASED' as const, policy: 'cancel-on-owner-loss-v1' };
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'process', value: process }).ok, false);
  f.commit({ kind: 'process', value: { ...process, releaseState: 'OWNED' } });
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM managed_resources').get() as { n: number }).n), 0);
  assert.equal((f.database.prepare('SELECT policy_scope FROM discovery_processes').get() as { policy_scope: string }).policy_scope, 'agent-runtime');
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'process', value: { ...process, observation: 'ABSENT', generation: randomUUID() } }).ok, false);
});

test('large question lists page within the reader envelope without silently dropping records', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t); f.exit(f.run);
  const values = Array.from({ length: 20 }, () => ({ questionId: randomUUID(), discoveryId: f.discovery.discoveryId, runId: f.run.runId, revision: '1', text: 'x'.repeat(4096), reason: 'y'.repeat(4096), section: 'conventions-and-operations', status: 'OPEN' as const }));
  f.commit({ kind: 'questions', discoveryId: f.discovery.discoveryId, runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', values });
  const ids: string[] = []; let offset: number | null = 0;
  while (offset !== null) {
    const page: DiscoveryResult<DiscoveryMetadataReply<{ kind: 'questions'; id: string }>> = f.store.readDiscoveryMetadata({ kind: 'questions', id: f.discovery.discoveryId, offset, limit: 20 }); assert.ok(page.ok);
    if (!page.ok) return;
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 32 * 1024);
    ids.push(...page.value.data.items.map(value => value.questionId)); offset = page.value.data.nextOffset;
  }
  assert.equal(ids.length, 20); assert.equal(new Set(ids).size, 20);
});
test('metadata changes and queries work through the existing worker and readonly confinement', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const { openStorage } = await import('../../src/storage/worker.js'); const writer = await openStorage({ path: f.path });
  const configuration = { providerId: 'fixture', revision: '1', binaryRealpath: '/trusted/provider', binarySha256: 'a'.repeat(64), binaryVersion: 'fixture', modelId: 'configured', authProfileRef: 'official-keyring', policyVersion: 'test', qualificationDigest: 'b'.repeat(64), configuredAt: '2026-11-17T10:00:00.000Z' };
  try { assert.equal((await writer.commitDiscoveryMetadata!({ kind: 'provider', expectedRevision: null, configuration })).ok, true); } finally { await writer.close(); }
  const reader = await openStorage({ path: f.path, readonly: true });
  try {
    const result = await reader.readDiscoveryMetadata!({ kind: 'provider' }); assert.ok(result.ok);
    if (result.ok) assert.deepEqual(result.value.data, configuration);
    await assert.rejects(reader.commitDiscoveryMetadata!({ kind: 'provider', expectedRevision: '1', configuration: { ...configuration, revision: '2' } }), /UNAUTHORIZED/);
  } finally { await reader.close(); }
});

test('terminal operation results contain only bounded IDs and preserve replay without exposing intent text', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js'); const f = await createDiscoveryMetadataFixture(t);
  const change = { kind: 'operation' as const, requestId: f.run.requestId, outcome: 'SUCCEEDED' as const, completedAt: f.at,
    result: { discoveryId: f.discovery.discoveryId, runId: f.run.runId }, error: null };
  f.commit(change); const before = f.store.getEventState().highWater; f.commit(change);
  assert.equal(f.store.getEventState().highWater, before);
  const operation = f.store.getDiscoveryOperation(f.run.requestId); assert.deepEqual(operation?.result, change.result);
  assert.equal(Object.hasOwn(operation!, 'canonicalIntent'), false);
  assert.equal(f.store.commitDiscoveryMetadata({ ...change, result: { prompt: 'MUST_NOT_PERSIST' } }).ok, false);
  assert.equal(JSON.stringify(f.store.getDiscoveryOperation(f.run.requestId)).includes('MUST_NOT_PERSIST'), false);
});
