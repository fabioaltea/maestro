import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { once } from 'node:events';
import { join } from 'node:path';
import type { LocalTransport, RpcRequest } from '../../src/ports/platform.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

const request: RpcRequest = { protocolVersion: 1, correlationId: '5fc02636-f95e-4ee8-9969-2a7e0c2478f0', method: 'status.get', params: {} };

test('request validation rejects incompatible, malformed, oversized and unknown frames before dispatch', async () => {
  const { decodeRequest } = await loadContract<{ decodeRequest(frame: string | Uint8Array): RpcRequest }>('protocol/validation.js', ['decodeRequest']);
  assert.deepEqual(decodeRequest(JSON.stringify(request)), request);
  assert.throws(() => decodeRequest('{bad json'), /INVALID_REQUEST/);
  assert.throws(() => decodeRequest(new Uint8Array([0xff, 0xfe])), /INVALID_REQUEST/);
  assert.throws(() => decodeRequest(JSON.stringify({ ...request, protocolVersion: 2 })), /UNSUPPORTED_VERSION/);
  assert.throws(() => decodeRequest(JSON.stringify({ ...request, params: [] })), /INVALID_REQUEST/);
  assert.throws(() => decodeRequest(JSON.stringify({ ...request, method: 'shell.run' })), /INVALID_REQUEST/);
  assert.throws(() => decodeRequest(JSON.stringify({ ...request, params: { text: 'a'.repeat(65_536) } })), /INVALID_REQUEST/);
});

test('UDS authenticates the peer before dispatch and protects diagnostic responses from wrong keys', async (t) => {
  const context = await createTestContext(t);
  const { createLocalTransport } = await loadContract<{ createLocalTransport(): LocalTransport }>('platform/macos/transport.js', ['createLocalTransport']);
  const transport = createLocalTransport();
  const key = randomBytes(32).toString('hex');
  const endpoint = join(context.directory, 'rpc.sock');
  let calls = 0;
  const server = await transport.listen(endpoint, 'daemon-identity', new Map([[key, 'client']]), async (frame, peer) => {
    calls++;
    assert.equal(peer.role, 'client');
    return { protocolVersion: 1, correlationId: frame.correlationId, result: 'OK', data: { ready: true } };
  });
  t.after(() => server.close());
  await assert.rejects(transport.call(endpoint, randomBytes(32).toString('hex'), request, 2_000), /UNAUTHORIZED/);
  assert.equal(calls, 0);
  const response = await transport.call(endpoint, key, request, 2_000);
  assert.deepEqual(response.data, { ready: true });
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(response).includes(key), false);
});

test('a silent or pre-auth request never reaches dispatch and handshake has a bounded wait', async (t) => {
  const context = await createTestContext(t);
  const { createLocalTransport } = await loadContract<{ createLocalTransport(): LocalTransport }>('platform/macos/transport.js', ['createLocalTransport']);
  const transport = createLocalTransport();
  const endpoint = join(context.directory, 'unauth.sock');
  let calls = 0;
  const server = await transport.listen(endpoint, 'daemon-identity', new Map(), async frame => {
    calls++;
    return { protocolVersion: 1, correlationId: frame.correlationId, result: 'OK', data: null };
  });
  t.after(() => server.close());
  const premature = connect(endpoint);
  premature.on('error', () => {});
  premature.resume();
  const closed = once(premature, 'close');
  await once(premature, 'connect');
  premature.write(JSON.stringify(request) + '\n');
  await closed;
  const silent = connect(endpoint);
  silent.on('error', () => {});
  silent.resume();
  const silentClosed = once(silent, 'close');
  const limit = setTimeout(() => silent.destroy(new Error('Handshake deadline exceeded')), 2_000);
  try { await silentClosed; }
  finally { clearTimeout(limit); }
  assert.equal(calls, 0);
});
