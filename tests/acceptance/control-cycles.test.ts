import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arch, cpus, totalmem, release } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { openStorage } from '../../src/storage/worker.js';

type Action = 'start' | 'restart' | 'stop';
interface Sample { cycle: number; action: Action; elapsedMs: number; exitCode: number | null; outcome: string | null }

test('SC-001: 30 ordinary control cycles, verified old exit and zero live Foundation residue', async t => {
  const h = await createCliHarness(t);
  const paths = (await createPlatformPaths().resolveArchive(h.archive, 'write'))!;
  const identity = createProcessIdentity();
  const samples: Sample[] = [];
  const anomalies: string[] = [];
  const limits = { start: 5_000, stop: 10_000, restart: 15_000 };
  let completedCycles = 0;
  async function command(cycle: number, action: Action) {
    const start = performance.now();
    const response = await h.call(action);
    const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
    const result = JSON.parse(response.stdout);
    samples.push({ cycle, action, elapsedMs, exitCode: response.code, outcome: result.outcome });
    assert.equal(response.code, 0, response.stdout);
    assert.equal(result.outcome, 'SUCCEEDED');
    return result;
  }
  try {
    for (let cycle = 1; cycle <= 30; cycle++) {
      const first = await command(cycle, 'start');
      const store = await openStorage({ path: paths.stateFile, readonly: false });
      try {
        const old = (await store.readSnapshot())!.instance!;
        const restarted = await command(cycle, 'restart');
        assert.notEqual(restarted.instanceId, old.instanceId);
        assert.equal(await identity.probeAbsent(old.pid), 'ABSENT');
        assert.ok((await store.listResources(old.instanceId)).every(r => r.releaseState === 'RELEASED'));
        const successor = (await store.readSnapshot())!.instance!;
        const stopped = await command(cycle, 'stop');
        assert.equal(await identity.probeAbsent(successor.pid), 'ABSENT');
        assert.equal((await store.readSnapshot())!.instance!.lifecycle, 'STOPPED');
        assert.ok((await store.listResources(successor.instanceId)).every(r => r.releaseState === 'RELEASED'));
        await assert.rejects(lstat(paths.daemonEndpoint), { code: 'ENOENT' });
        const lease = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
        assert.equal(lease.status, 'HELD');
        if (lease.status === 'HELD') lease.handle.release();
        const attempt = await store.getControllerAttempt(stopped.requestId);
        const deadline = performance.now() + 2_000;
        while (attempt && await identity.probeAbsent(attempt.pid) !== 'ABSENT') {
          assert.ok(performance.now() < deadline, 'controller exit must precede cleanup');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        completedCycles++;
      } finally { await store.close(); }
    }
    for (const action of ['start', 'stop', 'restart'] as const) {
      const values = samples.filter(s => s.action === action);
      assert.equal(values.length, 30);
      assert.ok(values.filter(s => s.exitCode === 0 && s.elapsedMs <= limits[action]).length >= 29, `${action} misses 95% target`);
    }
  } catch (error) {
    anomalies.push(error instanceof Error ? error.message : 'unclassified failure');
    throw error;
  } finally {
    const measurements = Object.fromEntries((['start', 'stop', 'restart'] as const).map(action => {
      const values = samples.filter(s => s.action === action).map(s => s.elapsedMs).sort((a, b) => a - b);
      return [action, { targetMs: limits[action], count: values.length,
        p50Ms: values[Math.ceil(values.length * .5) - 1] ?? null,
        p95Ms: values[Math.ceil(values.length * .95) - 1] ?? null, maxMs: values.at(-1) ?? null,
        withinTarget: values.filter(v => v <= limits[action]).length }];
    }));
    await writeFile(resolve('specs/001-core-background-daemon/reports/f2-control-samples.json'), JSON.stringify({
      measuredAt: new Date().toISOString(), platform: { macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
        kernel: release(), arch: arch(), node: process.versions.node, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), filesystem: 'APFS' },
      workload: 'sequential compiled CLI; 30 start/restart/stop cycles; no auxiliaries; one client; 90 operations accumulated; isolated local archive',
      completedCycles, measurements, anomalies, samples,
    }, null, 2) + '\n');
  }
});
