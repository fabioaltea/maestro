import { createServer, connect, type Socket } from 'node:net';
import { chmod, lstat } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { LocalTransport, LocalRole, RpcResponse } from '../../ports/platform.js';
import { HANDSHAKE_TIMEOUT_MS, MAX_CLIENT_BUFFER_BYTES, MAX_FRAME_BYTES } from '../../protocol/messages.js';
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

function frameReader(socket: Socket, consume: (frame: Buffer) => void, fail: () => void): void {
  let buffered = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    if (socket.destroyed) return;
    buffered = Buffer.concat([buffered, chunk]);
    let newline: number;
    while ((newline = buffered.indexOf(10)) !== -1) {
      if (newline > MAX_FRAME_BYTES) { fail(); return; }
      const frame = buffered.subarray(0, newline);
      buffered = buffered.subarray(newline + 1);
      consume(frame);
      if (socket.destroyed) return;
    }
    if (buffered.byteLength > MAX_FRAME_BYTES) fail();
  });
}

export function createLocalTransport(): LocalTransport {
  return {
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
        let queued = 0;
        let queue = Promise.resolve();
        const timer = setTimeout(() => fail('UNAUTHORIZED'), HANDSHAKE_TIMEOUT_MS);
        function fail(code: string) {
          if (failed || socket.destroyed) return;
          failed = true;
          clearTimeout(timer);
          socket.end(encodeFrame({ protocolVersion: 1, kind: 'error', code }));
          const destroy = setTimeout(() => socket.destroy(), 100);
          destroy.unref();
          socket.once('close', () => clearTimeout(destroy));
        }
        socket.on('error', () => socket.destroy());
        socket.once('close', () => { clearTimeout(timer); sockets.delete(socket); });
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
          const parsed = request;
          queue = queue.then(async () => {
            if (failed || socket.destroyed) return;
            try {
              const result = await dispatch(parsed, { role, identity });
              const encoded = encodeFrame(result);
              if (socket.writableLength + encoded.byteLength > MAX_CLIENT_BUFFER_BYTES) { fail('SLOW_CONSUMER'); return; }
              socket.write(encoded);
            } catch { fail('INTERNAL_ERROR'); }
            finally { queued--; }
          });
        }, () => fail('INVALID_REQUEST'));
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
