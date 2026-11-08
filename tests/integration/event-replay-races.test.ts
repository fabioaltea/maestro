import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readdir, lstat } from 'node:fs/promises';
import { openJournal } from '../../src/storage/event-journal.js';
import { createEventPump, type PumpOptions } from '../../src/protocol/event-pump.js';
import type { StreamSink } from '../../src/ports/platform.js';
import type { EventRecord } from '../../src/ports/storage.js';
import { createTestContext } from '../fixtures/test-context.js';

const storeId = randomUUID();
const event = (seq: number): EventRecord => ({protocolVersion: 1, storeId, eventId: randomUUID(), seq: String(seq), occurredAt: seq % 2 ? '2026-11-08T10:00:00Z' : '2025-01-01T00:00:00Z', instanceId: null, operationId: null, type: 'diagnostics.degraded', payload: {padding: 'x'.repeat(900)}});
function sink(write: (frame: Record<string, unknown>) => void) {
  return {bufferedBytes: 0, needsDrain: false, closed: false, write(bytes: Uint8Array) {write(JSON.parse(Buffer.from(bytes).toString())); return true;}, waitDrain: async () => {}, end(bytes?: Uint8Array) {if (bytes) write(JSON.parse(Buffer.from(bytes).toString())); this.closed = true;}, onClose: () => () => {}};
}
async function until(predicate: () => boolean) {const deadline = performance.now() + 2_000; while (!predicate()) {assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 5));}}

test('bounded replay hands off at captured highWater while appends race with page delivery', async t => {
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  const journal = openJournal({directory, storeId}); journal.append(Array.from({length: 8}, (_, i) => event(i + 1)));
  const delivered: string[] = [], caps: (string | undefined)[] = [];
  let pump: ReturnType<typeof createEventPump>;
  const output = sink(frame => {
    if (frame.kind !== 'event') return;
    const seq = (frame.event as EventRecord).seq; delivered.push(seq);
    if (seq === '1') {journal.append([event(9), event(10)]); pump.wake();}
  });
  const options = {subscriptionId: randomUUID(), correlationId: randomUUID(), instanceId: randomUUID(), storeId, after: '0', replayHighWater: '8', sink: output,
    readPage: async (after: string, _bytes: number, through?: string) => {caps.push(through); return journal.list({after, limit: 2, ...(through ? {highWater: through} : {})});},
  } as PumpOptions;
  pump = createEventPump(options); pump.start();
  try {await until(() => delivered.length === 10); assert.deepEqual(delivered, Array.from({length: 10}, (_, i) => String(i + 1))); assert.equal(caps[0], '8'); assert.ok(caps.includes(undefined));}
  finally {pump.close(); await pump.done;}
});

test('retention overtaking a paged replay emits a gap and does not pin old segments', async t => {
  const context = await createTestContext(t), directory = join(context.directory, 'events');
  const journal = openJournal({directory, storeId, segmentBytes: 4096, budgetBytes: 16384});
  journal.append([event(1), event(2), event(3)]);
  const frames: Record<string, unknown>[] = [];
  const output = sink(frame => {frames.push(frame); if (frame.kind === 'event' && (frame.event as EventRecord).seq === '1') for (let i = 4; i <= 30; i++) journal.append([event(i)]);});
  const pump = createEventPump({subscriptionId: randomUUID(), correlationId: randomUUID(), instanceId: randomUUID(), storeId, after: '0', sink: output,
    readPage: async after => journal.list({after, limit: 1}),
    eventState: async () => {const page = journal.list(); return {firstAvailable: page.firstAvailable, highWater: page.highWater};},
  } as PumpOptions);
  pump.start(); const result = await pump.done;
  assert.equal(result.reason, 'CURSOR_EXPIRED');
  const final = frames.at(-1)!;
  assert.equal(final.kind, 'subscription.closed'); assert.equal(final.nextAction, 'reread-status');
  assert.ok(BigInt(final.firstAvailable as string) > 2n); assert.equal(final.highWater, '30');
  let bytes = 0; for (const name of await readdir(directory)) bytes += (await lstat(join(directory, name))).blocks * 512;
  assert.ok(bytes <= 16384); assert.equal(frames.filter(f => f.kind === 'event').length, 1);
});

test('saved cursor resumes across disconnect and daemon restart with the same store identity', async t => {
  const {createCliHarness} = await import('../fixtures/cli-harness.js');
  const {createPlatformPaths} = await import('../../src/platform/macos/paths.js');
  const {createLocalTransport} = await import('../../src/platform/macos/transport.js');
  const {SQLiteStore} = await import('../../src/storage/sqlite-store.js');
  const h = await createCliHarness(t); assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const transport = createLocalTransport(), before = JSON.parse((await h.call('status')).stdout);
  const writer = new SQLiteStore({path: paths.stateFile}); let cursor: string;
  try {writer.drainEvents(); cursor = writer.getEventState().highWater;} finally {writer.close();}
  const first = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId: before.storeId, seq: cursor}}}, async () => {});
  const ended = first.done;
  assert.equal((await h.call('restart')).code, 0);
  assert.notEqual((await ended).reason, null);
  const after = JSON.parse((await h.call('status')).stdout); assert.equal(after.storeId, before.storeId); assert.notEqual(after.instanceId, before.instanceId);
  const records: EventRecord[] = [];
  const second = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId: before.storeId, seq: cursor}}}, async frame => {records.push(frame.event);});
  try {
    await until(() => records.at(-1)?.seq === second.highWater);
    assert.deepEqual(records.map(r => r.seq), Array.from({length: Number(BigInt(second.highWater) - BigInt(cursor))}, (_, i) => String(BigInt(cursor) + BigInt(i + 1))));
  } finally {await second.close(); await first.close();}
});
