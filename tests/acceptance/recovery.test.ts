import { SCHEMA_VERSION } from '../../src/storage/schema.js';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { arch, cpus, totalmem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { recoveryPoints, recoveryScenario } from '../fixtures/recovery-scenarios.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';
import { createOperations } from '../../src/core/operations.js';
import { openStorage } from '../../src/storage/worker.js';
import type { OperationRecord } from '../../src/ports/storage.js';

const samples: {point: string; elapsedMs: number; code: number | null; sameSuccessor: boolean}[] = [];
const anomalies: string[] = [];
let loaded: Record<string, unknown> | null = null, blocked: Record<string, unknown> | null = null;
const digest = (rows: readonly OperationRecord[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
after(async () => {
  const values = samples.map(s => s.elapsedMs).sort((a, b) => a - b);
  await writeFile(resolve('specs/001-core-background-daemon/reports/f2-recovery-samples.json'), JSON.stringify({
    measuredAt: new Date().toISOString(), platform: {macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(), arch: arch(), node: process.versions.node, cpu: cpus()[0]?.model, logicalCpus: cpus().length, memoryBytes: totalmem(), filesystem: 'APFS'},
    crashScenarios: samples.length, matrixProcessCrashes: samples.length + samples.filter(s => s.point.startsWith('recovery.')).length,
    recoveryTargetMs: 30_000, p95Ms: values[Math.ceil(values.length * .95) - 1] ?? null, maxMs: values.at(-1) ?? null,
    loaded, blocked, anomalies, samples,
  }, null, 2) + '\n');
});

test('SC-004/005: thirty distributed crash scenarios preserve outcomes and never duplicate a successor', async t => {
  for (let index = 0; index < 30; index++) {
    const point = recoveryPoints[index % recoveryPoints.length]!;
    await t.test(`${index + 1}: ${point}`, async subtest => {
      try {
        const h = await recoveryScenario(subtest, point);
        const start = performance.now();
        const recovered = await h.call(h.action, '--request-id', h.requestId);
        const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
        assert.equal(recovered.code, 0, recovered.stdout);
        assert.ok(elapsedMs <= 30_000);
        const operation = JSON.parse(recovered.stdout).data.operation;
        const repeated = await h.call(h.action, '--request-id', h.requestId);
        const historical = JSON.parse(repeated.stdout).data.operation;
        const sameSuccessor = operation.successorInstanceId === historical.successorInstanceId;
        samples.push({point, elapsedMs, code: recovered.code, sameSuccessor});
        assert.equal(repeated.code, 0, repeated.stdout);
        assert.equal(sameSuccessor, true);
        assert.deepEqual(historical, operation);
      } catch (error) { anomalies.push(`${point}: ${error instanceof Error ? error.message : 'unknown'}`); throw error; }
    });
  }
});

for (const mode of ['loaded', 'foreign'] as const) {
  test(mode === 'loaded' ? 'recovery with 1,000 confirmed operations and ten surviving auxiliaries completes within 30s' : 'uncertain live resource remains blocked and preserved until explicit fixture shutdown', async t => {
    const sandbox = await createProcessSandbox(t), h = await createCliHarness(t);
    const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'write'))!;
    await adapter.createCredential(paths.clientKeyFile);
    const store = await openStorage({path: paths.stateFile, identity: {storeId: randomUUID(), schemaVersion: SCHEMA_VERSION, ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0'}});
    const confirmed: OperationRecord[] = [], children: ReturnType<typeof sandbox.spawnFixture>[] = [];
    let daemon: ReturnType<typeof sandbox.spawnFixture> | undefined;
    try {
      for (let index = 0; index < (mode === 'loaded' ? 1_000 : 1); index++) {
        const requestId = randomUUID();
        await store.acceptOperation({requestId, action: 'stop', targetInstanceId: null, payloadHash: 'a'.repeat(64), ownerUid: paths.ownerUid, acceptedAt: new Date().toISOString()});
        await store.completeOperation(requestId, 'SUCCEEDED', new Date().toISOString(), null);
        confirmed.push((await store.getOperation(requestId))!);
      }
      const operations = createOperations(store, paths.ownerUid), requestId = randomUUID();
      await operations.accept({requestId, action: 'start', targetInstanceId: null, canonicalStateDir: paths.directory});
      const ticket = await operations.issueLaunch(requestId, randomUUID());
      const file = join(h.directory, 'loaded-daemon.json');
      await writeFile(file, JSON.stringify({ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: paths.directory}), {mode: 0o600});
      daemon = sandbox.spawnFixture('recovery-actor.js', [file, 'daemon.running']);
      await sandbox.waitForMessage(daemon, 'paused', 5_000);
      assert.equal(JSON.parse((await h.call('status')).stdout).data.ready, true);
      await store.completeOperation(requestId, 'SUCCEEDED', new Date().toISOString(), null);
      for (let index = 0; index < (mode === 'loaded' ? 10 : 1); index++) {
        const id = randomUUID(), endpoint = join(paths.runtimeDirectory, `a-${id}.sock`), credentialRef = join(paths.credentialsDirectory, `a-${id}.key`);
        await adapter.createCredential(credentialRef);
        const child = mode === 'loaded' ? sandbox.spawnFixture('foundation-auxiliary.js', [endpoint, id, credentialRef, 'cooperative']) : sandbox.spawnFixture('controlled-child.js');
        children.push(child);
        await sandbox.waitForMessage(child, 'ready');
        await store.saveResource({resourceId: id, owningInstanceId: ticket.instanceId, kind: 'auxiliary', policyScope: 'foundation', generation: '1', pid: child.pid!, endpoint, credentialRef, observation: 'UNKNOWN', releaseState: 'OWNED'});
      }
      await sandbox.requestExit(daemon, 'crash');
      const start = performance.now(), recovered = await h.call('start');
      const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
      const result = JSON.parse(recovered.stdout);
      const observed = await Promise.all(confirmed.map(op => store.getOperation(op.requestId)));
      assert.deepEqual(observed, confirmed);
      if (mode === 'loaded') {
        loaded = {confirmedOperations: confirmed.length, auxiliaries: children.length, elapsedMs, code: recovered.code,
          beforeDigest: digest(confirmed), afterDigest: digest(observed as OperationRecord[]), resourcesReleased: false};
        assert.equal(recovered.code, 0, recovered.stdout);
        assert.ok(elapsedMs <= 30_000);
        assert.notEqual(result.instanceId, ticket.instanceId);
        for (const child of children) assert.equal(await createProcessIdentity().probeAbsent(child.pid!), 'ABSENT');
        assert.ok((await store.listResources(ticket.instanceId)).every(r => r.releaseState === 'RELEASED'));
        loaded.resourcesReleased = true;
      } else {
        assert.equal(recovered.code, 4, recovered.stdout);
        assert.equal(children[0]!.exitCode, null);
        const status = JSON.parse((await h.call('status')).stdout);
        assert.equal(status.data.ready, false);
        assert.ok(status.data.resourceIssues.length > 0);
        blocked = {elapsedMs, code: recovered.code, resourcePreserved: true, resources: status.data.resourceIssues, nextAction: result.error.nextAction};
        await sandbox.requestExit(children[0]!, 'shutdown');
        const retry = await h.call('start');
        assert.equal(retry.code, 0, retry.stdout);
        blocked.explicitRetrySucceeded = true;
      }
    } catch (error) { anomalies.push(`${mode}: ${error instanceof Error ? error.message : 'unknown'}`); throw error; }
    finally {
      if (daemon && daemon.exitCode === null && daemon.signalCode === null) await sandbox.requestExit(daemon, 'crash');
      for (const child of children) await sandbox.requestExit(child, 'shutdown');
      await store.close();
    }
  });
}
