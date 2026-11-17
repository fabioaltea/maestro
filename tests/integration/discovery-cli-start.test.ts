import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalClient } from '../../src/client/local-client.js';
import type { ClientBackend } from '../../src/ports/platform.js';
import type { PublicResult } from '../../src/protocol/messages.js';
import { foundationError } from '../../src/domain/errors.js';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { createDiscoveryReader } from '../../src/core/discovery/read.js';
import { DISCOVERY_READ_METHODS, DISCOVERY_ADMISSION_METHODS, publicDiscoveryOperation } from '../../src/protocol/discovery.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { LocalServer, RpcRequest, AuthenticatedPeer } from '../../src/ports/platform.js';
import type { DiscoveryIntent } from '../../src/domain/discovery/intent.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { value } from '../fixtures/discovery-artifacts.js';

const base: PublicResult = { protocolVersion: 1, storeId: randomUUID(), instanceId: randomUUID(), requestId: null,
  result: 'OK', outcome: null, freshness: 'LIVE', liveness: 'LIVE_VERIFIED', data: {}, error: null };
function client(discovery: NonNullable<ClientBackend['discovery']>) {
  const unexpected = async (): Promise<never> => { throw new Error('do not fallback to Foundation, registry or autostart'); };
  return new LocalClient({ defaultDirectory: '/owned/archive', discovery, project: unexpected, inspect: unexpected,
    operation: unexpected, control: unexpected, diagnostics: unexpected, events: unexpected, follow: unexpected });
}
test('Discovery client returns start admission immediately, sends the original UUID once and does not poll for an LLM', async () => {
  const requestId = randomUUID(), calls: string[] = [];
  const api = client(async (_directory, method, params) => { calls.push(method); assert.equal(params.requestId, requestId);
    return { ...base, requestId, data: { storeId: base.storeId, accepted: true, requestId } }; });
  const result = await api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId });
  assert.equal(result.requestId, requestId); assert.equal(result.data.accepted, true); assert.deepEqual(calls, ['discovery.start']);
});
test('lost admission response can only observe the original Discovery UUID and cannot repeat the mutation', async () => {
  const requestId = randomUUID(), calls: string[] = [];
  const api = client(async (_directory, method, params) => {
    calls.push(method); assert.equal(params.requestId, requestId);
    if (method === 'discovery.start') throw new Error('LOST_RESPONSE_AFTER_SEND');
    assert.equal(method, 'discovery.operation.get');
    return { ...base, requestId, result: 'BUSY', outcome: 'IN_PROGRESS', data: { operation: { requestId, action: 'start', phase: 'ACCEPTED', outcome: 'IN_PROGRESS',
      acceptedAt: new Date().toISOString(), completedAt: null, result: {}, error: null } } };
  });
  const result = await api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId });
  assert.equal(result.requestId, requestId); assert.equal(result.outcome, 'IN_PROGRESS'); assert.deepEqual(calls, ['discovery.start', 'discovery.operation.get']);
});
test('deadline and NOT_FOUND preserve UNKNOWN_OUTCOME, never authorize a fresh request or claim non-invio', async () => {
  const requestId = randomUUID(), calls: string[] = [];
  const api = client(async (_directory, method) => { calls.push(method);
    return { ...base, requestId, result: method === 'discovery.start' ? 'UNKNOWN_OUTCOME' : 'ERROR', error: foundationError(method === 'discovery.start' ? 'UNKNOWN_OUTCOME' : 'OPERATION_NOT_FOUND') }; });
  const result = await api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId });
  assert.equal(result.result, 'UNKNOWN_OUTCOME'); assert.equal(result.requestId, requestId); assert.equal(calls.filter(m => m === 'discovery.start').length, 1);
  const hanging = client(async () => new Promise(() => {}));
  const timed = await hanging.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId, timeoutMs: 20 });
  assert.equal(timed.result, 'UNKNOWN_OUTCOME'); assert.equal(timed.requestId, requestId);
});
test('closed Discovery mutation DTOs reject forged confirmations, unapproved argv and wrong identity receipts', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return { ...base, requestId: randomUUID(), data: { accepted: true, requestId: randomUUID() } }; });
  for (const extra of [{ approved: true }, { prompt: 'arbitrary' }, { argv: ['--danger-full-access'] }]) await assert.rejects(api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID(), ...extra }));
  assert.equal(calls, 0);
  const requestId = randomUUID(), result = await api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId });
  assert.notEqual(result.result, 'OK'); assert.equal(result.requestId, requestId);
});
test('a definite busy rejection is not polled and nested preview input is immutable after sending', async () => {
  const calls: string[] = [], requestId = randomUUID();
  const busy = client(async (_directory, method) => { calls.push(method); return { ...base, requestId, result: 'BUSY', error: foundationError('DISCOVERY_BUSY') }; });
  assert.equal((await busy.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId })).error?.code, 'DISCOVERY_BUSY');
  assert.deepEqual(calls, ['discovery.start']);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), selectors = ['README.md'];
  const immutable = client(async (_directory, _method, params) => { await gate; assert.deepEqual(params.selectors, ['README.md']); return { ...base, requestId, data: { accepted: true, requestId } }; });
  const pending = immutable.runDiscovery('discovery.preview', { projectId: randomUUID(), expectedConfigRevision: '1', selectors }, { requestId });
  selectors[0] = 'changed-after-call'; release(); assert.equal((await pending).data.accepted, true);
});
test('an uncertain start cannot be reported as completed by an operation from another Discovery action', async () => {
  const requestId = randomUUID(); let calls = 0;
  const api = client(async (_directory, method) => {
    calls++; if (method === 'discovery.start') throw new Error('LOST_RESPONSE');
    return { ...base, requestId, outcome: 'SUCCEEDED', data: { operation: { requestId, action: 'check', phase: 'FINALIZED', outcome: 'SUCCEEDED',
      acceptedAt: '2026-11-17T10:00:00.000Z', completedAt: '2026-11-17T10:00:01.000Z', result: { providerRevision: '1' }, error: null } } };
  });
  const result = await api.runDiscovery('discovery.start', { grantId: randomUUID(), projectId: randomUUID() }, { requestId });
  assert.equal(result.result, 'UNKNOWN_OUTCOME'); assert.equal(result.requestId, requestId); assert.equal(calls, 2);
});

/** Real CLI and authenticated local transport against a core-port fixture.
 * Daemon bootstrap/composition is qualified separately in T027. */
async function cliFixture(t: TestContext) {
  let server: LocalServer | undefined; t.after(async () => { await server?.close(); });
  const f = await launchFixture(t), calls: { method: string; params: Readonly<Record<string, unknown>> }[] = [];
  const key = await createPlatformPaths().createCredential(f.paths.clientKeyFile);
  const read = createDiscoveryReader({ storage: f.store as unknown as StoragePort, storeId: f.storeId, offline: false });
  server = await createLocalTransport().listen(f.paths.daemonEndpoint, f.instanceId, new Map([[key, 'client']]), async (r: RpcRequest, peer: AuthenticatedPeer) => {
    const response = { protocolVersion: 1 as const, correlationId: r.correlationId };
    if (r.method === 'status.get') return { ...response, result: 'OK', data: { storeId: f.storeId, instanceId: f.instanceId, lifecycle: 'RUNNING', freshness: 'LIVE',
      capabilities: { discoveryVersion: 1, discoveryMethods: [...DISCOVERY_READ_METHODS, ...DISCOVERY_ADMISSION_METHODS, 'discovery.prepare'] } } };
    calls.push({ method: r.method, params: r.params });
    if ((DISCOVERY_READ_METHODS as readonly string[]).includes(r.method)) {
      const data = await read(r.method, r.params), operation = data.operation as { outcome?: string } | undefined;
      return { ...response, result: operation?.outcome === 'BLOCKED' ? 'BLOCKED' : operation?.outcome === 'IN_PROGRESS' ? 'BUSY' : 'OK', data: { storeId: f.storeId, ...data } };
    }
    const p = r.params;
    const result = r.method === 'discovery.prepare' ? await f.service.prepare(peer, p.intent as DiscoveryIntent)
      : r.method === 'discovery.start' ? await f.service.startGranted(peer, p as unknown as Parameters<typeof f.service.startGranted>[1])
      : r.method === 'discovery.preview' ? await f.service.preview(peer, p as unknown as Parameters<typeof f.service.preview>[1])
      : r.method === 'discovery.preview.discard' ? await f.service.discard(peer, p as unknown as Parameters<typeof f.service.discard>[1])
      : r.method === 'discovery.provider.check' ? await f.service.check(peer, p as unknown as Parameters<typeof f.service.check>[1])
      : await f.service.configureGranted(peer, p as unknown as Parameters<typeof f.service.configureGranted>[1]);
    return result.ok ? { ...response, result: 'OK', data: { storeId: f.storeId, ...result.value } }
      : { ...response, result: 'BLOCKED', data: { storeId: f.storeId, code: result.code } };
  });
  const call = async (...args: string[]) => { const result = await invokeCli(['discovery', ...args, '--state-dir', f.directory, '--json']);
    assert.equal(result.stderr, ''); return { ...result, result: JSON.parse(result.stdout) as PublicResult }; };
  return { ...f, calls, call };
}
test('real CLI reads bounded scope/intent files, returns start admission and queries only its original Discovery namespace', async t => {
  const f = await cliFixture(t), scope = join(f.directory, 'scope.json'); await writeFile(scope, JSON.stringify(['tracked.txt']));
  const previewId = randomUUID(); const preview = await f.call('preview', f.projectId, '--expected-revision', '1', '--scope-file', scope, '--request-id', previewId);
  assert.equal(preview.code, 0); assert.equal(preview.result.requestId, previewId); assert.equal(preview.result.data.accepted, true); await f.service.idle();
  const snapshotId = (await f.service.get(f.peer, previewId))!.result!.snapshotId!;
  const shown = await f.call('preview', 'show', snapshotId, '--sources'); assert.equal(shown.code, 0);
  const intentFile = join(f.directory, 'intent.json'); await writeFile(intentFile, JSON.stringify(f.intent({ snapshotId, payload: { snapshotId } })));
  const prepared = await f.call('prepare', '--intent-file', intentFile); assert.equal(prepared.code, 0); assert.equal(f.counts().runs, 0);
  const requestId = randomUUID(), started = await f.call('start', f.projectId, '--grant', prepared.result.data.grantId as string, '--request-id', requestId);
  assert.equal(started.code, 0); assert.equal(started.result.data.accepted, true); assert.equal(started.result.requestId, requestId);
  await f.service.idle(); assert.equal(f.counts().runs, 1); assert.equal(f.launches.length, 1);
  const operation = await f.call('operation', requestId); assert.equal(operation.result.outcome, 'SUCCEEDED');
  assert.deepEqual(operation.result.data.operation, publicDiscoveryOperation((await f.service.get(f.peer, requestId))!));
  const retry = await f.call('start', f.projectId, '--grant', prepared.result.data.grantId as string, '--request-id', requestId); assert.equal(retry.code, 0); await f.service.idle(); assert.equal(f.launches.length, 1);
  assert.ok(f.calls.every(call => call.method.startsWith('discovery.')));
});
test('real CLI checks/configures explicitly, discards only unreferenced preview metadata and rejects unsafe file/flag inputs before sending', async t => {
  const f = await cliFixture(t), before = f.counts().checks;
  const checked = await f.call('provider', 'check', '--expected-provider-revision', '1'); assert.equal(checked.code, 0); await f.service.idle(); assert.equal(f.counts().checks, before + 1);
  const rejected = await f.call('provider', 'configure', '--binary', '/explicit/native', '--model', 'chosen-model', '--grant', randomUUID());
  assert.equal(rejected.result.error?.code, 'APPROVAL_REQUIRED'); assert.equal(f.counts().runs, 0);
  const discarded = await f.call('preview', 'discard', f.snapshot.snapshotId); assert.equal(discarded.code, 0); await f.service.idle();
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'snapshot', id: f.snapshot.snapshotId })).data, null);
  const sent = f.calls.length, oversized = join(f.directory, 'oversized.json'), fifo = join(f.directory, 'intent.fifo');
  await writeFile(oversized, 'x'.repeat(32769)); await promisify(execFile)('/usr/bin/mkfifo', [fifo]);
  for (const args of [['prepare', '--intent-file', oversized], ['prepare', '--intent-file', fifo],
    ['start', f.projectId, '--grant', randomUUID(), '--intent-file', oversized], ['start', f.projectId, '--grant', randomUUID(), '--prompt', 'not allowed']]) {
    const result = await f.call(...args); assert.notEqual(result.code, 0);
  }
  assert.equal(f.calls.length, sent); assert.equal(f.counts().runs, 0);
});
