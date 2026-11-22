import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { StoragePort } from '../../src/ports/storage.js';
import type { ProviderEvent } from '../../src/ports/provider.js';
import type { ArchitectResult } from '../../src/domain/discovery/documents.js';
import { createDiscoveryLauncher } from '../../src/core/discovery/launch.js';
import { createAgentRuntime } from '../../src/platform/macos/discovery/agent-runtime.js';
import { createDiscoveryRunFiles } from '../../src/platform/macos/discovery/runtime-files.js';
import { createCodexOutputDecoder } from '../../src/providers/codex/parser.js';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { waitFor, agentDeadline } from '../fixtures/discovery-agent-runtime.js';
import type { AgentRuntimePort } from '../../src/ports/agent-runtime.js';

for (const mode of ['success', 'tool', 'empty', 'malformed', 'nonzero', 'files-failed', 'publication-failed']) {
  test(`core provider launch/${mode}: durable GO, verified exit and structural result are distinct gates`, async t => {
    let runtime: ReturnType<typeof createAgentRuntime> | undefined;
    let cleanupAllowed = true;
    const hosts: ChildProcess[] = [], results: ArchitectResult[] = [], output: ProviderEvent[] = [];
    t.after(async () => {
      cleanupAllowed = false;
      if (runtime) assert.equal((await runtime.stopWithin(agentDeadline())).ok, true, 'do not clean an unverified provider');
      for (const host of hosts) await waitFor(() => host.exitCode !== null || host.signalCode !== null, 4500);
      cleanupAllowed = true;
    });
    let launcher!: ReturnType<typeof createDiscoveryLauncher>;
    const f = await launchFixture(t, { onLaunch: input => launcher.launch(input), cleanupAllowed: () => cleanupAllowed });
    f.provider.createOutputDecoder = createCodexOutputDecoder;
    f.provider.buildInvocation = async (_configuration, cwd) => ({ ok: true, value: { executable: process.execPath,
      args: [fileURLToPath(new URL('../fixtures/discovery-jsonl-provider.js', import.meta.url)), mode], cwd, env: { HOME: cwd, PATH: '/usr/bin:/bin' } } });
    runtime = createAgentRuntime({ paths: f.paths, instanceId: f.instanceId, storage: f.store as unknown as StoragePort,
      providerModuleUrl: new URL('../fixtures/discovery-agent-launcher.js', import.meta.url).href,
      observeHost: child => { hosts.push(child); }, onStdout: (identity, bytes) => launcher.output(identity, bytes), onExit: (identity, proof) => launcher.exited(identity, proof) });
    launcher = createDiscoveryLauncher({ paths: f.paths, instanceId: f.instanceId, storage: f.store as unknown as StoragePort, provider: f.provider,
      files: mode === 'files-failed' ? { prepare: async () => ({ ok: false, code: 'PROVIDER_UNSAFE' }) } : createDiscoveryRunFiles(f.paths), runtime, onEvent: async (_identity, event) => { output.push(event); }, onResult: async (identity, result) => {
        assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: identity.runId })).data?.phase, 'EXIT_OBSERVED');
        assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'process', id: identity.runId })).data?.observation, 'ABSENT');
        if (mode === 'publication-failed') throw new Error('ARTIFACT_CORRUPT'); results.push(result);
      } });
    const before = await f.repositories.snapshotTree(f.repo), grant = await f.prepare(), request = f.startInput(grant);
    value(await f.service.start(f.peer, request)); await f.service.idle(); assert.equal(f.launches.length, 1); assert.equal(hosts.length, mode === 'files-failed' ? 0 : 1);
    const runId = f.launches[0]!.runId;
    await waitFor(() => value(f.store.readDiscoveryMetadata({ kind: 'run', id: runId })).data?.phase === (mode === 'publication-failed' ? 'FINALIZED' : 'EXIT_OBSERVED'), 4500);
    if (mode !== 'files-failed') await waitFor(() => value(f.store.readDiscoveryMetadata({ kind: 'process', id: runId })).data?.releaseState === 'RELEASED', 4500);
    const run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: runId })).data!;
    assert.equal(run.outcome, mode === 'success' ? 'SUCCEEDED' : 'FAILED');
    if (mode === 'success') { await waitFor(() => results.length === 1); assert.equal(results[0]!.kind, 'QUESTIONS'); }
    else { assert.equal(results.length, 0); assert.equal(run.error, mode === 'nonzero' ? 'PROVIDER_UNAVAILABLE' : mode === 'files-failed' ? 'PROVIDER_UNSAFE' : mode === 'publication-failed' ? 'ARTIFACT_CORRUPT' : 'PROVIDER_PROTOCOL_ERROR'); }
    assert.equal(output.length > 0, mode !== 'files-failed'); assert.ok(!JSON.stringify(output).includes('SYNTHETIC_PRIVATE_STDERR'));
    assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_approvals').get() as { n: number }).n), 0);
    assert.deepEqual(await f.repositories.snapshotTree(f.repo), before);
    value(await f.service.start(f.peer, request)); await f.service.idle(); assert.equal(hosts.length, mode === 'files-failed' ? 0 : 1);
  });
}
test('a pre-existing process intent is preserved without creating runtime files, adopting a PID or fabricating absence', async t => {
  let launcher!: ReturnType<typeof createDiscoveryLauncher>, files = 0, processEffects = 0;
  const f = await launchFixture(t, { onLaunch: async input => {
    value(f.store.commitDiscoveryMetadata({ kind: 'process', value: { runId: input.run.runId, generation: input.run.generation, owningInstanceId: f.instanceId,
      hostPid: process.pid, providerPid: null, hostEndpoint: join(f.paths.runtimeDirectory, `a-${input.run.runId}.sock`),
      credentialRef: join(f.paths.credentialsDirectory, `agent-${input.run.runId}.key`), observation: 'UNKNOWN', releaseState: 'BLOCKED', policy: 'cancel-on-owner-loss-v1' } }));
    await assert.rejects(launcher.launch(input), /RESOURCE_IDENTITY_UNKNOWN/);
  } });
  f.provider.createOutputDecoder = createCodexOutputDecoder;
  launcher = createDiscoveryLauncher({ paths: f.paths, instanceId: f.instanceId, storage: f.store as unknown as StoragePort, provider: f.provider,
    files: { prepare: async () => { files++; return { ok: false, code: 'PROVIDER_UNSAFE' }; } },
    runtime: new Proxy({} as AgentRuntimePort, { get: () => async () => { processEffects++; throw new Error('NO_PROCESS_EFFECT_ALLOWED'); } }),
    onResult: async () => { assert.fail('NO_RESULT_ALLOWED'); } });
  const grant = await f.prepare(); value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle();
  const runId = f.launches[0]!.runId;
  assert.equal(files, 0); assert.equal(processEffects, 0);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'process', id: runId })).data?.hostPid, process.pid);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: runId })).data?.phase, 'SPAWN_INTENT');
  assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as { discovery_id: string }).discovery_id, f.launches[0]!.discoveryId);
});
