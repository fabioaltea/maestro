import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { createTestContext } from '../fixtures/test-context.js';
import { createRegistryV3 } from '../fixtures/discovery-schema-v3.js';
import { loadContract } from '../fixtures/load-contract.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { RegistryUpgradeOptions } from '../../src/storage/registry-upgrade.js';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import type { DiscoveryAdmission } from '../../src/ports/discovery.js';
import type { DiscoveryGrant, DiscoveryOperation, DiscoveryResult } from '../../src/domain/discovery/model.js';

interface Ledger {
  admit(input: DiscoveryAdmission): Promise<DiscoveryResult<DiscoveryOperation>>;
  saveGrant(grant: DiscoveryGrant): Promise<DiscoveryResult<void>>;
  operation(requestId: string): Promise<DiscoveryOperation | null>;
}
async function fixture(t: Parameters<typeof createTestContext>[0]) {
  const { upgradeDiscovery } = await loadContract<{ upgradeDiscovery(input: RegistryUpgradeOptions): void }>('storage/discovery-upgrade.js', ['upgradeDiscovery']);
  const { createDiscoveryLedger } = await loadContract<{ createDiscoveryLedger(database: Database.Database): Ledger }>('storage/discovery-store.js', ['createDiscoveryLedger']);
  const context = await createTestContext(t); const directory = await realpath(context.directory);
  const archive = createRegistryV3(directory); const paths = (await createPlatformPaths().resolveArchive(directory, 'write'))!;
  const control = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
  const daemon = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
  if (control.status !== 'HELD' || daemon.status !== 'HELD') throw new Error('OWNED_LEASE_UNAVAILABLE');
  try { upgradeDiscovery({ paths, controlLease: control.handle, daemonLease: daemon.handle, deadline: makeDeadline(systemClock, 3000) }); }
  finally { daemon.handle.release(); control.handle.release(); }
  const database = new Database(archive.path); database.pragma('foreign_keys=ON');
  database.prepare("UPDATE instances SET lifecycle='RUNNING' WHERE instance_id=?").run(archive.instanceId);
  t.after(() => database.close());
  return { ...archive, database, ledger: createDiscoveryLedger(database) };
}
function localIntent(storeId: string, instanceId: string, requestId = randomUUID()): DiscoveryAdmission {
  const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId, targetId: 'provider', action: 'check', configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: null, providerProfileDigest: null, modelId: null, payload: {} });
  return { requestId, action: 'check', payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), canonicalIntent, grantId: null,
    ownerUid: process.getuid!(), instanceId, acceptedAt: '2026-11-16T10:00:00.000Z', nowMs: 1000,
    discovery: null, run: null, expectedStateRevision: null, acquireSlot: false };
}
test('Discovery UUID ledger replays an identical intent, rejects a different payload and cross-namespace collision', async t => {
  const f = await fixture(t); const input = localIntent(f.storeId, f.instanceId);
  const first = await f.ledger.admit(input); assert.equal(first.ok, true);
  assert.deepEqual(await f.ledger.admit(input), first);
  assert.deepEqual(await f.ledger.admit({ ...input, payloadHash: 'd'.repeat(64) }), { ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(await f.ledger.admit(localIntent(f.storeId, f.instanceId, f.requestId)), { ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  assert.throws(() => f.database.prepare("INSERT INTO request_catalog VALUES(?,'LIFECYCLE','stop',?)").run(input.requestId, 'e'.repeat(64)), /IDEMPOTENCY_CONFLICT/);
  assert.equal((f.database.prepare('SELECT count(*) AS n FROM discovery_operations').get() as { n: number }).n, 1);
});
test('grant, session, run and logical slot are one transaction; a second active Discovery consumes nothing', async t => {
  const f = await fixture(t); const snapshotId = randomUUID();
  const artifactIds = [randomUUID(), randomUUID()];
  for (const [index, artifactId] of artifactIds.entries()) f.database.prepare(`INSERT INTO discovery_artifacts(artifact_id,kind,relative_key,sha256,allocated_bytes,state,ref_count)
    VALUES(?,?,?,?,32,'REFERENCED',1)`).run(artifactId, index ? 'CORPUS' : 'MANIFEST', artifactId, 'a'.repeat(64));
  f.database.prepare(`INSERT INTO discovery_snapshots(snapshot_id,project_id,config_revision,state,context_digest,manifest_artifact_id,corpus_artifact_id,created_at,pinned,metadata)
    VALUES(?,?,1,'SEALED',?,?,?,'2026-11-16T10:00:00.000Z',1,'{}')`).run(snapshotId, f.projectId, 'a'.repeat(64), ...artifactIds);
  const start = async () => {
    const requestId = randomUUID(), grantId = randomUUID(), discoveryId = randomUUID(), runId = randomUUID();
    const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: process.getuid!(), storeId: f.storeId, targetId: f.projectId, action: 'start', configRevision: '1', stateRevision: '1', snapshotId, contextDigest: 'a'.repeat(64), providerRevision: '1', providerProfileDigest: 'c'.repeat(64), modelId: 'fixture', payload: { snapshotId } });
    const input: DiscoveryAdmission = { ...localIntent(f.storeId, f.instanceId, requestId), action: 'start', canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), grantId, acquireSlot: true,
      discovery: { storeId: f.storeId, projectId: f.projectId, discoveryId, sessionId: randomUUID(), state: 'RUNNING', stateRevision: '1', snapshotId, configRevision: '1', providerRevision: '1', currentRunId: runId,
        latestDocumentRevisionId: null, createdAt: '2026-11-16T10:00:00.000Z', updatedAt: '2026-11-16T10:00:00.000Z', error: null },
      run: { runId, discoveryId, generation: randomUUID(), turnIndex: 1, grantId, requestId, contextDigest: 'a'.repeat(64), inputDigest: 'b'.repeat(64), providerId: 'fixture', providerRevision: '1', profileDigest: 'c'.repeat(64), modelId: 'fixture', phase: 'SPAWN_INTENT', outcome: 'RUNNING', startedAt: null, endedAt: null, outputWatermark: '0', error: null } };
    assert.deepEqual(await f.ledger.saveGrant({ grantId, canonicalIntent: input.canonicalIntent, expiresAtMs: 10000, consumedByRequestId: null }), { ok: true, value: undefined });
    return input;
  };
  const first = await start(); assert.equal((await f.ledger.admit(first)).ok, true);
  const second = await start(); assert.deepEqual(await f.ledger.admit(second), { ok: false, code: 'DISCOVERY_BUSY' });
  assert.equal(await f.ledger.operation(second.requestId), null);
  const unused = f.database.prepare('SELECT consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(second.grantId) as { consumed_by_request_id: string | null };
  assert.equal(unused.consumed_by_request_id, null);
  assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as { discovery_id: string }).discovery_id, first.discovery!.discoveryId);
  assert.equal((f.database.prepare('SELECT count(*) AS n FROM discovery_runs').get() as { n: number }).n, 1);
  assert.deepEqual(f.database.pragma('foreign_key_check'), []);
});
