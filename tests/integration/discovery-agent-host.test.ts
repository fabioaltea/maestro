import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { agentFixture, agentDeadline, loadRuntime, waitFor } from '../fixtures/discovery-agent-runtime.js';
import { value } from '../fixtures/discovery-artifacts.js';

test('one owned host waits for durable GO, then starts exactly one provider and remains distinct from Foundation resources', async t => {
  const f = await agentFixture(t), ready = value(await f.launch());
  assert.equal(ready.observation, 'VERIFIED'); assert.ok(ready.hostPid); assert.equal(ready.providerPid, null); await assert.rejects(access(f.marker));
  await f.authorize(ready); value(await f.runtime.authorizeStart(ready));
  await waitFor(() => f.stdout.length > 0);
  assert.equal((await readFile(f.marker, 'utf8')).split('provider-started').length - 1, 1);
  assert.equal(f.store.listResources(f.instanceId).length, 0);
  const proof = value(await f.runtime.cancel(ready, agentDeadline())); assert.equal(proof.hostExited, true); assert.equal(proof.providerExited, true);
});
test('same run launch replays its host; changed input cannot start another process', async t => {
  const f = await agentFixture(t), first = value(await f.launch()), replay = value(await f.launch());
  assert.equal(first.hostPid, replay.hostPid); assert.equal(f.hosts.length, 1);
  assert.equal((await f.runtime.launch({ identity: f.identity, invocation: f.invocation, stdin: f.stdin + ' ', deadline: agentDeadline() })).ok, false); assert.equal(f.hosts.length, 1);
});
for (const go of [false, true]) {
  test(`owner lifeline loss ${go ? 'after' : 'before'} GO yields authenticated exit proof and no automatic restart`, async t => {
    const f = await agentFixture(t), ready = value(await f.launch()); if (go) await f.authorize(ready);
    f.hosts[0]!.disconnect();
    await waitFor(() => f.hosts[0]!.exitCode !== null || f.hosts[0]!.signalCode !== null, 4000);
    const recovered = value(await f.runtime.reconcile(ready)); assert.ok(recovered); assert.equal(recovered.providerExited, true); assert.equal(recovered.hostExited, true);
    if (!go) await assert.rejects(access(f.marker));
    assert.equal(f.hosts.length, 1);
  });
}
for (const go of [false, true]) {
  test(`SIGKILL host ${go ? 'after' : 'before'} GO without proof stays uncertain and retains the slot`, async t => {
    const f = await agentFixture(t, { allowUnknown: true, lifetime: 700 }), ready = value(await f.launch()); if (go) await f.authorize(ready);
    f.hosts[0]!.kill('SIGKILL'); await waitFor(() => f.hosts[0]!.signalCode !== null);
    const result = await f.runtime.reconcile(ready); assert.ok(!result.ok || result.value === null);
    assert.equal((f.database.prepare('SELECT discovery_id FROM discovery_slot WHERE singleton=1').get() as { discovery_id: string }).discovery_id, f.discovery.discoveryId);
    if (!go) await assert.rejects(access(f.marker));
  });
}
test('cancellation escalates only on the owned provider handle within the existing four-second budget', async t => {
  const f = await agentFixture(t, { mode: 'ignore-term' }), ready = value(await f.launch()); await f.authorize(ready);
  await waitFor(() => f.stdout.length > 0);
  const started = performance.now(), proof = value(await f.runtime.cancel(ready, agentDeadline()));
  assert.ok(performance.now() - started <= 4000); assert.equal(proof.providerExited, true); assert.equal(proof.hostExited, true);
  assert.match(await readFile(f.marker, 'utf8'), /provider-term/); assert.equal(proof.signal, 'SIGKILL');
});
test('tampered proof, wrong generation and an occupied reused PID cannot establish absence', async t => {
  const f = await agentFixture(t, { allowUnknown: true }), ready = value(await f.launch()); await f.authorize(ready); value(await f.runtime.cancel(ready, agentDeadline()));
  const original = await readFile(f.proofFile, 'utf8'), proof = JSON.parse(original); await writeFile(f.proofFile, JSON.stringify({ ...proof, authentication: '0'.repeat(64) }), { mode: 0o600 });
  const { createAgentRuntime } = await loadRuntime(), fresh = createAgentRuntime({ ...f.runtimeOptions, processIdentity: { probeAbsent: async () => 'UNKNOWN' } });
  const corrupted = await fresh.reconcile(ready); assert.ok(!corrupted.ok || corrupted.value === null);
  await writeFile(f.proofFile, original);
  const reused = await fresh.reconcile(ready); assert.ok(!reused.ok || reused.value === null);
  const wrong = await f.runtime.reconcile({ ...ready, generation: randomUUID() }); assert.ok(!wrong.ok || wrong.value === null);
});
test('a persisted foreign PID never receives a signal or becomes an adopted process', async t => {
  const f = await agentFixture(t), foreign = f.context.spawnNode([new URL('../fixtures/discovery-agent-provider.js', import.meta.url).pathname, 'foreign', f.marker, '10000']);
  await waitFor(async () => { try { return (await readFile(f.marker, 'utf8')).includes('provider-started'); } catch { return false; } });
  const identity = { ...f.identity, hostPid: foreign.pid!, providerPid: foreign.pid! };
  assert.equal((await f.runtime.cancel(identity, agentDeadline())).ok, false);
  assert.equal(foreign.exitCode, null); assert.doesNotMatch(await readFile(f.marker, 'utf8'), /provider-term/);
});
test('an expired cancellation deadline does not turn an unverified exit into success', async t => {
  const f = await agentFixture(t), ready = value(await f.launch()), started = performance.now();
  assert.equal((await f.runtime.cancel(ready, agentDeadline(0))).ok, false); assert.ok(performance.now() - started < 200);
});
test('the real provider OS profile denies the private host key and Unix control endpoint before access', async t => {
  const { createBoundaryFixture, compileBoundaryProbe } = await import('../fixtures/discovery-boundary.js');
  const { createProviderProfile } = await import('../../src/platform/macos/discovery/provider-profile.js');
  const { mkdtemp, rm } = await import('node:fs/promises'), { join } = await import('node:path');
  const { createServer } = await import('node:net'), { execFile } = await import('node:child_process'), { promisify } = await import('node:util');
  const f = await createBoundaryFixture(); t.after(f.cleanup);
  const short = await mkdtemp('/private/tmp/maestro-host-'); t.after(() => rm(short, { recursive: true }));
  const endpoint = join(short, 'control.sock'), key = join(f.archive, 'host.key'); await writeFile(key, 'a'.repeat(64), { mode: 0o600 });
  const server = createServer(socket => socket.end()); await new Promise<void>(resolve => server.listen(endpoint, resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const probe = await compileBoundaryProbe(f.directory), profile = createProviderProfile({ executable: probe, runtime: f.runtime, authHome: f.authHome });
  const run = async (executable: string, args: string[]) => promisify(execFile)(executable, args, { cwd: f.runtime, env: {}, timeout: 5000 }).then(() => 0, (error: unknown) => { if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'number') throw error; return error.code; });
  for (const [mode, path] of [['read', key], ['connect', endpoint]]) {
    assert.equal(await run(probe, [mode!, path!]), 10, 'positive unsandboxed control');
    assert.equal(await run(profile.executable, [...profile.args, probe, mode!, path!]), 0, 'kernel refusal, not absence or malformed endpoint');
  }
});
test('owned cancellation and authenticated absence still work after the writer becomes unavailable', async t => {
  const f = await agentFixture(t), ready = value(await f.launch()); await f.authorize(ready); f.store.close();
  const proof = value(await f.runtime.cancel(ready, agentDeadline())); assert.equal(proof.hostExited, true); assert.equal(proof.providerExited, true);
  assert.equal((await f.runtime.stopWithin(agentDeadline())).ok, true);
  assert.equal(value(await f.runtime.observe(ready)).observation, 'ABSENT');
});
test('runtime drain rejects new launches and GO while preserving observation of the completed host', async t => {
  const f = await agentFixture(t), ready = value(await f.launch()); value(await f.runtime.stopWithin(agentDeadline()));
  assert.equal((await f.launch()).ok, false); assert.equal((await f.runtime.authorizeStart(ready)).ok, false);
  assert.equal(value(await f.runtime.observe(ready)).observation, 'ABSENT'); assert.equal(f.hosts.length, 1);
});
test('production host cannot use the unconstrained fixture launcher without the trusted constructor seam', async t => {
  const f = await agentFixture(t), { createAgentRuntime } = await loadRuntime(); const { providerModuleUrl: _fixture, ...options } = f.runtimeOptions;
  const runtime = createAgentRuntime(options), ready = value(await runtime.launch({ identity: f.identity, invocation: f.invocation, stdin: f.stdin, deadline: agentDeadline() }));
  value(f.store.commitDiscoveryMetadata({ kind: 'run', value: { ...value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId })).data!, phase: 'SPAWN_AUTHORIZED' }, expectedPhase: 'HOST_READY', exitVerified: false }));
  value(await runtime.authorizeStart(ready));
  await waitFor(() => f.hosts[0]!.exitCode !== null || f.hosts[0]!.signalCode !== null);
  const proof = value(await runtime.reconcile(ready)); assert.ok(proof); assert.equal(proof.outcome, 'FAILED'); assert.equal(proof.error, 'PROVIDER_UNSAFE'); await assert.rejects(access(f.marker));
});
