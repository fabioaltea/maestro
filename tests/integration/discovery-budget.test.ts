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
