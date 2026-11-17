import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { lstat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DISCOVERY_LIMITS as limits } from '../../src/domain/discovery/model.js';
import { DISCOVERY_TABLES } from '../../src/storage/discovery-schema.js';
import { artifactFixture, value } from '../fixtures/discovery-artifacts.js';

test('budget charges physical allocation and Discovery table/index pages and reserves before any file creation', async t => {
  const f = await artifactFixture(t), db = new Database(f.path); t.after(() => db.close());
  const a = value(f.artifacts.reserveDiscoveryArtifact('CORPUS', 1024));
  const reserved = value(f.artifacts.getDiscoveryBudget()); assert.ok(reserved.reservedBytes >= 1024); assert.ok(reserved.reservedFiles >= 1);
  value(f.artifacts.publishDiscoveryArtifact(a.artifactId, Buffer.from('x')));
  const budget = value(f.artifacts.getDiscoveryBudget()); const stat = await lstat(join(f.directory, 'discovery', 'objects', a.artifactId));
  assert.ok(budget.allocatedBytes >= stat.blocks * 512); assert.equal(budget.reservedBytes, 0); assert.equal(budget.reservedFiles, 0);
  const names = db.prepare("SELECT name FROM sqlite_schema WHERE type IN ('table','index') AND tbl_name IN (" + DISCOVERY_TABLES.map(() => '?').join(',') + ')').all(...DISCOVERY_TABLES) as { name: string }[];
  const pages = names.reduce((sum, { name }) => sum + Number((db.prepare('SELECT coalesce(sum(pgsize),0) AS bytes FROM dbstat WHERE name=?').get(name) as { bytes: number }).bytes), 0);
  assert.ok(budget.metadataBytes >= pages); assert.ok(pages > 0);
});
test('ordinary writes cannot consume the terminal reserve; exit proof, query and reconcile still work with no eviction', async t => {
  const f = await artifactFixture(t), db = new Database(f.path); t.after(() => db.close());
  // A private orphan is real allocated storage, rather than fabricated budget counters.
  const orphan = join(f.directory, 'discovery', 'objects', randomUUID());
  await writeFile(orphan, Buffer.alloc(limits.artifactBytes - limits.terminalReserveBytes - 128 * 1024), { mode: 0o600 });
  value(f.artifacts.reconcileDiscoveryArtifacts());
  assert.deepEqual(f.artifacts.reserveDiscoveryArtifact('CORPUS', limits.corpusBytes), { ok: false, code: 'DISCOVERY_LIMIT' });
  const proof = value(f.artifacts.reserveDiscoveryArtifact('EXIT_PROOF', 4096)); value(f.artifacts.publishDiscoveryArtifact(proof.artifactId, Buffer.from('proof')));
  assert.ok(f.store.readSnapshot()); value(f.artifacts.reconcileDiscoveryArtifacts());
  assert.equal((await lstat(orphan)).size, limits.artifactBytes - limits.terminalReserveBytes - 128 * 1024);
  assert.equal(Number((db.prepare('SELECT count(*) AS n FROM discovery_approvals').get() as { n: number }).n), 0);
});
test('bounded kind limits reject allocations and overrun before writing user bytes', async t => {
  const f = await artifactFixture(t);
  assert.equal(f.artifacts.reserveDiscoveryArtifact('OUTPUT', 8193).ok, false);
  assert.equal(f.artifacts.reserveDiscoveryArtifact('DOCUMENT', 262145).ok, false);
  assert.equal(f.artifacts.reserveDiscoveryArtifact('CORPUS', -1).ok, false);
  const a = value(f.artifacts.reserveDiscoveryArtifact('OUTPUT', 2));
  assert.equal(f.artifacts.publishDiscoveryArtifact(a.artifactId, Buffer.from('too long')).ok, false);
  assert.equal(value(f.artifacts.getDiscoveryBudget()).allocatedFiles, 0);
});
test('explicit discard frees only unreferenced previews; pinned snapshots and history survive', async t => {
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js');
  const f = await createDiscoveryMetadataFixture(t), artifacts = f.store as unknown as import('../fixtures/discovery-artifacts.js').ArtifactStorage;
  assert.equal(typeof artifacts.discardDiscoveryPreview, 'function');
  const preview = () => ({ ...f.snapshot, snapshotId: randomUUID(), state: 'PREPARING' as const, contextDigest: null, manifestArtifactId: null, corpusArtifactId: null, pinned: false, expiresAtMs: Date.now() + limits.previewMs });
  const first = preview(); f.commit({ kind: 'snapshot', value: first });
  for (let i = 0; i < 3; i++) f.commit({ kind: 'snapshot', value: preview() });
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'snapshot', value: preview() }).ok, false);
  assert.equal(f.store.commitDiscoveryMetadata({ kind: 'snapshot', value: { ...preview(), expiresAtMs: Date.now() - 1 } }).ok, false);
  assert.equal(artifacts.discardDiscoveryPreview(f.snapshot.snapshotId).ok, false);
  value(artifacts.discardDiscoveryPreview(first.snapshotId));
  assert.equal(f.store.readDiscoveryMetadata({ kind: 'snapshot', id: first.snapshotId }).ok, true);
  f.commit({ kind: 'snapshot', value: preview() });
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discoveries').get() as { n: number }).n), 1);
  assert.equal(Number((f.database.prepare('SELECT pinned FROM discovery_snapshots WHERE snapshot_id=?').get(f.snapshot.snapshotId) as { pinned: number }).pinned), 1);
});
test('object count reserves capacity for exit proof without removing existing objects', async t => {
  const { writeFileSync } = await import('node:fs'); const f = await artifactFixture(t);
  for (let i = 0; i < limits.artifactFiles - 3; i++) writeFileSync(join(f.directory, 'discovery', 'objects', randomUUID()), '', { mode: 0o600 });
  value(f.artifacts.reconcileDiscoveryArtifacts());
  assert.equal(f.artifacts.reserveDiscoveryArtifact('OUTPUT', 1).ok, false);
  const proof = value(f.artifacts.reserveDiscoveryArtifact('EXIT_PROOF', 32)); value(f.artifacts.publishDiscoveryArtifact(proof.artifactId, Buffer.from('exit')));
  assert.equal(value(f.artifacts.getDiscoveryBudget()).allocatedFiles, limits.artifactFiles - 2);
});
test('at the ordinary quota, cancellation metadata and approved history remain durable', async t => {
  const { createHash } = await import('node:crypto');
  const { mkdir } = await import('node:fs/promises');
  const { createDiscoveryMetadataFixture } = await import('../fixtures/discovery-metadata.js');
  const f = await createDiscoveryMetadataFixture(t), artifacts = f.store as unknown as import('../fixtures/discovery-artifacts.js').ArtifactStorage;
  // Turn metadata-only fixture objects into actual owned files for this storage test.
  const root = join(f.directory, 'discovery'); await mkdir(root, { mode: 0o700 }); await mkdir(join(root, 'objects'), { mode: 0o700 }); await mkdir(join(root, 'staging'), { mode: 0o700 });
  const hash = createHash('sha256').update('fixture').digest('hex');
  for (const id of [f.snapshot.manifestArtifactId!, f.snapshot.corpusArtifactId!]) {
    await writeFile(join(root, 'objects', id), 'fixture', { mode: 0o600 }); f.database.prepare('UPDATE discovery_artifacts SET sha256=? WHERE artifact_id=?').run(hash, id);
  }
  value(artifacts.reconcileDiscoveryArtifacts()); f.exit(f.run);
  const bundle = value(artifacts.reserveDiscoveryArtifact('DOCUMENT', 32)); value(artifacts.publishDiscoveryArtifact(bundle.artifactId, Buffer.from('fixture')));
  const revisionId = randomUUID();
  f.commit({ kind: 'revision', runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', value: { revisionId, discoveryId: f.discovery.discoveryId, revisionNumber: '1', parentRevisionId: null, snapshotId: f.snapshot.snapshotId, contextDigest: f.run.contextDigest, artifactId: bundle.artifactId, bundleDigest: hash, bytes: 7, provenanceValidated: true, status: 'READY_FOR_REVIEW' } });
  const requestId = randomUUID(), grantId = randomUUID();
  value(f.store.admitDiscoveryOperation({ ...f.prepare('approve', f.discovery.discoveryId, '2', { revisionId, bundleDigest: hash, acceptedUnknownIds: [] }, requestId, grantId), discovery: { ...f.discovery, state: 'READY_FOR_REVIEW', stateRevision: '2', latestDocumentRevisionId: revisionId }, run: null, expectedStateRevision: '2', acquireSlot: false }));
  const approval = { approvalId: randomUUID(), requestId, storeId: f.storeId, projectId: f.projectId, discoveryId: f.discovery.discoveryId, revisionId, bundleDigest: hash, configRevision: '1', contextDigest: f.run.contextDigest, acceptedUnknownIds: [], ownerUid: process.getuid!(), approvedAt: f.at, checkedAt: f.at };
  f.commit({ kind: 'approval', value: approval, expectedRevision: '2', requiredUnknownIds: [] });
  const nextRequest = randomUUID(), nextGrant = randomUUID(), nextRunId = randomUUID();
  const nextDiscovery = { ...f.discovery, discoveryId: randomUUID(), sessionId: randomUUID(), currentRunId: nextRunId };
  const nextRun = { ...f.run, runId: nextRunId, discoveryId: nextDiscovery.discoveryId, generation: randomUUID(), requestId: nextRequest, grantId: nextGrant };
  value(f.store.admitDiscoveryOperation({ ...f.prepare('start', f.projectId, '1', { snapshotId: f.snapshot.snapshotId }, nextRequest, nextGrant), discovery: nextDiscovery, run: nextRun, expectedStateRevision: null, acquireSlot: true }));
  f.exit(nextRun);
  f.commit({ kind: 'questions', discoveryId: nextDiscovery.discoveryId, runId: nextRunId, generation: nextRun.generation, expectedRevision: '1', values: [{ questionId: randomUUID(), discoveryId: nextDiscovery.discoveryId, runId: nextRunId, revision: '1', text: 'Purpose?', reason: '', section: 'purpose-and-features', status: 'OPEN' }] });
  await writeFile(join(root, 'objects', randomUUID()), Buffer.alloc(limits.artifactBytes - limits.terminalReserveBytes - 64 * 1024), { mode: 0o600 }); value(artifacts.reconcileDiscoveryArtifacts());
  assert.equal(artifacts.reserveDiscoveryArtifact('CORPUS', limits.corpusBytes).ok, false);
  // Cancel uses terminal metadata capacity; this proves storage admission, not native process termination.
  const { canonicalDiscoveryIntent } = await import('../../src/domain/discovery/intent.js');
  const cancelRequest = randomUUID(), cancelGrant = randomUUID();
  const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId: f.storeId, targetId: nextDiscovery.discoveryId, action: 'cancel', configRevision: '1', stateRevision: '2', snapshotId: f.snapshot.snapshotId, contextDigest: f.run.contextDigest, providerRevision: '1', providerProfileDigest: f.run.profileDigest, modelId: f.run.modelId, payload: {} });
  value(f.store.saveDiscoveryGrant({ grantId: cancelGrant, canonicalIntent, expiresAtMs: Date.now() + limits.grantMs, consumedByRequestId: null }));
  value(f.store.admitDiscoveryOperation({ requestId: cancelRequest, action: 'cancel', canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), grantId: cancelGrant, ownerUid: process.getuid!(), instanceId: f.instanceId, nowMs: Date.now(), acceptedAt: new Date().toISOString(), discovery: { ...nextDiscovery, state: 'WAITING_USER', stateRevision: '2' }, run: null, expectedStateRevision: '2', acquireSlot: false }));
  assert.equal(f.store.getDiscoveryOperation(cancelRequest)?.requestId, cancelRequest);
  assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_approvals WHERE approval_id=?').get(approval.approvalId) as { n: number }).n), 1);
  assert.equal(value(artifacts.readDiscoveryArtifact(bundle.artifactId, 0, 8192)).sha256, hash);
});
