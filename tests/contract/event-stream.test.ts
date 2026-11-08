import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { openStorage } from '../../src/storage/worker.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import type { EventRecord } from '../../src/ports/storage.js';
import type { RpcRequest, RpcResponse } from '../../src/ports/platform.js';
interface Frame {protocolVersion: 1; kind: 'event'; correlationId: string; subscriptionId: string; instanceId: string; event: EventRecord}
interface Subscription {response: RpcResponse; subscriptionId: string; storeId: string; instanceId: string; highWater: string; close(): Promise<void>; done: Promise<{reason: string | null; lastReceived: string | null}>}
interface Streaming {subscribe(endpoint: string, key: string, request: RpcRequest, consume: (frame: Frame) => Promise<void>, options?: {timeoutMs?: number}): Promise<Subscription>}
export async function streamTransport(): Promise<ReturnType<typeof createLocalTransport> & Streaming> {
  const transport = createLocalTransport() as ReturnType<typeof createLocalTransport> & Streaming;
  assert.equal(typeof transport.subscribe, 'function', 'stream transport is not implemented'); return transport;
}
async function until(predicate: () => boolean) { const limit = performance.now() + 3_000; while (!predicate()) { assert.ok(performance.now() < limit); await new Promise(resolve => setTimeout(resolve, 10)); } }

test('subscribe authenticates, preserves identity/correlation, and close is scoped to its connection', async t => {
  const transport = await streamTransport(), h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const startupStore = await openStorage({path: join(h.archive, 'state.sqlite')});
  try { await startupStore.drainEvents(); } finally { await startupStore.close(); }
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const correlationId = randomUUID(), frames: Frame[] = [];
  const request: RpcRequest = {protocolVersion: 1, correlationId, method: 'events.subscribe', params: {}};
  await assert.rejects(transport.subscribe(paths.daemonEndpoint, 'b'.repeat(64), request, async () => {}), /UNAUTHORIZED/);
  const subscription = await transport.subscribe(paths.daemonEndpoint, key, request, async frame => { frames.push(frame); });
  try {
    assert.equal(subscription.response.correlationId, correlationId);
    assert.equal(subscription.instanceId, JSON.parse((await h.call('status')).stdout).instanceId);
    const store = new SQLiteStore({path: paths.stateFile});
    try { store.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]); } finally { store.close(); }
    await until(() => frames.length > 0);
    assert.equal(frames[0]?.correlationId, correlationId);
    assert.equal(frames[0]?.subscriptionId, subscription.subscriptionId);
    assert.equal(frames[0]?.instanceId, subscription.instanceId);
    assert.equal(frames[0]?.event.storeId, subscription.storeId);
    assert.ok(BigInt(frames[0]!.event.seq) > BigInt(subscription.highWater));
    const stolen = await transport.call(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'subscription.close', params: {subscriptionId: subscription.subscriptionId}}, 1_000);
    assert.equal(stolen.result, 'ERROR'); assert.equal((stolen.data as {code: string}).code, 'UNAUTHORIZED');
  } finally { await subscription.close(); }
  assert.equal((await subscription.done).reason, null);
  assert.equal(JSON.parse((await h.call('status')).stdout).data.ready, true);
  const unsupported = await transport.call(paths.daemonEndpoint, key, {...request, params: {after: '0'}}, 1_000);
  assert.equal(unsupported.result, 'ERROR');
});

test('live delivery never publishes a physical append that has not completed durable outbox drain', async t => {
  const transport = await streamTransport(), sandbox = await createProcessSandbox(t), h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const startupStore = await openStorage({path: join(h.archive, 'state.sqlite')});
  try { await startupStore.drainEvents(); } finally { await startupStore.close(); }
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const frames: Frame[] = [];
  const subscription = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {}}, async frame => { frames.push(frame); });
  try {
    const file = join(h.directory, 'stream-crash.json'); await writeFile(file, JSON.stringify({path: paths.stateFile}), {mode: 0o600});
    const actor = sandbox.spawnFixture('stream-event-writer.js', [file]);
    assert.equal(await new Promise<number | null>(resolve => actor.once('exit', resolve)), 86);
    await new Promise(resolve => setTimeout(resolve, 150)); assert.equal(frames.length, 0);
    const store = new SQLiteStore({path: paths.stateFile});
    try { assert.ok(store.getEventState().pendingBytes > 0); store.drainEvents(); }
    finally { store.close(); }
    await until(() => frames.length === 1);
    assert.equal(frames[0]?.event.seq, String(BigInt(subscription.highWater) + 1n));
  } finally { await subscription.close(); }
});

test('CLI --follow emits frames, handles its own SIGINT and leaves daemon identity unchanged', async t => {
  const {createTestContext} = await import('../fixtures/test-context.js');
  const {fileURLToPath} = await import('node:url');
  const context = await createTestContext(t), h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  const startupStore = await openStorage({path: join(h.archive, 'state.sqlite')});
  try { await startupStore.drainEvents(); } finally { await startupStore.close(); }
  const before = JSON.parse((await h.call('status')).stdout);
  const child = context.spawnNode([fileURLToPath(new URL('../fixtures/cli-stream.js', import.meta.url)), h.archive], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let stdout = '', stderr = '';
  child.stdout!.on('data', chunk => { stdout += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {
    await until(() => stdout.includes('subscription.started'));
    const store = new SQLiteStore({path: join(h.archive, 'state.sqlite')});
    try { store.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]); } finally { store.close(); }
    await until(() => stdout.includes('"kind":"event"'));
    child.send({type: 'maestro-test-shutdown'});
    assert.equal(await exit, 0, stderr);
    for (const line of stdout.trim().split('\n')) assert.equal(JSON.parse(line).protocolVersion, 1);
    const after = JSON.parse((await h.call('status')).stdout);
    assert.equal(after.instanceId, before.instanceId); assert.equal(after.data.ready, true);
  } finally { if (child.exitCode === null && child.connected) child.send({type: 'maestro-test-shutdown'}); }
});
