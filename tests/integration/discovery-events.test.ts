import test from 'node:test';
import assert from 'node:assert/strict';
import { outputFixture } from '../fixtures/discovery-output.js';
import { value } from '../fixtures/discovery-artifacts.js';
test('output watermark and metadata events commit together; a publication fault leaves only a bounded orphan', async t => {
  const f = await outputFixture(t), text = 'OUTPUT_SECRET_CANARY', previous = f.store.listEvents().highWater;
  const broken = f.createPublisher({ storage: { readDiscoveryMetadata: f.store.readDiscoveryMetadata.bind(f.store), commitDiscoveryMetadata: async () => ({ ok: false, code: 'PERSISTENCE_UNAVAILABLE' }) }, artifacts: f.artifacts });
  await assert.rejects(broken.publish(f.identity, { kind: 'AGENT_TEXT', text }), /PERSISTENCE_UNAVAILABLE/);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId })).data!.outputWatermark, '0');
  assert.equal(f.store.listEvents().highWater, previous);
  assert.ok(value(f.store.getDiscoveryBudget()).allocatedFiles > 2);
  await f.publisher.publish(f.identity, { kind: 'PROGRESS', text });
  const events = f.store.listEvents().records.filter(e => e.type === 'discovery.output.available');
  assert.equal(events.length, 1); assert.equal(events[0]!.payload.watermark, '1'); assert.equal(events[0]!.payload.runId, f.run.runId);
  assert.doesNotMatch(JSON.stringify(f.store.listEvents()), /OUTPUT_SECRET_CANARY|artifactId|credentialRef|canonicalIntent|corpus/);
  const first = value(f.store.readDiscoveryMetadata({ kind: 'output', id: f.run.runId })).data.items[0]!;
  assert.equal(first.seq, '1'); assert.equal(first.bytes, Buffer.byteLength(text));
});
