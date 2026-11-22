import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {createLocalTransport} from '../../src/platform/macos/transport.js';
import {openStorage} from '../../src/storage/worker.js';
import type {EventSubscription} from '../../src/ports/platform.js';

const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
function distribution(samples: number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1] ?? null,
    p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? null, maxMs: sorted.at(-1) ?? null};
}

test('US4 load: ten observers, 100 events/s for 60s and 1000 concurrent status reads', {timeout: 120_000}, async t => {
  const harness = await createCliHarness(t);
  assert.equal((await harness.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(harness.archive, 'read'))!;
  const key = await adapter.readCredential(paths.clientKeyFile), transport = createLocalTransport();
  const producer = await openStorage({path: paths.stateFile});
  const subscriptions: EventSubscription[] = [], sentAt = new Map<number, number>();
  const observers = Array.from({length: 10}, () => ({samplesMs: [] as number[], lastSeq: '0', ordered: true}));
  const statusSamples: {elapsedMs: number; result: string; error: string | null}[] = [];
  const anomalies: string[] = [];
  let generated = 0, elapsedMs = 0;
  try {
    await producer.drainEvents();
    for (const observer of observers) {
      const subscription = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {}}, async frame => {
        observer.ordered &&= BigInt(frame.event.seq) === BigInt(observer.lastSeq) + 1n;
        observer.lastSeq = frame.event.seq;
        if (frame.event.type === 'diagnostics.degraded') {
          const count = frame.event.payload.count;
          assert.equal(typeof count, 'number');
          const started = sentAt.get(count as number);
          assert.notEqual(started, undefined);
          observer.samplesMs.push(performance.now() - started!);
        }
      });
      observer.lastSeq = subscription.highWater;
      subscriptions.push(subscription);
    }
    const start = performance.now();
    const writing = (async () => {
      for (let batch = 0; batch < 600; batch++) {
        await pause(start + batch * 100 - performance.now());
        const now = performance.now();
        const records = Array.from({length: 10}, (_, index) => {
          const count = batch * 10 + index; sentAt.set(count, now);
          return {type: 'diagnostics.degraded' as const, payload: {code: 'BUSY', count}};
        });
        await producer.recordEvents(records); generated += records.length;
      }
      await pause(start + 60_000 - performance.now());
      elapsedMs = performance.now() - start;
    })();
    const reading = Promise.all(Array.from({length: 10}, async () => {
      for (let sample = 0; sample < 100; sample++) {
        await pause(start + sample * 600 - performance.now());
        const before = performance.now();
        try {
          const response = await transport.call(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {}}, 2_000);
          statusSamples.push({elapsedMs: performance.now() - before, result: response.result, error: null});
          if (response.result !== 'OK' || !(response.data as {ready: boolean}).ready) anomalies.push(`status ${response.result}`);
        } catch (error) {
          statusSamples.push({elapsedMs: performance.now() - before, result: 'ERROR', error: error instanceof Error ? error.message : 'unknown'});
          anomalies.push('status transport error');
        }
      }
    }));
    await Promise.all([writing, reading]);
    const deadline = performance.now() + 5_000;
    while (observers.some(observer => observer.samplesMs.length !== generated) && performance.now() < deadline) await pause(10);
    const diagnostics = JSON.parse((await harness.call('diagnostics')).stdout).data;
    const samples = {measuredAt: new Date().toISOString(), platform: {node: process.versions.node, os: process.platform, arch: process.arch},
      workload: {observers: 10, requestedEventsPerSecond: 100, requestedDurationMs: 60_000, generated, elapsedMs},
      observers: observers.map(observer => ({...observer, distribution: distribution(observer.samplesMs)})),
      events: distribution(observers.flatMap(observer => observer.samplesMs)),
      status: {...distribution(statusSamples.map(sample => sample.elapsedMs)), samples: statusSamples},
      subscriptions: diagnostics.subscriptions, anomalies};
    await writeFile('specs/001-core-background-daemon/reports/us4-observability-samples.json', JSON.stringify(samples, null, 2) + '\n');
    assert.equal(generated, 6000);
    assert.ok(elapsedMs >= 60_000 && elapsedMs <= 61_000, `load duration ${elapsedMs}ms`);
    assert.equal(statusSamples.length, 1000);
    assert.deepEqual(anomalies, []);
    assert.ok(samples.status.p95Ms! <= 500, `status p95 ${samples.status.p95Ms}ms`);
    assert.ok(statusSamples.every(sample => sample.elapsedMs <= 2_000 || sample.error !== null));
    for (const observer of samples.observers) {
      assert.equal(observer.ordered, true); assert.equal(observer.distribution.count, 6000);
      assert.ok(observer.distribution.p95Ms! <= 1_000, `event p95 ${observer.distribution.p95Ms}ms`);
    }
    for (const subscription of diagnostics.subscriptions.active) assert.ok(subscription.peakBufferedBytes <= 1024 * 1024);
  } catch (error) {
    anomalies.push(error instanceof Error ? error.message : 'unknown');
    await writeFile('specs/001-core-background-daemon/reports/us4-observability-failure.json', JSON.stringify({generated, elapsedMs, observers, statusSamples, anomalies}, null, 2) + '\n');
    throw error;
  } finally {
    await Promise.all(subscriptions.map(subscription => subscription.close()));
    await producer.close();
  }
});