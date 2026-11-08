import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { openStorage } from '../../src/storage/worker.js';

async function until(predicate: () => Promise<boolean>, timeout = 5_000) {
  const deadline = performance.now() + timeout;
  while (!await predicate()) { assert.ok(performance.now() < deadline, 'condition exceeded deadline'); await new Promise(resolve => setTimeout(resolve, 20)); }
}

test('E2: a stalled observer is evicted while the healthy observer and concurrent status clients progress', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const producer = await openStorage({path: paths.stateFile});
  await producer.drainEvents();
  const transport = createLocalTransport(), latencies: number[] = [], anomalies: string[] = [];
  let fastDelivered = 0, lastReceived = '0', expected = 0n, ordered = true;
  const fast = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {}}, async frame => {
    if (BigInt(frame.event.seq) !== expected) ordered = false;
    expected = BigInt(frame.event.seq) + 1n; lastReceived = frame.event.seq; fastDelivered++;
  });
  expected = BigInt(fast.highWater) + 1n;
  const slow = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {}}, () => new Promise(() => {}));
  let diagnostics: Record<string, any> | null = null, finalHighWater = '0';
  try {
    const before = JSON.parse((await h.call('status')).stdout);
    const writing = (async () => {
      for (let batch = 0; batch < 64; batch++) await producer.recordEvents(Array.from({length: 128}, () => ({type: 'diagnostics.degraded' as const, payload: {code: 'BUSY'}})));
      finalHighWater = (await producer.getEventState()).highWater;
    })();
    const reading = (async () => {
      for (let request = 0; request < 30; request++) {
        const start = performance.now(), response = await h.call('status');
        const elapsed = performance.now() - start; latencies.push(Math.round(elapsed * 100) / 100);
        assert.equal(response.code, 0, response.stdout);
        assert.equal(JSON.parse(response.stdout).data.ready, true, response.stdout);
        assert.ok(elapsed <= 2_000, `status took ${elapsed}ms`);
      }
    })();
    await Promise.all([writing, reading]);
    await until(async () => BigInt(lastReceived) >= BigInt(finalHighWater));
    await until(async () => {
      const response = await h.call('diagnostics'); assert.equal(response.code, 0, response.stdout);
      diagnostics = JSON.parse(response.stdout).data;
      return diagnostics!.subscriptions.slowConsumers >= 1;
    });
    const metrics = diagnostics!.subscriptions as {active: {subscriptionId: string; peakBufferedBytes: number}[]; recent: {subscriptionId: string; reason: string | null; peakBufferedBytes: number}[]; slowConsumers: number};
    assert.ok(metrics.recent.some(s => s.subscriptionId === slow.subscriptionId && s.reason === 'SLOW_CONSUMER'));
    assert.ok(metrics.active.some(s => s.subscriptionId === fast.subscriptionId));
    for (const s of [...metrics.active, ...metrics.recent]) assert.ok(s.peakBufferedBytes <= 1024 * 1024);
    assert.equal(ordered, true); assert.ok(fastDelivered >= 8192);
    const after = JSON.parse((await h.call('status')).stdout);
    assert.equal(after.instanceId, before.instanceId); assert.equal(after.data.ready, true);
    const sorted = [...latencies].sort((a, b) => a - b), p95 = sorted[Math.ceil(sorted.length * .95) - 1]!;
    assert.ok(p95 <= 500, `status p95 ${p95}ms`);
    await writeFile(resolve('specs/001-core-background-daemon/reports/e2-stream-samples.json'), JSON.stringify({
      measuredAt: new Date().toISOString(), platform: {macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(), arch: process.arch, node: process.versions.node},
      observers: 2, generatedEvents: 8192, fastDelivered, ordered, finalHighWater, lastReceived, byteLimitPerObserver: 1024 * 1024,
      subscriptions: metrics, status: {count: latencies.length, p95Ms: p95, maxMs: sorted.at(-1), samplesMs: latencies}, anomalies,
    }, null, 2) + '\n');
  } catch (error) { anomalies.push(error instanceof Error ? error.message : 'unknown'); throw error; }
  finally { await slow.close(); await fast.close(); await producer.close(); }
});
