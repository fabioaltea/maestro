import test from 'node:test';
import assert from 'node:assert/strict';

const owner = { ownerUid: 501, storeId: 'store-a', action: 'start', targetId: 'project-a',
  configRevision: '1', stateRevision: '1', snapshotId: 'snapshot-a', contextDigest: 'a'.repeat(64),
  providerRevision: '1', providerProfileDigest: 'b'.repeat(64), modelId: 'model', payload: { snapshotId: 'snapshot-a' } };
async function intentModule() {
  return await import(new URL('../../src/domain/discovery/intent.js', import.meta.url).href) as {
    canonicalDiscoveryIntent(input: unknown): string;
    validateDiscoveryGrant(grant: { canonicalIntent: string; expiresAtMs: number; consumedByRequestId: string | null }, intent: string, requestId: string, nowMs: number): 'CONSUME' | 'REPLAY';
    validateDiscoveryText(value: string, limit: number): void;
  };
}
test('intent binds owner/store/action/context/provider/model and uses stable closed JSON', async () => {
  const domain = await intentModule();
  const canonical = domain.canonicalDiscoveryIntent(owner);
  assert.equal(domain.canonicalDiscoveryIntent({ ...owner, payload: { snapshotId: 'snapshot-a' } }), canonical);
  for (const change of [{ ownerUid: 502 }, { storeId: 'store-b' }, { modelId: 'other' }, { providerRevision: '2' }, { contextDigest: 'c'.repeat(64) }]) {
    assert.notEqual(domain.canonicalDiscoveryIntent({ ...owner, ...change }), canonical);
  }
  assert.throws(() => domain.canonicalDiscoveryIntent({ ...owner, argv: ['--search'] }));
  assert.throws(() => domain.canonicalDiscoveryIntent({ ...owner, payload: { prompt: 'arbitrary' } }));
  assert.throws(() => domain.canonicalDiscoveryIntent({ ...owner, configRevision: '01' }));
});
test('grant is single use, scoped and expires with controlled time; the original UUID can replay', async () => {
  const domain = await intentModule(); const canonical = domain.canonicalDiscoveryIntent(owner);
  const grant = { canonicalIntent: canonical, expiresAtMs: 1000, consumedByRequestId: null };
  assert.equal(domain.validateDiscoveryGrant(grant, canonical, 'request-a', 999), 'CONSUME');
  assert.throws(() => domain.validateDiscoveryGrant(grant, canonical, 'request-a', 1000));
  assert.throws(() => domain.validateDiscoveryGrant(grant, canonical + ' ', 'request-a', 999));
  assert.equal(domain.validateDiscoveryGrant({ ...grant, consumedByRequestId: 'request-a' }, canonical, 'request-a', 2000), 'REPLAY');
  assert.throws(() => domain.validateDiscoveryGrant({ ...grant, consumedByRequestId: 'request-a' }, canonical, 'request-b', 999));
});
test('text caps count serialized source bytes rather than JS characters, reject malformed Unicode', async () => {
  const domain = await intentModule();
  domain.validateDiscoveryText('x'.repeat(4096), 4096);
  assert.throws(() => domain.validateDiscoveryText('é'.repeat(2049), 4096));
  assert.throws(() => domain.validateDiscoveryText('\ud800', 4096));
  assert.throws(() => domain.validateDiscoveryText('a\0b', 4096));
});
test('numerical limits are explicit and distinguish input/output/concurrency/time', async () => {
  const { DISCOVERY_LIMITS } = await import(new URL('../../src/domain/discovery/model.js', import.meta.url).href) as { DISCOVERY_LIMITS: Record<string, number> };
  assert.equal(DISCOVERY_LIMITS.activeDiscoveries, 1);
  assert.equal(DISCOVERY_LIMITS.corpusBytes, 1024 * 1024);
  assert.equal(DISCOVERY_LIMITS.inputBytes, 2 * 1024 * 1024);
  assert.equal(DISCOVERY_LIMITS.runOutputBytes, 8 * 1024 * 1024);
  assert.equal(DISCOVERY_LIMITS.storedOutputBytes, 4 * 1024 * 1024);
  assert.equal(DISCOVERY_LIMITS.runMs, 600_000);
  assert.equal(DISCOVERY_LIMITS.cancelMs, 4000);
  assert.equal(DISCOVERY_LIMITS.questions, 20);
  assert.equal(DISCOVERY_LIMITS.activeGrants, 32);
});
