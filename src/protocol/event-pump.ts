import { requireDecimal, requireUuid } from '../domain/identifiers.js';
import { foundationError } from '../domain/errors.js';
import type { StreamSink } from '../ports/platform.js';
import { MAX_CLIENT_BUFFER_BYTES, MAX_EVENT_BYTES, MAX_EVENT_PAGE_BYTES, MAX_FRAME_BYTES, type EventPage } from './messages.js';
import { encodeFrame } from './validation.js';

export interface PumpOptions {
  readonly subscriptionId: string; readonly correlationId: string; readonly instanceId: string;
  readonly storeId: string; readonly after: string; readonly sink: StreamSink;
  readonly readPage: (after: string, maxBytes: number) => Promise<EventPage>;
  readonly slowTimeoutMs?: number;
}
export interface EventPumpStats {subscriptionId: string; cursor: string; closed: boolean; reason: string | null; deliveredFrames: number; bufferedBytes: number; peakBufferedBytes: number; waitingDrain: boolean}
export function createEventPump(options: PumpOptions) {
  for (const id of [options.subscriptionId, options.correlationId, options.instanceId, options.storeId]) requireUuid(id);
  requireDecimal(options.after);
  const {sink} = options, abort = new AbortController();
  const timeout = options.slowTimeoutMs ?? 1_000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30_000) throw new Error('INVALID_REQUEST');
  let started = false, closed = false, notified = true, reason: string | null = null;
  let cursor = options.after, appBytes = 0, peakBufferedBytes = 0, deliveredFrames = 0, waitingDrain = false;
  let wake: (() => void) | null = null;
  let complete!: (stats: EventPumpStats) => void;
  const done = new Promise<EventPumpStats>(resolve => { complete = resolve; });
  let unsubscribe = () => {};
  function stats(): EventPumpStats { return {subscriptionId: options.subscriptionId, cursor, closed, reason, deliveredFrames,
    bufferedBytes: appBytes + sink.bufferedBytes, peakBufferedBytes, waitingDrain}; }
  function account(extra = 0) {
    const bytes = appBytes + sink.bufferedBytes + extra;
    if (bytes > MAX_CLIENT_BUFFER_BYTES) throw new Error('SLOW_CONSUMER');
    peakBufferedBytes = Math.max(peakBufferedBytes, bytes);
  }
  function close(code?: string) {
    if (closed) return;
    closed = true; reason = code ?? null; abort.abort(); wake?.(); unsubscribe();
    if (code && !sink.closed) {
      const frame = encodeFrame({protocolVersion: 1, kind: 'subscription.closed', subscriptionId: options.subscriptionId,
        correlationId: options.correlationId, lastSent: cursor, error: foundationError(code as Parameters<typeof foundationError>[0])});
      try {
        if (appBytes + sink.bufferedBytes + frame.byteLength <= MAX_CLIENT_BUFFER_BYTES) { account(frame.byteLength); sink.end(frame); }
        else sink.end();
      } catch { sink.end(); }
    }
    appBytes = 0;
    if (!started) complete(stats());
  }
  async function drain() {
    if (!sink.needsDrain) return;
    waitingDrain = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([sink.waitDrain(abort.signal), new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('SLOW_CONSUMER')), timeout);
      })]);
    } finally { clearTimeout(timer); waitingDrain = false; }
  }
  async function run() {
    try {
      while (!closed) {
        if (!notified) await new Promise<void>(resolve => { wake = resolve; });
        wake = null; if (closed) break;
        notified = false; await drain(); if (closed || sink.closed) break;
        const maxBytes = Math.min(MAX_EVENT_PAGE_BYTES, MAX_CLIENT_BUFFER_BYTES - sink.bufferedBytes - MAX_FRAME_BYTES);
        if (maxBytes < MAX_EVENT_BYTES) throw new Error('SLOW_CONSUMER');
        let page: EventPage | null = await options.readPage(cursor, maxBytes);
        if (closed) break;
        if (BigInt(requireDecimal(page.highWater)) < BigInt(cursor)) throw new Error('STATE_CORRUPT');
        const highWater = page.highWater, more = page.truncated;
        const records = [...page.records]; appBytes = Buffer.byteLength(JSON.stringify(records));
        page = null;
        if (appBytes > maxBytes) throw new Error('STATE_CORRUPT');
        account();
        while (records.length && !closed) {
          await drain(); if (closed) break;
          const record = records[0]!;
          if (record.protocolVersion !== 1 || record.storeId !== options.storeId || BigInt(requireDecimal(record.seq)) <= BigInt(cursor)
            || BigInt(record.seq) > BigInt(highWater) || Buffer.byteLength(JSON.stringify(record)) + 36 > MAX_EVENT_BYTES) throw new Error('STATE_CORRUPT');
          requireUuid(record.eventId);
          let encoded: Buffer | null = encodeFrame({protocolVersion: 1, kind: 'event', correlationId: options.correlationId,
            subscriptionId: options.subscriptionId, instanceId: options.instanceId, event: record});
          account(encoded.byteLength);
          const accepted = sink.write(encoded); encoded = null;
          records.shift(); appBytes = Buffer.byteLength(JSON.stringify(records));
          cursor = record.seq; deliveredFrames++; account();
          if (!accepted) await drain();
        }
        appBytes = 0;
        if (more) notified = true;
      }
    } catch (error) {
      if (!closed) {
        let code: Parameters<typeof foundationError>[0] = 'PERSISTENCE_UNAVAILABLE';
        try { code = foundationError(error instanceof Error ? error.message as typeof code : code).code; } catch { /* Redact transport/storage details. */ }
        close(code);
      }
    } finally { if (!closed) close(); appBytes = 0; complete(stats()); }
  }
  unsubscribe = sink.onClose(() => close());
  return {done, stats, close, wake() { if (!closed) { notified = true; wake?.(); } },
    start() { if (!started && !closed) { started = true; void run(); } }};
}
