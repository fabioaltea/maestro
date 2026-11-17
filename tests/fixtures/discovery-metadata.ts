import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { DiscoveryAdmission, DiscoveryMetadataChange, DiscoverySnapshot } from '../../src/ports/discovery.js';
import type { DiscoveryRecord, DiscoveryRun } from '../../src/domain/discovery/model.js';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import { createRegistryStore } from './registry-store.js';

/** Metadata-only fixtures do not claim file durability, provenance or native exit proof. */
export async function createDiscoveryMetadataFixture(t: TestContext, options: { inputDigest?: string } = {}) {
  const f = await createRegistryStore(t); const database = new Database(f.path); database.pragma('foreign_keys=ON');
  t.after(() => database.close());
  const projectId = randomUUID(), at = new Date().toISOString();
  database.prepare("INSERT INTO projects(project_id,display_name,repository_key,repository_identity,reference_checkout,base_branch,config_revision,created_at,updated_at) VALUES(?,'Metadata fixture',?,'{}','{}',NULL,1,?,?)").run(projectId, 'f'.repeat(64), at, at);
  const commit = (change: DiscoveryMetadataChange) => {
    const result = f.store.commitDiscoveryMetadata(change);
    assertSuccess(result.ok, result.ok ? '' : result.code);
  };
  const artifact = (kind: 'MANIFEST' | 'CORPUS' | 'DOCUMENT' | 'OUTPUT', sha256 = 'a'.repeat(64)) => {
    const artifactId = randomUUID(); commit({ kind: 'artifact', value: { artifactId, kind, relativeKey: artifactId, sha256, allocatedBytes: 4096, state: 'PUBLISHED', referenceCount: 0 } }); return artifactId;
  };
  const snapshot: DiscoverySnapshot = { snapshotId: randomUUID(), projectId, configRevision: '1', state: 'SEALED', contextDigest: 'a'.repeat(64),
    selectors: ['README.md'], fileCount: 1, byteCount: 12, omissions: [], manifestArtifactId: artifact('MANIFEST'), corpusArtifactId: artifact('CORPUS'), createdAt: at, expiresAtMs: Date.now() + 15 * 60_000, pinned: false };
  commit({ kind: 'snapshot', value: snapshot });
  const discoveryId = randomUUID(), runId = randomUUID(), requestId = randomUUID(), grantId = randomUUID();
  const discovery: DiscoveryRecord = { storeId: f.storeId, projectId, discoveryId, sessionId: randomUUID(), state: 'RUNNING', stateRevision: '1', snapshotId: snapshot.snapshotId,
    configRevision: '1', providerRevision: '1', currentRunId: runId, latestDocumentRevisionId: null, createdAt: at, updatedAt: at, error: null };
  const run: DiscoveryRun = { runId, discoveryId, generation: randomUUID(), turnIndex: 1, grantId, requestId, contextDigest: 'a'.repeat(64), inputDigest: options.inputDigest ?? 'b'.repeat(64), providerId: 'fixture', providerRevision: '1', profileDigest: 'c'.repeat(64), modelId: 'fixture', phase: 'SPAWN_INTENT', outcome: 'RUNNING', startedAt: null, endedAt: null, outputWatermark: '0', error: null };
  const prepare = (action: 'start' | 'answer' | 'approve', targetId: string, stateRevision: string, payload: Record<string, unknown>, nextRequestId: string, nextGrantId: string) => {
    const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId: f.storeId, action, targetId, configRevision: '1', stateRevision, snapshotId: snapshot.snapshotId, contextDigest: run.contextDigest, providerRevision: '1', providerProfileDigest: run.profileDigest, modelId: run.modelId, payload });
    const saved = f.store.saveDiscoveryGrant({ grantId: nextGrantId, canonicalIntent, expiresAtMs: Date.now() + 300_000, consumedByRequestId: null }); assertSuccess(saved.ok);
    return { requestId: nextRequestId, action, canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), grantId: nextGrantId,
      ownerUid: process.getuid!(), instanceId: f.instanceId, nowMs: Date.now(), acceptedAt: new Date().toISOString() };
  };
  const admission: DiscoveryAdmission = { ...prepare('start', projectId, '1', { snapshotId: snapshot.snapshotId }, requestId, grantId), discovery, run, expectedStateRevision: null, acquireSlot: true };
  assertSuccess(f.store.admitDiscoveryOperation(admission).ok);
  const exit = (value: DiscoveryRun) => {
    let current = value;
    for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING', 'EXIT_OBSERVED'] as const) {
      const next: DiscoveryRun = { ...current, phase, outcome: phase === 'EXIT_OBSERVED' ? 'SUCCEEDED' : 'RUNNING', startedAt: at, endedAt: phase === 'EXIT_OBSERVED' ? at : null };
      commit({ kind: 'run', value: next, expectedPhase: current.phase, exitVerified: phase === 'EXIT_OBSERVED' }); current = next;
    }
    return current;
  };
  return { ...f, database, projectId, at, discovery, run, snapshot, artifact, commit, prepare, exit };
}
function assertSuccess(ok: boolean, code = '') { if (!ok) throw new Error(`METADATA_FIXTURE_FAILED:${code}`); }
