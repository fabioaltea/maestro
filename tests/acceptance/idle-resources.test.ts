import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {cpus, totalmem, release} from 'node:os';
import {writeFile} from 'node:fs/promises';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {createProcessIdentity} from '../../src/platform/macos/process-identity.js';

const execute = promisify(execFile);
function cpuMilliseconds(value: string): number {
  const parts = value.split(':').map(Number);
  assert.ok(parts.length >= 2 && parts.length <= 3 && parts.every(Number.isFinite), `unexpected ps time ${value}`);
  return (parts.length === 3 ? parts[0]! * 3600 + parts[1]! * 60 + parts[2]! : parts[0]! * 60 + parts[1]!) * 1000;
}

test('SC-008/SC-009: same detached instance for ten client-free minutes, RSS <=150 MiB and CPU <=1% of one core', {timeout: 660_000}, async t => {
  const harness = await createCliHarness(t), identity = createProcessIdentity();
  assert.equal((await harness.call('start')).code, 0);
  const before = JSON.parse((await harness.call('status')).stdout);
  const operation = JSON.parse((await harness.call('operation', before.data.currentOperation?.requestId ?? before.requestId)).stdout);
  void operation;
  const pid = before.data.pid as number;
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const samples: {elapsedMs: number; rssBytes: number; cpuMs: number}[] = [], anomalies: string[] = [];
  const start = performance.now();
  let durationMs = 0, cpuPercent: number | null = null;
  try {
    for (let sample = 0; sample <= 120; sample++) {
      const wait = start + sample * 5_000 - performance.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      const {stdout} = await execute('/bin/ps', ['-p', String(pid), '-o', 'rss=', '-o', 'time=']);
      const [rss, time] = stdout.trim().split(/\s+/);
      assert.ok(rss && time, 'owned process must remain present');
      const rssBytes = Number(rss) * 1024;
      assert.ok(Number.isFinite(rssBytes) && rssBytes > 0);
      samples.push({elapsedMs: performance.now() - start, rssBytes, cpuMs: cpuMilliseconds(time)});
    }
    durationMs = samples.at(-1)!.elapsedMs - samples[0]!.elapsedMs;
    cpuPercent = (samples.at(-1)!.cpuMs - samples[0]!.cpuMs) / durationMs * 100;
    const after = JSON.parse((await harness.call('status')).stdout);
    assert.equal(after.instanceId, before.instanceId);
    assert.equal(after.data.pid, pid); assert.equal(after.data.ready, true);
    assert.notEqual(await identity.probeAbsent(pid), 'ABSENT');
    assert.ok(durationMs >= 599_900, `measurement duration ${durationMs}ms`);
    assert.ok(samples.every(sample => sample.rssBytes <= 150 * 1024 * 1024), 'RSS limit exceeded');
    assert.ok(cpuPercent >= 0 && cpuPercent <= 1, `CPU ${cpuPercent}% of one core`);
  } catch (error) {anomalies.push(error instanceof Error ? error.message : 'unknown'); throw error;}
  finally {
    const macOS = (await execute('/usr/bin/sw_vers', ['-productVersion'])).stdout.trim();
    await writeFile('specs/001-core-background-daemon/reports/performance-samples.json', JSON.stringify({measuredAt: new Date().toISOString(),
      platform: {macOS, kernel: release(), arch: process.arch, node: process.versions.node, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem()},
      workload: 'compiled detached daemon; no clients during 600s; ps RSS and cumulative CPU every 5s; RSS includes worker threads',
      pid, instanceId: before.instanceId, requestedDurationMs: 600_000, durationMs, sampleIntervalMs: 5_000,
      targetRssBytes: 150 * 1024 * 1024, maxObservedRssBytes: Math.max(0, ...samples.map(sample => sample.rssBytes)),
      targetCpuPercentOfOneCore: 1, cpuPercentOfOneCore: cpuPercent, samples, anomalies}, null, 2) + '\n');
  }
});