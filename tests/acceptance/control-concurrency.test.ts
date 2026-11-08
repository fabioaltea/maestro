import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {recoveryScenario} from '../fixtures/recovery-scenarios.js';
import {createDaemonLauncher} from '../../src/platform/macos/launcher.js';
import {createProcessIdentity} from '../../src/platform/macos/process-identity.js';
import {openStorage} from '../../src/storage/worker.js';

test('SC-003: 100 rounds of ten simultaneous starts and 100 identical restart retries', {timeout: 600_000}, async t => {
  const harness = await createCliHarness(t), samples: {round: number; elapsedMs: number; codes: (number | null)[]; instanceId: string; claims: number}[] = [];
  const anomalies: string[] = [];
  const retryCodes: (number | null)[] = [];
  let retries = 0;
  try {
    for (let round = 1; round <= 100; round++) {
      const started = performance.now();
      const results = await Promise.all(Array.from({length: 10}, () => harness.call('start')));
      for (const result of results) assert.ok(result.code === 0 || result.code === 3, result.stdout || result.stderr);
      assert.ok(results.some(result => result.code === 0));
      const status = JSON.parse((await harness.call('status')).stdout);
      assert.equal(status.data.ready, true);
      for (const result of results.filter(result => result.code === 0)) assert.equal(JSON.parse(result.stdout).instanceId, status.instanceId);
      const store = await openStorage({path: `${harness.archive}/state.sqlite`, readonly: true});
      let claims = 0;
      try {
        for (const result of results) claims += (await store.listTickets(JSON.parse(result.stdout).requestId)).filter(ticket => ticket.status === 'CLAIMED').length;
      } finally {await store.close();}
      samples.push({round, elapsedMs: performance.now() - started, codes: results.map(result => result.code), instanceId: status.instanceId, claims});
      assert.equal(claims, 1, 'exactly one launch ticket claimed per start round');
      assert.equal((await harness.call('stop')).code, 0);
      assert.equal(await createProcessIdentity().probeAbsent(status.data.pid), 'ABSENT');
    }
    assert.equal((await harness.call('start')).code, 0);
    const requestId = randomUUID(), first = await harness.call('restart', '--request-id', requestId);
    assert.equal(first.code, 0, first.stdout);
    const successor = JSON.parse(first.stdout).instanceId;
    for (let batch = 0; batch < 10; batch++) {
      const responses = await Promise.all(Array.from({length: 10}, () => harness.call('restart', '--request-id', requestId)));
      for (const response of responses) {
        retryCodes.push(response.code);
        assert.ok(response.code === 0 || response.code === 3, response.stdout);
        if (response.code === 0) assert.equal(JSON.parse(response.stdout).instanceId, successor);
        else {
          const historical = await harness.call('operation', requestId);
          assert.equal(historical.code, 0, historical.stdout);
          assert.equal(JSON.parse(historical.stdout).data.operation.successorInstanceId, successor);
        }
        retries++;
      }
      assert.equal(JSON.parse((await harness.call('status')).stdout).instanceId, successor);
    }
    assert.equal(new Set(samples.map(sample => sample.instanceId)).size, 100);
  } catch (error) {anomalies.push(error instanceof Error ? error.message : 'unknown'); throw error;}
  finally {
    await writeFile('specs/001-core-background-daemon/reports/concurrency-samples.json', JSON.stringify({measuredAt: new Date().toISOString(), platform: {node: process.versions.node, os: process.platform, arch: process.arch}, requestedRounds: 100, concurrentStarts: 10, completedRounds: samples.length, requestedRetries: 100, completedRetries: retries, retryCodes, samples, anomalies}, null, 2) + '\n');
  }
});

test('SC-003: lost controller preserves the successor and a delayed cancelled candidate is fenced', async t => {
  const lost = await recoveryScenario(t, 'control.ready');
  const store = await openStorage({path: lost.paths.stateFile, readonly: true});
  try {
    const original = (await store.readSnapshot())!.instance!.instanceId;
    assert.equal((await lost.call('start', '--request-id', lost.requestId)).code, 0);
    assert.equal((await store.readSnapshot())!.instance!.instanceId, original);
  } finally {await store.close();}
  const delayed = await recoveryScenario(t, 'control.ticketIssued');
  const reader = await openStorage({path: delayed.paths.stateFile, readonly: true});
  try {
    const ticket = (await reader.listTickets(delayed.requestId))[0]!;
    assert.equal((await delayed.call('stop')).code, 0);
    const candidate = await createDaemonLauncher().spawnDaemon({ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: delayed.archive});
    assert.notEqual((await candidate.exit).code, 0);
    assert.equal((await reader.getTicket(ticket.ticketId))!.status, 'CANCELLED');
    assert.equal((await reader.readSnapshot())!.instance, null);
  } finally {await reader.close();}
});