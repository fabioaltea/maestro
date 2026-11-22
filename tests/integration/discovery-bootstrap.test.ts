import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createCliHarness, invokeCli } from '../fixtures/cli-harness.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { createDiscoveryRuntime } from '../../src/core/discovery/runtime.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { AgentRuntimePort, AgentProcessIdentity } from '../../src/ports/agent-runtime.js';
import { DISCOVERY_RUNTIME_POLICY } from '../../src/ports/agent-runtime.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { value } from '../fixtures/discovery-artifacts.js';

test('production daemon composes Discovery preview admission without provider, login or Electron', async t => {
  const h = await createCliHarness(t), repositories = await createProjectRepositories(t), repo = await repositories.createRepository('bootstrap');
  assert.equal((await h.call('start')).code, 0);
  const status = JSON.parse((await h.call('status')).stdout);
  assert.equal(status.data.capabilities.discoveryVersion, 1);
  for (const method of ['discovery.preview', 'discovery.prepare', 'discovery.provider.configure', 'discovery.start']) assert.ok(status.data.capabilities.discoveryMethods.includes(method));
  const added = await invokeCli(['project', 'add', repo, '--state-dir', h.archive, '--json']); assert.equal(added.code, 0);
  const projectId = JSON.parse(added.stdout).data.operation.result.projectId as string, before = await repositories.snapshotTree(repo);
  const run = async (...args: string[]) => JSON.parse((await invokeCli(['discovery', ...args, '--state-dir', h.archive, '--json'])).stdout);
  const provider = await run('provider', 'get'); assert.equal(provider.data.configuration, null); assert.equal(provider.data.check, null); assert.ok(provider.data.requirements.binarySha256);
  const scope = join(h.directory, 'scope.json'); await writeFile(scope, JSON.stringify(['tracked.txt']));
  const requestId = randomUUID(), submitted = await run('preview', projectId, '--expected-revision=1', `--scope-file=${scope}`, `--request-id=${requestId}`);
  assert.equal(submitted.data.accepted, true); assert.equal(submitted.requestId, requestId);
  let operation;
  const deadline = performance.now() + 8000;
  do {
    operation = (await run('operation', requestId)).data.operation;
    if (operation?.phase === 'FINALIZED') break;
    assert.ok(performance.now() < deadline, 'preview completed within the local test budget'); await new Promise(resolve => setTimeout(resolve, 20));
  } while (true);
  assert.equal(operation.outcome, 'SUCCEEDED', JSON.stringify(operation));
  const snapshotId = operation.result.snapshotId;
  const preview = await run('preview', 'show', snapshotId); assert.equal(preview.data.snapshot.state, 'SEALED'); assert.equal(preview.data.snapshot.fileCount, 1);
  assert.deepEqual((await run('list', projectId)).data.items, []);
  assert.equal((await h.call('stop')).code, 0);
  assert.equal((await run('preview', 'show', snapshotId)).freshness, 'LAST_KNOWN');
  assert.deepEqual(await repositories.snapshotTree(repo), before);
});

function inertAgent(): AgentRuntimePort {
  return { launch: async () => { throw new Error('NO_PROVIDER_LAUNCH_EXPECTED'); }, authorizeStart: async () => ({ ok: false, code: 'PROVIDER_UNAVAILABLE' }),
    observe: async () => ({ ok: false, code: 'RESOURCE_IDENTITY_UNKNOWN' }), reconcile: async () => ({ ok: true, value: null }),
    cancel: async () => ({ ok: false, code: 'RESOURCE_IDENTITY_UNKNOWN' }), stopWithin: async () => ({ ok: true, value: undefined }) };
}
test('composition reads never probe the provider, and an explicit unsafe check leaves registry and history readable', async t => {
  const f = await launchFixture(t), runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context, agent: inertAgent() });
  await runtime.recover();
  const call = (method: string, params = {}) => runtime.dispatch({ protocolVersion: 1, correlationId: randomUUID(), method, params }, f.peer, f.store.readSnapshot()!);
  assert.equal((await call('discovery.provider.get')).result, 'OK'); assert.equal((await call('discovery.list', { projectId: f.projectId })).result, 'OK');
  assert.equal(f.counts().checks, 0); assert.equal(f.counts().inspections, 0);
  f.availability.value = { ...f.availability.value, state: 'UNSAFE', code: 'PROVIDER_UNSAFE' };
  const requestId = randomUUID(); assert.equal((await call('discovery.provider.check', { requestId, expectedProviderRevision: '1' })).result, 'OK');
  await runtime.operations.idle();
  const provider = await call('discovery.provider.get'); assert.equal((provider.data as { check: { state: string } }).check.state, 'UNSAFE');
  assert.equal(f.counts().checks, 1); assert.equal(f.counts().runs, 0); assert.ok(f.store.getProject(f.projectId));
  assert.equal((await call('discovery.list', { projectId: f.projectId })).result, 'OK');
  runtime.fence(); assert.equal((await call('discovery.provider.check', { requestId: randomUUID(), expectedProviderRevision: '1' })).result, 'BLOCKED');
});
test('unknown saved runtime fences admission and blocks stop while preserving the process identity and history', async t => {
  const f = await launchFixture(t), grant = await f.prepare(); value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle();
  const run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.launches[0]!.runId })).data!;
  const identity: AgentProcessIdentity = { runId: run.runId, generation: run.generation, owningInstanceId: f.instanceId, hostPid: process.pid, providerPid: null,
    hostEndpoint: join(f.paths.runtimeDirectory, `a-${run.runId}.sock`), credentialRef: join(f.paths.credentialsDirectory, `agent-${run.runId}.key`),
    policy: DISCOVERY_RUNTIME_POLICY, observation: 'UNKNOWN', releaseState: 'OWNED' };
  value(f.store.commitDiscoveryMetadata({ kind: 'process', value: identity }));
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context, agent: inertAgent() });
  await runtime.recover();
  const result = await runtime.dispatch({ protocolVersion: 1, correlationId: randomUUID(), method: 'discovery.preview', params: { requestId: randomUUID(), projectId: f.projectId, expectedConfigRevision: '1', selectors: ['tracked.txt'] } }, f.peer, f.store.readSnapshot()!);
  assert.equal(result.result, 'BLOCKED');
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: run.discoveryId })).data!.state, 'RECONCILING');
  await assert.rejects(runtime.stop(makeDeadline(systemClock, 100)), /RESOURCE_IDENTITY_UNKNOWN/);
  assert.deepEqual(value(f.store.readDiscoveryMetadata({ kind: 'process', id: run.runId })).data, identity);
});
test('a store without Discovery keeps Foundation stop available without initializing or draining an agent', async () => {
  const agent = inertAgent(); agent.stopWithin = async () => { throw new Error('NO_AGENT_IN_HISTORICAL_STORE'); };
  const storage = { readSnapshot: async () => ({ store: { schemaVersion: 3 } }) } as unknown as StoragePort;
  const paths = { directory: '/owned/archive', ownerUid: process.getuid!(), runtimeDirectory: '/owned/runtime' } as Parameters<typeof createDiscoveryRuntime>[1];
  const runtime = createDiscoveryRuntime(storage, paths, randomUUID(), { agent });
  await runtime.stop(makeDeadline(systemClock, 100));
});
test('composed start consumes one durable admission before the runtime seam and an original-UUID replay never relaunches', async t => {
  const f = await launchFixture(t); let launches = 0;
  const agent = inertAgent();
  agent.launch = async input => {
    launches++; const run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: input.identity.runId })).data!;
    assert.equal(f.store.getDiscoveryOperation(run.requestId)!.outcome, 'SUCCEEDED'); assert.equal(run.phase, 'SPAWN_INTENT');
    assert.equal(input.stdin.includes('base\\n'), true);
    value(f.store.commitDiscoveryMetadata({ kind: 'process', value: input.identity }));
    value(f.store.commitDiscoveryMetadata({ kind: 'run', value: { ...run, phase: 'HOST_READY' }, expectedPhase: 'SPAWN_INTENT', exitVerified: false }));
    return { ok: true, value: input.identity };
  };
  agent.authorizeStart = async identity => {
    assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: identity.runId })).data!.phase, 'SPAWN_AUTHORIZED');
    return { ok: true, value: undefined };
  };
  agent.cancel = async identity => ({ ok: true, value: { runId: identity.runId, generation: identity.generation, hostExited: true, providerExited: true, outcome: 'CANCELLED', authentication: 'SYNTHETIC_NO_PROCESS' } });
  const provider = { ...f.provider, createOutputDecoder: () => ({ feed: () => ({ ok: true as const, value: [] }), finish: () => ({ ok: false as const, code: 'PROVIDER_PROTOCOL_ERROR' as const }) }),
    buildInvocation: async () => ({ ok: true as const, value: { executable: '/synthetic/provider', args: [], cwd: f.paths.runtimeDirectory, env: {} } }) };
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider, context: f.context, agent,
    files: { prepare: async () => ({ ok: true, value: { runtime: f.paths.runtimeDirectory, schema: '/synthetic/schema' } }) } });
  await runtime.recover();
  const grant = value(await runtime.operations.prepare(f.peer, f.intent())), requestId = randomUUID();
  const request = { protocolVersion: 1 as const, correlationId: randomUUID(), method: 'discovery.start', params: { requestId, grantId: grant.grantId, projectId: f.projectId } };
  assert.equal((await runtime.dispatch(request, f.peer, f.store.readSnapshot()!)).result, 'OK'); await runtime.operations.idle();
  assert.equal(launches, 1); assert.equal((await runtime.dispatch(request, f.peer, f.store.readSnapshot()!)).result, 'OK'); await runtime.operations.idle(); assert.equal(launches, 1);
  await runtime.stop(makeDeadline(systemClock, 1000));
  const operation = f.store.getDiscoveryOperation(requestId)!;
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: operation.discoveryId! })).data!.state, 'INTERRUPTED');
});
