import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { publicDiscoveryOperation } from '../../src/protocol/discovery.js';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import { foundationError } from '../../src/domain/errors.js';
import { DISCOVERY_LIMITS } from '../../src/domain/discovery/model.js';
import { agentFixture, waitFor } from '../fixtures/discovery-agent-runtime.js';
test('private correction canary never enters public operation, event outbox or static errors', async t => {
  const f = await reviewFixture(t); await f.service.publishDocument(await f.exit(), reviewDraft());
  const canary = 'SYNTHETIC_PRIVATE_CORRECTION_7c1277', command = await f.command('correct', { revisionId: f.discovery().latestDocumentRevisionId, correctionId: randomUUID(), correction: canary });
  value(await f.service.correct(f.peer, command)); await f.service.idle();
  const operation = f.store.getDiscoveryOperation(command.requestId)!;
  assert.equal(JSON.stringify(publicDiscoveryOperation(operation)).includes(canary), false);
  assert.equal(JSON.stringify(f.database.prepare('SELECT * FROM event_outbox').all()).includes(canary), false);
  assert.equal(JSON.stringify(foundationError('PROVIDER_PROTOCOL_ERROR')).includes(canary), false);
});
test('the ten-minute production run cap can be shortened for fault qualification; timeout proves owned exit', async t => {
  assert.equal(DISCOVERY_LIMITS.runMs, 600000); assert.equal(DISCOVERY_LIMITS.contextMs, 30000); assert.equal(DISCOVERY_LIMITS.readMs, 2000); assert.equal(DISCOVERY_LIMITS.cancelMs, 4000);
  const f = await agentFixture(t, { runTimeoutMs: 50, lifetime: 5000 }), ready = value(await f.launch()); await f.authorize(ready);
  let proof: Awaited<ReturnType<typeof f.runtime.reconcile>> | undefined;
  await waitFor(async () => { proof = await f.runtime.reconcile(ready); return proof.ok && proof.value !== null; }, 4000);
  assert.equal(proof?.ok && proof.value?.outcome, 'TIMED_OUT'); assert.equal(proof?.ok && proof.value?.providerExited, true); assert.equal(proof?.ok && proof.value?.hostExited, true);
});

test('approval intent accommodates all200 UNKNOWN claims plus20 open questions within the frame cap', async t => {
  const f = await reviewFixture(t); const ids = Array.from({ length: 220 }, (_, i) => `unknown-${i}`); const canonical = canonicalDiscoveryIntent(f.intent('approve', { revisionId: randomUUID(), bundleDigest: 'a'.repeat(64), acceptedUnknownIds: ids })); assert.ok(Buffer.byteLength(canonical) < 32768);
});
