import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { EventRecord } from '../../src/ports/storage.js';
import type { EventPage } from '../../src/protocol/messages.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Sink {
  bufferedBytes: number; needsDrain: boolean; closed: boolean;
  write(bytes: Uint8Array): boolean; waitDrain(signal: AbortSignal): Promise<void>;
  end(bytes?: Uint8Array): void; onClose(callback: () => void): () => void;
}
interface Pump { start(): void; wake(): void; close(): void; done: Promise<{reason: string | null; deliveredFrames: number; peakBufferedBytes: number}> }
interface Module { createEventPump(options: {subscriptionId: string; correlationId: string; instanceId: string; storeId: string; after: string; sink: Sink; slowTimeoutMs?: number; readPage(after: string, maxBytes: number): Promise<EventPage>}): Pump }
const module = () => loadContract<Module>('protocol/event-pump.js', ['createEventPump']);
const storeId = randomUUID();
const records = (): EventRecord[] => [1, 2].map(seq => ({protocolVersion: 1, storeId, eventId: randomUUID(), seq: String(seq), occurredAt: new Date().toISOString(), instanceId: null, operationId: null, type: 'diagnostics.degraded', payload: {code: 'BUSY'}}));
const options = (sink: Sink, readPage: (after: string, maxBytes: number) => Promise<EventPage>) => ({subscriptionId: randomUUID(), correlationId: randomUUID(), instanceId: randomUUID(), storeId, after: '0', sink, readPage, slowTimeoutMs: 30});
const page = (events: EventRecord[]): EventPage => ({records: events, highWater: events.at(-1)?.seq ?? '0', firstAvailable: '1', truncated: false, nextAfter: events.at(-1)?.seq ?? '0'});

test('write=false waits for drain without fetching another page or duplicating already transferred bytes', async () => {
  const {createEventPump} = await module();
  let release!: () => void, reads = 0, writes = 0;
  const events = records();
  const sink: Sink = {bufferedBytes: 0, needsDrain: false, closed: false,
    write(bytes) { writes++; this.bufferedBytes += bytes.byteLength; this.needsDrain = writes === 1; return !this.needsDrain; },
    waitDrain(signal) { return new Promise<void>((resolve, reject) => { release = () => { this.bufferedBytes = 0; this.needsDrain = false; resolve(); }; signal.addEventListener('abort', () => reject(new Error('ABORTED')), {once: true}); }); },
    end() { this.closed = true; }, onClose: () => () => {},
  };
  const pump = createEventPump(options(sink, async after => { reads++; return {...page(events.filter(event => BigInt(event.seq) > BigInt(after))), highWater: '2'}; })); pump.start();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(writes, 1); assert.equal(reads, 1);
  pump.wake(); pump.wake();
  assert.equal(reads, 1);
  release(); await new Promise(resolve => setTimeout(resolve, 5));
  pump.close(); const stats = await pump.done;
  assert.ok(stats.peakBufferedBytes <= 1024 * 1024);
  assert.ok(writes >= 2);
});

test('a stalled consumer is closed on a bounded drain wait, even when a final frame cannot fit', async () => {
  const {createEventPump} = await module();
  let lastFrame: Uint8Array | undefined, reads = 0;
  const sink: Sink = {bufferedBytes: 1024 * 1024 - 4, needsDrain: false, closed: false,
    write() { throw new Error('SHOULD_NOT_WRITE'); }, waitDrain: () => new Promise(() => {}),
    end(frame) { this.closed = true; lastFrame = frame; }, onClose: () => () => {},
  };
  const pump = createEventPump(options(sink, async () => { reads++; return page(records()); })); pump.start();
  const result = await pump.done;
  assert.equal(result.reason, 'SLOW_CONSUMER'); assert.equal(lastFrame, undefined); assert.equal(sink.closed, true);
  assert.equal(reads, 0); assert.ok(result.peakBufferedBytes <= 1024 * 1024);
});

test('permanent write failure and absent drain release the pump; no further events are published', async () => {
  const {createEventPump} = await module();
  for (const mode of ['write-error', 'never-drain'] as const) {
    let writes = 0;
    const sink: Sink = {bufferedBytes: 0, needsDrain: false, closed: false,
      write(bytes) { writes++; if (mode === 'write-error') throw new Error('private driver detail'); this.bufferedBytes += bytes.byteLength; this.needsDrain = true; return false; },
      waitDrain: () => new Promise(() => {}), end() { this.closed = true; }, onClose: () => () => {},
    };
    const pump = createEventPump(options(sink, async () => page(records()))); pump.start();
    const result = await pump.done;
    assert.ok(result.reason === 'SLOW_CONSUMER' || result.reason === 'PERSISTENCE_UNAVAILABLE');
    const before = writes; pump.wake(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, before); assert.equal(sink.closed, true);
  }
});

test('status stays live while a diagnostic write waits for another core writer', async t => {
  const {createCliHarness} = await import('../fixtures/cli-harness.js');
  const {createPlatformPaths} = await import('../../src/platform/macos/paths.js');
  const {createLocalTransport} = await import('../../src/platform/macos/transport.js');
  const {default: Database} = await import('better-sqlite3');
  const h = await createCliHarness(t); assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const lock = new Database(paths.stateFile); lock.exec('BEGIN IMMEDIATE');
  const denied = createLocalTransport().call(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'internal.prepareStop', params: {}}, 2_000).catch(() => null);
  try {
    await new Promise(resolve => setTimeout(resolve, 100));
    const result = await h.call('status');
    assert.equal(result.code, 0, result.stdout);
    assert.equal(JSON.parse(result.stdout).freshness, 'LIVE', result.stdout);
    assert.equal(JSON.parse(result.stdout).data.ready, true, result.stdout);
  } finally { lock.exec('ROLLBACK'); lock.close(); await denied; }
});
