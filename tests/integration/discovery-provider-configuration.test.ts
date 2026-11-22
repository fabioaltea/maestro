import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { createDiscoveryOperations } from '../../src/core/discovery/operations.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { CODEX_DISCOVERY_PIN } from '../../src/providers/codex/argv.js';
import { CODEX_CAPABILITIES, CODEX_DISCOVERY_QUALIFICATION } from '../../src/providers/codex/capabilities.js';
import type { DiscoveryIntent } from '../../src/domain/discovery/intent.js';
import type { ProviderPort } from '../../src/ports/provider.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { AuthenticatedPeer } from '../../src/ports/platform.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { value } from '../fixtures/discovery-artifacts.js';

async function fixture(t: TestContext) {
  const f = await createRegistryStore(t), paths = (await createPlatformPaths().resolveArchive(f.directory, 'write'))!;
  t.after(() => rm(paths.runtimeDirectory, { recursive: true, force: true }));
  let provisioning = 0, checking = 0;
  let checkGate: (() => Promise<void>) | undefined;
  const provider: ProviderPort = { inspectConfiguredBinary: async () => { throw new Error('not a model operation'); }, checkAvailability: async () => {
    checking++; await checkGate?.(); return { state: 'AUTH_REQUIRED', code: 'PROVIDER_AUTH_REQUIRED', capabilities: CODEX_CAPABILITIES, checkedAt: new Date().toISOString() };
  }, buildInvocation: async () => { throw new Error('no inference'); }, serializeInput: () => { throw new Error('no inference'); }, decodeEvent: () => { throw new Error('no inference'); }, finalResult: () => { throw new Error('no inference'); } };
  const service = createDiscoveryOperations({ storage: f.store as unknown as StoragePort, paths, instanceId: f.instanceId, ownerUid: process.getuid!(), provider,
    inspection: { inspectBinary: async () => ({ ok: true, value: { version: CODEX_DISCOVERY_PIN.version, sha256: CODEX_DISCOVERY_PIN.sha256 } }),
      checkLogin: async () => { throw new Error('through provider port only'); }, prepareAuthHome: async () => { provisioning++; return { ok: true, value: '/fixture/dedicated-auth' }; } } });
  t.after(() => service.idle());
  const peer: AuthenticatedPeer = { role: 'client', identity: f.instanceId, credentialId: 'fixture' };
  const intent = (revision: string | null = null): DiscoveryIntent => ({ ownerUid: process.getuid!(), storeId: f.storeId, action: 'configure', targetId: f.storeId,
    configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: revision,
    providerProfileDigest: CODEX_DISCOVERY_QUALIFICATION.digest, modelId: 'chosen-model', payload: {
      binaryRealpath: '/fixture/native-codex', binarySha256: CODEX_DISCOVERY_PIN.sha256, binaryVersion: CODEX_DISCOVERY_PIN.version,
      modelId: 'chosen-model', expectedProviderRevision: revision, providerProfileDigest: CODEX_DISCOVERY_QUALIFICATION.digest } });
  const input = async (revision: string | null = null) => { const grant = value(await service.prepare(peer, intent(revision))); return { requestId: randomUUID(), grantId: grant.grantId, canonicalIntent: grant.canonicalIntent }; };
  return { ...f, service, peer, intent, input, counts: () => ({ provisioning, checking }), gate: (gate: () => Promise<void>) => { checkGate = gate; } };
}
test('configuration is explicitly approved, atomic with grant consumption and idempotent on the original UUID', async t => {
  const f = await fixture(t), request = await f.input();
  assert.equal((await f.service.configure(f.peer, { ...request, grantId: null })).ok, false); assert.equal(f.counts().provisioning, 0);
  value(await f.service.configure(f.peer, request)); value(await f.service.configure(f.peer, request));
  assert.equal(f.counts().provisioning, 1); assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'provider' })).data?.revision, '1');
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'grant', id: request.grantId })).data?.consumedByRequestId, request.requestId);
  assert.equal((await f.service.get(f.peer, request.requestId))?.outcome, 'SUCCEEDED'); assert.equal(await f.service.availability(f.peer), null);
  const database = new Database(f.path); t.after(() => database.close());
  assert.equal((database.prepare('SELECT count(*) AS n FROM discovery_runs').get() as { n: number }).n, 0);
});
test('a changed configuration invalidates old grants, and concurrent CAS does not consume the losing grant', async t => {
  const f = await fixture(t); value(await f.service.configure(f.peer, await f.input()));
  const left = await f.input('1'), right = await f.input('1');
  const results = await Promise.all([f.service.configure(f.peer, left), f.service.configure(f.peer, right)]);
  assert.equal(results.filter(x => x.ok).length, 1); assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'provider' })).data?.revision, '2');
  const losing = results[0]!.ok ? right : left;
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'grant', id: losing.grantId })).data?.consumedByRequestId, null);
  assert.equal((await f.service.configure(f.peer, losing)).ok, false);
});
test('expired or foreign grants do not provision auth storage or create an operation', async t => {
  const f = await fixture(t), request = await f.input(), database = new Database(f.path); t.after(() => database.close());
  const expired = randomUUID(); database.prepare('INSERT INTO discovery_grants(grant_id,canonical_intent,expires_at_ms) VALUES(?,?,?)').run(expired, request.canonicalIntent, Date.now() - 1);
  assert.deepEqual(await f.service.configure(f.peer, { ...request, grantId: expired }), { ok: false, code: 'APPROVAL_REQUIRED' });
  assert.equal((await f.service.configure({ ...f.peer, role: 'controller' }, request)).ok, false);
  assert.equal(f.counts().provisioning, 0); assert.equal(await f.service.get(f.peer, request.requestId), null);
});
test('provider check returns durable acceptance before the probe settles and never executes a model', async t => {
  const f = await fixture(t); value(await f.service.configure(f.peer, await f.input()));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); t.after(() => release()); f.gate(() => gate);
  const requestId = randomUUID(), before = performance.now();
  try {
    value(await f.service.check(f.peer, { requestId, expectedProviderRevision: '1' })); assert.ok(performance.now() - before < 2000);
    assert.equal((await f.service.get(f.peer, requestId))?.outcome, 'IN_PROGRESS');
    value(await f.service.check(f.peer, { requestId, expectedProviderRevision: '1' })); assert.equal(f.counts().checking, 1);
  } finally { release(); }
  await f.service.idle(); assert.equal((await f.service.get(f.peer, requestId))?.error, 'PROVIDER_AUTH_REQUIRED');
  assert.equal((await f.service.availability(f.peer))?.state, 'AUTH_REQUIRED');
});
