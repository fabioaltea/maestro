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
  const store = {getEventState: async () => ({highWater: '10', firstAvailable: '5'})} as unknown as import('../../src/ports/storage.js').StoragePort;
  const channel = {afterReply() { throw new Error('must not register an expired cursor'); }} as unknown as import('../../src/ports/platform.js').StreamChannel;
  const registry = createLiveEvents(store, instanceId);
  try {
    const result = await registry.dispatch({protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: '2'}}}, {role: 'client', channel, credentialId: '', identity: instanceId}, storeId);
    assert.equal(result.result, 'ERROR');
    assert.deepEqual(result.data, {code: 'CURSOR_EXPIRED', storeId, firstAvailable: '5', highWater: '10', nextAction: 'reread-status'});
  } finally { registry.closeAll(); }
});
