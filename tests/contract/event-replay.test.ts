import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import type { StreamEventFrame } from '../../src/protocol/messages.js';

async function until(predicate: () => boolean) {
  const deadline = performance.now() + 3_000;
  while (!predicate()) { assert.ok(performance.now() < deadline, 'replay deadline'); await new Promise(resolve => setTimeout(resolve, 10)); }
}

test('replay rejects wrong-store, malformed and future cursors before delivering events', async t => {
  const h = await createCliHarness(t); assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!;
  const key = await adapter.readCredential(paths.clientKeyFile), transport = createLocalTransport();
  const status = JSON.parse((await h.call('status')).stdout), storeId = status.storeId as string;
  for (const [after, code] of [[{storeId: randomUUID(), seq: '0'}, 'WRONG_STORE'], [{storeId, seq: '9223372036854775807'}, 'INVALID_REQUEST'], [{storeId, seq: '-1'}, 'INVALID_REQUEST'], ['0', 'INVALID_REQUEST']] as const) {
    const response = await transport.call(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after}}, 1_000);
    assert.equal(response.result, 'ERROR'); assert.equal((response.data as {code: string}).code, code);
  }
});

test('replay uses stable seq/eventId across reconnects and then delivers live events', async t => {
  const h = await createCliHarness(t); assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!;
  const key = await adapter.readCredential(paths.clientKeyFile), transport = createLocalTransport();
  const store = new SQLiteStore({path: join(h.archive, 'state.sqlite')});
  let storeId: string, initial: string;
  try { store.drainEvents(); storeId = store.readSnapshot()!.store.storeId; initial = store.getEventState().highWater;
    store.recordEvents(Array.from({length: 12}, () => ({type: 'diagnostics.degraded' as const, payload: {code: 'BUSY'}})));
  } finally { store.close(); }
  const copies: StreamEventFrame[][] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const frames: StreamEventFrame[] = []; copies.push(frames);
    const subscription = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: initial}}}, async frame => { frames.push(frame); });
    try {
      await until(() => frames.length >= 12);
      assert.equal(frames[0]!.event.seq, String(BigInt(initial) + 1n));
      if (attempt === 1) {
        const writer = new SQLiteStore({path: paths.stateFile});
        try { writer.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]); } finally { writer.close(); }
        await until(() => frames.length >= 13);
      }
    } finally { await subscription.close(); }
    assert.equal((await subscription.done).lastReceived, frames.at(-1)!.event.seq);
  }
  assert.deepEqual(copies[0]!.map(f => [f.event.seq, f.event.eventId]), copies[1]!.slice(0, 12).map(f => [f.event.seq, f.event.eventId]));
});

test('expired cursor returns an explicit gap with retained bounds and reread-status action', async () => {
  const {createLiveEvents} = await import('../../src/core/live-events.js');
  const storeId = randomUUID(), instanceId = randomUUID();
  const store = {captureEventState: async () => ({highWater: '10', firstAvailable: '5'})} as unknown as import('../../src/ports/storage.js').StoragePort;
  const channel = {afterReply() { throw new Error('must not register an expired cursor'); }} as unknown as import('../../src/ports/platform.js').StreamChannel;
  const registry = createLiveEvents(store, instanceId);
  try {
    const result = await registry.dispatch({protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: '2'}}}, {role: 'client', channel, credentialId: '', identity: instanceId}, storeId);
    assert.equal(result.result, 'ERROR');
    assert.deepEqual(result.data, {code: 'CURSOR_EXPIRED', storeId, firstAvailable: '5', highWater: '10', nextAction: 'reread-status'});
  } finally { registry.closeAll(); }
});

test('CLI paginated --after yields a reusable cursor and follow emits the received cursor', async t => {
  const {encodeCursor, decodeCursor} = await import('../../src/protocol/event-cursor.js');
  const {createTestContext} = await import('../fixtures/test-context.js');
  const {fileURLToPath} = await import('node:url');
  const h = await createCliHarness(t), context = await createTestContext(t);
  assert.equal((await h.call('start')).code, 0);
  const store = new SQLiteStore({path: join(h.archive, 'state.sqlite')});
  let after: string, expected: string;
  try {store.drainEvents(); const storeId = store.readSnapshot()!.store.storeId; after = encodeCursor({storeId, seq: store.getEventState().highWater}); store.recordEvents([{type: 'diagnostics.degraded', payload: {code: 'BUSY'}}, {type: 'diagnostics.degraded', payload: {code: 'BUSY'}}]); expected = store.getEventState().highWater;} finally {store.close();}
  const first = JSON.parse((await h.call('events', '--after', after, '--limit', '1')).stdout);
  assert.equal(first.result, 'OK'); assert.equal(first.data.events.records.length, 1); assert.equal(first.data.events.truncated, true);
  assert.equal(decodeCursor(first.data.events.cursor).seq, first.data.events.records[0].seq);
  const next = JSON.parse((await h.call('events', '--after', first.data.events.cursor)).stdout);
  assert.equal(next.data.events.records.length, 1); assert.equal(next.data.events.records[0].seq, expected);
  const child = context.spawnNode([fileURLToPath(new URL('../fixtures/cli-stream.js', import.meta.url)), h.archive, first.data.events.cursor], {stdio: ['ignore', 'pipe', 'pipe', 'ipc']});
  let output = ''; child.stdout!.on('data', chunk => {output += String(chunk);});
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  try {await until(() => output.includes('"kind":"event"')); const frame = output.trim().split('\n').map(line => JSON.parse(line)).find(f => f.kind === 'event'); assert.equal(decodeCursor(frame.cursor).seq, expected);}
  finally {child.send({type: 'maestro-test-shutdown'}); assert.equal(await exit, 0);}
  const wrong = await h.call('events', '--after', encodeCursor({storeId: randomUUID(), seq: '0'}));
  assert.equal(wrong.code, 2); assert.equal(JSON.parse(wrong.stdout).error.code, 'WRONG_STORE');
  for (const args of [['events', '--after', 'broken'], ['status', '--after', after]]) {
    const result = await h.call(args[0]!, ...args.slice(1)); assert.equal(result.code, 2);
  }
});

test('transport and CLI preserve gap bounds both before subscription and during replay', async t => {
  const {encodeCursor} = await import('../../src/protocol/event-cursor.js');
  const h = await createCliHarness(t), adapter = createPlatformPaths();
  const paths = (await adapter.resolveArchive(h.archive, 'write'))!, key = await adapter.createCredential(paths.clientKeyFile);
  const transport = createLocalTransport(), storeId = randomUUID(), instanceId = randomUUID();
  const gap = {storeId, firstAvailable: '5', highWater: '10', nextAction: 'reread-status'};
  let phase = 'before';
  const server = await transport.listen(paths.daemonEndpoint, instanceId, new Map([[key, 'client']]), async (request, peer) => {
    if (phase === 'before') return {protocolVersion: 1, correlationId: request.correlationId, result: 'ERROR', data: {code: 'CURSOR_EXPIRED', ...gap}};
    const subscriptionId = randomUUID();
    peer.channel!.afterReply(() => peer.channel!.end(Buffer.from(JSON.stringify({protocolVersion: 1, kind: 'subscription.closed', correlationId: request.correlationId, subscriptionId, ...gap, error: {code: 'CURSOR_EXPIRED'}}) + '\n')));
    return {protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: {subscriptionId, storeId, instanceId, highWater: '10'}};
  });
  try {
    for (phase of ['before', 'during']) {
      const request = {protocolVersion: 1 as const, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: '2'}}};
      if (phase === 'before') await assert.rejects(transport.subscribe(paths.daemonEndpoint, key, request, async () => assert.fail('gap must not deliver events')), error => {assert.deepEqual((error as {gap?: unknown}).gap, gap); return (error as Error).message === 'CURSOR_EXPIRED';});
      else {const subscription = await transport.subscribe(paths.daemonEndpoint, key, request, async () => assert.fail()); const result = await subscription.done; assert.equal(result.reason, 'CURSOR_EXPIRED'); assert.deepEqual(result.gap, gap); assert.equal(result.lastReceived, null);}
      const cli = await h.call('events', '--follow', '--after', encodeCursor({storeId, seq: '2'}));
      assert.equal(cli.code, 2, cli.stdout);
      const result = cli.stdout.trim().split('\n').map(line => JSON.parse(line)).at(-1);
      assert.equal(result.error.code, 'CURSOR_EXPIRED');
      assert.deepEqual(phase === 'before' ? result.data : {storeId: result.storeId, firstAvailable: result.firstAvailable, highWater: result.highWater, nextAction: result.nextAction}, gap);
    }
  } finally {await server.close();}
});

test('gap reporting never substitutes unverified bounds for a persistence failure', async () => {
  const {readEventPage} = await import('../../src/core/diagnostics.js');
  const store = {listEvents: async () => {throw new Error('CURSOR_EXPIRED');}, getEventState: async () => ({firstAvailable: '1', highWater: '10', errorCode: 'STATE_CORRUPT'})} as unknown as import('../../src/ports/storage.js').StoragePort;
  await assert.rejects(readEventPage(store, randomUUID(), {}), /STATE_CORRUPT/);
});
