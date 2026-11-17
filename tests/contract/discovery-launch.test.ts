import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';

test('missing provider, authentication and unsafe capability block start authority before a launch', async t => {
  const missing = await launchFixture(t, { configured: false }); assert.deepEqual(await missing.service.prepare(missing.peer, missing.intent()), { ok: false, code: 'PROVIDER_NOT_CONFIGURED' });
  const f = await launchFixture(t);
  f.availability.value = { ...f.availability.value, state: 'AUTH_REQUIRED', code: 'PROVIDER_AUTH_REQUIRED' };
  assert.deepEqual(await f.service.prepare(f.peer, f.intent()), { ok: false, code: 'PROVIDER_AUTH_REQUIRED' });
  f.availability.value = { ...f.availability.value, state: 'AVAILABLE', code: null, capabilities: { ...f.availability.value.capabilities, readOnlyAnalysis: false } };
  assert.deepEqual(await f.service.prepare(f.peer, f.intent()), { ok: false, code: 'PROVIDER_UNSAFE' });
  assert.equal(f.launches.length, 0); assert.equal(f.counts().runs, 0);
});
test('prepare binds exact owner/store/provider/model/revisions and creates no run', async t => {
  const f = await launchFixture(t), grant = await f.prepare();
  assert.equal(grant.canonicalIntent, canonicalDiscoveryIntent(f.intent())); assert.ok(grant.expiresAtMs > Date.now()); assert.ok(grant.expiresAtMs <= Date.now() + 300000);
  assert.ok(grant.summary); assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
  for (const override of [{ ownerUid: process.getuid!() + 1 }, { storeId: randomUUID() }, { modelId: 'other-model' }, { providerRevision: '2' }, { providerProfileDigest: 'd'.repeat(64) }]) assert.equal((await f.service.prepare(f.peer, f.intent(override))).ok, false);
  assert.equal((await f.service.prepare({ ...f.peer, role: 'controller' }, f.intent())).ok, false);
});
test('missing/expired grant and a forged approval flag cannot authorize a run', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), request = f.startInput(grant);
  assert.deepEqual(await f.service.start(f.peer, { ...request, grantId: null }), { ok: false, code: 'APPROVAL_REQUIRED' });
  assert.equal((await f.service.start(f.peer, { ...request, grantId: null, approved: true } as typeof request)).ok, false);
  const expired = randomUUID(); f.database.prepare('INSERT INTO discovery_grants(grant_id,canonical_intent,expires_at_ms) VALUES(?,?,?)').run(expired, grant.canonicalIntent, Date.now() - 1);
  assert.deepEqual(await f.service.start(f.peer, { ...request, grantId: expired }), { ok: false, code: 'APPROVAL_REQUIRED' });
  assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
});
test('preview, provider check and prepare have no run or model side effects', async t => {
  const f = await launchFixture(t);
  value(await f.service.preview(f.peer, { requestId: randomUUID(), projectId: f.projectId, expectedConfigRevision: '1', selectors: ['tracked.txt'] }));
  value(await f.service.check(f.peer, { requestId: randomUUID(), expectedProviderRevision: '1' }));
  await f.service.idle(); await f.prepare(); assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
});
