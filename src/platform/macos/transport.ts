import { requireUuid, requireDecimal } from '../../domain/identifiers.js';
import { createServer, connect, type Socket } from 'node:net';
import { chmod, lstat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHash, createHmac, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LocalTransport, LocalRole, RpcResponse, StreamChannel, EventSubscription } from '../../ports/platform.js';
import { HANDSHAKE_TIMEOUT_MS, MAX_CLIENT_BUFFER_BYTES, MAX_FRAME_BYTES, MAX_EVENT_BYTES, EVENT_TYPES, type StreamEventFrame } from '../../protocol/messages.js';
import { decodeObject, decodeRequest, encodeFrame } from '../../protocol/validation.js';

const hex = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const equal = (a: string, b: string) => hex(a) && hex(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
function proof(key: string, identity: string, role: string, clientNonce: string, serverNonce: string): string {
  const transcript = JSON.stringify({ protocolVersion: 1, identity, role, clientNonce, serverNonce });
  return createHmac('sha256', Buffer.from(key, 'hex')).update(transcript).digest('hex');
}
async function privateEndpoint(endpoint: string, existing: boolean): Promise<void> {
  if (!isAbsolute(endpoint) || Buffer.byteLength(endpoint) >= 104 || !process.getuid) throw new Error('UNAUTHORIZED');
  const parent = await lstat(dirname(endpoint));
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid()
    || (parent.mode & 0o777) !== 0o700) throw new Error('UNAUTHORIZED');
  if (existing) {
    const info = await lstat(endpoint);
    if (!info.isSocket() || info.isSymbolicLink() || info.uid !== process.getuid()
      || (info.mode & 0o777) !== 0o600) throw new Error('UNAUTHORIZED');
  }
}

function frameReader(socket: Socket, consume: (frame: Buffer) => void, fail: () => void, account: (bytes: number) => void = () => {}): void {
  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    if (socket.destroyed) return;
    buffered = Buffer.concat([buffered, chunk]); account(buffered.byteLength);
    let newline: number;
    while ((newline = buffered.indexOf(10)) !== -1) {
      if (newline > MAX_FRAME_BYTES) { fail(); return; }
      const frame = buffered.subarray(0, newline);
      buffered = Buffer.from(buffered.subarray(newline + 1)); account(buffered.byteLength);
      consume(frame);
      if (socket.destroyed) return;
    }
    if (buffered.byteLength > MAX_FRAME_BYTES) fail();
  });
}

export function createLocalTransport(): LocalTransport {
  return {
    subscribe: subscribeLocal,
    async listen(endpoint, identity, keys, dispatch) {
      await privateEndpoint(endpoint, false);
      try { await lstat(endpoint); throw new Error('ENDPOINT_COLLISION'); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      const sockets = new Set<Socket>();
      const server = createServer(socket => {
        sockets.add(socket);
        let authenticated = false;
        let authenticating = false;
        let failed = false;
        let role: LocalRole = 'client';
        let credentialId = '';
        let queued = 0, queuedBytes = 0, incomingBytes = 0;
        let queue = Promise.resolve();
        const afterReply: (() => void)[] = [];
        const closeListeners = new Set<() => void>();
        const timer = setTimeout(() => fail('UNAUTHORIZED'), HANDSHAKE_TIMEOUT_MS);
        function fail(code: string) {
          if (failed || socket.destroyed) return;
          failed = true;
          clearTimeout(timer);
          channel.end(encodeFrame({ protocolVersion: 1, kind: 'error', code }));
        }
        const channel: StreamChannel = {
          get bufferedBytes() { return socket.writableLength + queuedBytes + incomingBytes; },
          get needsDrain() { return socket.writableNeedDrain; },
          get closed() { return socket.destroyed || !socket.writable; },
          write(bytes) {
            if (failed || socket.destroyed) throw new Error('PERSISTENCE_UNAVAILABLE');
            if (socket.writableNeedDrain || channel.bufferedBytes + bytes.byteLength > MAX_CLIENT_BUFFER_BYTES) throw new Error('SLOW_CONSUMER');
            return socket.write(bytes);
          },
          waitDrain(signal) {
            if (!socket.writableNeedDrain) return Promise.resolve();
            return new Promise<void>((resolve, reject) => {
              const dispose = () => { socket.off('drain', drained); socket.off('close', gone); socket.off('error', gone); signal.removeEventListener('abort', gone); };
              const drained = () => { dispose(); resolve(); };
              const gone = () => { dispose(); reject(new Error('DEADLINE_EXCEEDED')); };
              socket.once('drain', drained); socket.once('close', gone); socket.once('error', gone); signal.addEventListener('abort', gone, {once: true});
              if (signal.aborted || socket.destroyed) gone();
            });
          },
          end(bytes) {
            if (socket.destroyed) return;
            if (bytes && (socket.writableNeedDrain || channel.bufferedBytes + bytes.byteLength > MAX_CLIENT_BUFFER_BYTES)) bytes = undefined;
            if (bytes) socket.end(bytes); else socket.end();
            const destroy = setTimeout(() => socket.destroy(), 100); destroy.unref();
            socket.once('close', () => clearTimeout(destroy));
          },
          onClose(callback) { closeListeners.add(callback); if (socket.destroyed) queueMicrotask(callback); return () => closeListeners.delete(callback); },
          afterReply(callback) { if (afterReply.length) throw new Error('INVALID_REQUEST'); afterReply.push(callback); },
        };
        socket.on('error', () => socket.destroy());
        socket.once('close', () => { failed = true; clearTimeout(timer); sockets.delete(socket); for (const callback of closeListeners) callback(); closeListeners.clear(); });
        frameReader(socket, frame => {
          if (failed) return;
          if (!authenticated) {
            if (authenticating) { fail('UNAUTHORIZED'); return; }
            authenticating = true;
            void (async () => {
              const hello = decodeObject(frame);
              if (hello.protocolVersion !== 1 || hello.kind !== 'hello' || !hex(hello.token) || !hex(hello.clientNonce)) {
                fail('UNAUTHORIZED'); return;
              }
              const token = hello.token;
              const available = typeof keys === 'function' ? await keys() : keys;
              if (failed || socket.destroyed) return;
              const entry = [...available].find(([candidate]) => equal(candidate, token));
              if (!entry) { fail('UNAUTHORIZED'); return; }
              role = entry[1];
              credentialId = createHash('sha256').update(token).digest('hex');
              const serverNonce = randomBytes(32).toString('hex');
              socket.write(encodeFrame({ protocolVersion: 1, kind: 'welcome', identity, role,
                clientNonce: hello.clientNonce, serverNonce, proof: proof(token, identity, role, hello.clientNonce, serverNonce) }));
              authenticated = true;
              clearTimeout(timer);
            })().catch(() => fail('UNAUTHORIZED')).finally(() => { authenticating = false; });
            return;
          }
          if (++queued > 8) { fail('INVALID_REQUEST'); return; }
          let request;
          try { request = decodeRequest(frame); }
          catch (error) { fail(error instanceof Error && error.message === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'INVALID_REQUEST'); return; }
          const parsed = request, requestBytes = frame.byteLength; queuedBytes += requestBytes;
          queue = queue.then(async () => {
            if (failed || socket.destroyed) { queued--; queuedBytes -= requestBytes; return; }
            try {
              const result = await dispatch(parsed, { role, identity, credentialId, channel });
              const encoded = encodeFrame(result);
              if (channel.bufferedBytes + encoded.byteLength > MAX_CLIENT_BUFFER_BYTES) { fail('SLOW_CONSUMER'); return; }
              if (channel.needsDrain) await channel.waitDrain(AbortSignal.timeout(1_000));
              if (socket.destroyed || failed) return;
              channel.write(encoded);
              for (const callback of afterReply.splice(0)) callback();
            } catch { fail('INTERNAL_ERROR'); }
            finally { queued--; queuedBytes -= requestBytes; }
          });
        }, () => fail('INVALID_REQUEST'), bytes => { incomingBytes = bytes; if (channel.bufferedBytes > MAX_CLIENT_BUFFER_BYTES) fail('SLOW_CONSUMER'); });
      });
      server.maxConnections = 64;
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(endpoint, () => { server.off('error', reject); resolve(); });
        });
      } catch { throw new Error('ENDPOINT_COLLISION'); }
      server.on('error', () => { for (const socket of sockets) socket.destroy(); });
      try { await chmod(endpoint, 0o600); }
      catch {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
        throw new Error('UNAUTHORIZED');
      }
      return {
        async close() {
          for (const socket of sockets) socket.destroy();
          if (!server.listening) return;
          await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        },
      };
    },
    async call(endpoint, key, request, timeoutMs) {
      if (!hex(key) || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('INVALID_REQUEST');
      await privateEndpoint(endpoint, true);
      decodeRequest(encodeFrame(request));
      return new Promise<RpcResponse>((resolve, reject) => {
        const socket = connect(endpoint);
        const nonce = randomBytes(32).toString('hex');
        let welcomed = false;
        let complete = false;
        const finish = (error: Error | null, response?: RpcResponse) => {
          if (complete) return;
          complete = true;
          clearTimeout(timer);
          socket.destroy();
          if (error) reject(error);
          else resolve(response!);
        };
        const timer = setTimeout(() => finish(new Error('DEADLINE_EXCEEDED')), timeoutMs);
        socket.once('connect', () => socket.write(encodeFrame({ protocolVersion: 1, kind: 'hello', token: key, clientNonce: nonce })));
        socket.once('error', () => finish(new Error('PERSISTENCE_UNAVAILABLE')));
        socket.once('close', () => { if (!complete) finish(new Error('UNKNOWN_OUTCOME')); });
        frameReader(socket, frame => {
          try {
            const object = decodeObject(frame);
            if (object.kind === 'error') {
              const codes = ['UNAUTHORIZED', 'UNSUPPORTED_VERSION', 'INVALID_REQUEST', 'SLOW_CONSUMER', 'INTERNAL_ERROR'];
              finish(new Error(typeof object.code === 'string' && codes.includes(object.code) ? object.code : 'INVALID_REQUEST'));
              return;
            }
            if (!welcomed) {
              if (object.kind !== 'welcome' || object.protocolVersion !== 1 || object.clientNonce !== nonce
                || typeof object.identity !== 'string' || object.identity.length > 128 || typeof object.role !== 'string'
                || !hex(object.serverNonce) || !hex(object.proof)
                || !equal(object.proof, proof(key, object.identity, object.role, nonce, object.serverNonce))) {
                finish(new Error('UNAUTHORIZED')); return;
              }
              welcomed = true;
              socket.write(encodeFrame(request));
              return;
            }
            if (object.protocolVersion !== 1 || object.correlationId !== request.correlationId
              || !['OK', 'BUSY', 'BLOCKED', 'ERROR', 'UNKNOWN_OUTCOME'].includes(String(object.result))) {
              finish(new Error('INVALID_REQUEST')); return;
            }
            finish(null, object as unknown as RpcResponse);
          } catch { finish(new Error('INVALID_REQUEST')); }
        }, () => finish(new Error('INVALID_REQUEST')));
      });
    },
  };
}

async function subscribeLocal(endpoint: string, key: string, request: import('../../ports/platform.js').RpcRequest,
  consume: (frame: StreamEventFrame) => Promise<void>, options: {timeoutMs?: number; signal?: AbortSignal} = {}): Promise<EventSubscription> {
  if (!hex(key) || request.method !== 'events.subscribe') throw new Error('INVALID_REQUEST');
  decodeRequest(encodeFrame(request)); await privateEndpoint(endpoint, true);
  const timeout = options.timeoutMs ?? 1_000;
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2_000) throw new Error('INVALID_REQUEST');
  const socket = connect(endpoint), nonce = randomBytes(32).toString('hex');
  let welcomed = false, ended = false, closing = false, reading = false;
  let identity = '', subscriptionId = '', storeId = '', highWater = '0', startAfter = '0', lastReceived: string | null = null;
  let buffer = Buffer.alloc(0), response: RpcResponse | null = null;
  const closeId = randomUUID();
  let resolveReady!: (subscription: EventSubscription) => void, rejectReady!: (error: Error) => void;
  let complete!: (result: {reason: string | null; lastReceived: string | null}) => void;
  const ready = new Promise<EventSubscription>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise<{reason: string | null; lastReceived: string | null}>(resolve => { complete = resolve; });
  const timer = setTimeout(() => finish('DEADLINE_EXCEEDED'), timeout);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  function finish(reason: string | null) {
    if (ended) return; ended = true; clearTimeout(timer); clearTimeout(closeTimer);
    options.signal?.removeEventListener('abort', interrupted); socket.destroy(); buffer = Buffer.alloc(0);
    if (!response) rejectReady(new Error(reason ?? 'CONTROL_INTERRUPTED'));
    complete({reason, lastReceived});
  }
  async function close() {
    if (ended) return;
    if (!closing) {
      closing = true;
      if (response) socket.write(encodeFrame({protocolVersion: 1, correlationId: closeId, method: 'subscription.close', params: {subscriptionId}}));
      else { finish(null); return; }
      closeTimer = setTimeout(() => finish(null), 250);
    }
    await done;
  }
  const interrupted = () => { void close(); };
  options.signal?.addEventListener('abort', interrupted, {once: true});
  socket.once('connect', () => socket.write(encodeFrame({protocolVersion: 1, kind: 'hello', token: key, clientNonce: nonce})));
  socket.once('error', () => finish(closing ? null : 'SERVICE_UNREACHABLE'));
  socket.once('close', () => finish(closing ? null : 'CONTROL_INTERRUPTED'));
  async function frame(bytes: Buffer) {
    const object = decodeObject(bytes);
    if (object.protocolVersion !== 1) throw new Error('UNSUPPORTED_VERSION');
    if (object.kind === 'error') {
      const allowed = ['UNAUTHORIZED', 'UNSUPPORTED_VERSION', 'INVALID_REQUEST', 'SLOW_CONSUMER', 'INTERNAL_ERROR'];
      finish(typeof object.code === 'string' && allowed.includes(object.code) ? object.code : 'INVALID_REQUEST'); return;
    }
    if (!welcomed) {
      if (object.kind !== 'welcome' || object.clientNonce !== nonce || typeof object.identity !== 'string' || object.role !== 'client' && object.role !== 'controller'
        || !hex(object.serverNonce) || !hex(object.proof) || !equal(object.proof, proof(key, object.identity, object.role, nonce, object.serverNonce))) throw new Error('UNAUTHORIZED');
      identity = requireUuid(object.identity); welcomed = true; socket.write(encodeFrame(request)); return;
    }
    if (!response) {
      if (object.correlationId !== request.correlationId || object.result !== 'OK' || !object.data || typeof object.data !== 'object') {
        const code = object.data && typeof object.data === 'object' && 'code' in object.data ? object.data.code : 'INVALID_REQUEST';
        finish(typeof code === 'string' && ['INVALID_REQUEST', 'BUSY', 'BLOCKED', 'UNAUTHORIZED', 'WRONG_STORE', 'CURSOR_EXPIRED', 'PERSISTENCE_UNAVAILABLE', 'STATE_CORRUPT', 'SERVICE_UNREACHABLE'].includes(code) ? code : 'INVALID_REQUEST'); return;
      }
      const data = object.data as Record<string, unknown>;
      subscriptionId = requireUuid(data.subscriptionId); storeId = requireUuid(data.storeId);
      if (data.instanceId !== identity) throw new Error('STALE_TARGET');
      highWater = requireDecimal(data.highWater);
      startAfter = request.params.after === undefined ? highWater : requireDecimal((request.params.after as {seq: unknown}).seq);
      if (BigInt(startAfter) > BigInt(highWater)) throw new Error('INVALID_REQUEST');
      response = object as unknown as RpcResponse; clearTimeout(timer);
      resolveReady({response, subscriptionId, storeId, instanceId: identity, highWater, done, close}); return;
    }
    if (closing && object.correlationId === closeId) { finish(null); return; }
    if (object.subscriptionId !== subscriptionId || object.correlationId !== request.correlationId) throw new Error('INVALID_REQUEST');
    if (object.kind === 'subscription.closed') {
      const code = object.error && typeof object.error === 'object' && 'code' in object.error ? object.error.code : null;
      finish(typeof code === 'string' && ['SLOW_CONSUMER', 'CURSOR_EXPIRED', 'PERSISTENCE_UNAVAILABLE', 'STATE_CORRUPT'].includes(code) ? code : 'CONTROL_INTERRUPTED'); return;
    }
    if (object.kind !== 'event' || object.instanceId !== identity || !object.event || typeof object.event !== 'object') throw new Error('INVALID_REQUEST');
    const event = object.event as StreamEventFrame['event'];
    if (event.protocolVersion !== 1 || event.storeId !== storeId || !EVENT_TYPES.includes(event.type as typeof EVENT_TYPES[number])
      || BigInt(requireDecimal(event.seq)) <= BigInt(lastReceived ?? startAfter) || Buffer.byteLength(JSON.stringify(event)) + 36 > MAX_EVENT_BYTES) throw new Error('INVALID_REQUEST');
    if (typeof event.occurredAt !== 'string' || event.occurredAt.length > 40 || !Number.isFinite(Date.parse(event.occurredAt))
      || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new Error('INVALID_REQUEST');
    requireUuid(event.eventId);
    if (event.instanceId !== null) requireUuid(event.instanceId);
    if (event.operationId !== null) requireUuid(event.operationId);
    if (closing) return;
    await Promise.race([consume(object as unknown as StreamEventFrame), done]);
    if (!ended && !closing) lastReceived = event.seq;
  }
  socket.on('data', (chunk: Buffer) => {
    socket.pause();
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > MAX_CLIENT_BUFFER_BYTES) { finish('SLOW_CONSUMER'); return; }
    if (reading) return; reading = true;
    void (async () => {
      while (!ended) {
        const newline = buffer.indexOf(10);
        if (newline < 0) { if (buffer.byteLength > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST'); break; }
        if (newline > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
        const bytes = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
        await frame(bytes);
      }
    })().catch(() => finish('INVALID_REQUEST')).finally(() => { reading = false; if (!ended) socket.resume(); });
  });
  if (options.signal?.aborted) interrupted();
  return ready;
}
