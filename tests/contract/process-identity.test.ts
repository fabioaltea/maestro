import test from 'node:test';
import assert from 'node:assert/strict';
import type { LocalTransport, ProcessIdentity, RpcResponse } from '../../src/ports/platform.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Options { probe?: (pid: number) => void; transport?: Pick<LocalTransport, 'call'> }
const factory = async () => (await loadContract<{ createProcessIdentity(options?: Options): ProcessIdentity }>(
  'platform/macos/process-identity.js', ['createProcessIdentity'])).createProcessIdentity;

test('PID presence and denied probes never establish ownership or authorize a signal', async () => {
  const create = await factory();
  const probed: number[] = [];
  const present = create({ probe: pid => { probed.push(pid); } });
  assert.equal(await present.probeAbsent(123), 'UNKNOWN');
  assert.deepEqual(probed, [123]);
  const absent = create({ probe: () => { throw Object.assign(new Error(), { code: 'ESRCH' }); } });
  const denied = create({ probe: () => { throw Object.assign(new Error(), { code: 'EPERM' }); } });
  assert.equal(await absent.probeAbsent(123), 'ABSENT');
  assert.equal(await denied.probeAbsent(123), 'UNKNOWN');
  assert.equal(await present.probeAbsent(-1), 'UNKNOWN');
  assert.deepEqual(probed, [123]);
});

test('challenge authenticates identity and generation; a reused PID with another identity stays unknown', async () => {
  const create = await factory();
  const expected = { identity: 'original-instance', generation: '1', key: 'a'.repeat(64) };
  let data: unknown = { identity: expected.identity, generation: expected.generation };
  const identity = create({ transport: {
    async call(_endpoint, key, request, timeout) {
      assert.equal(key, expected.key);
      assert.equal(timeout, 500);
      return { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data } satisfies RpcResponse;
    },
  } });
  assert.equal(await identity.challenge('/private/owned.sock', expected, 500), 'VERIFIED');
  data = { identity: 'a-different-process', generation: '1' };
  assert.equal(await identity.challenge('/private/owned.sock', expected, 500), 'UNKNOWN');
  data = { identity: expected.identity, generation: '2' };
  assert.equal(await identity.challenge('/private/owned.sock', expected, 500), 'UNKNOWN');
  const unreachable = create({ transport: { call: async () => { throw new Error('unavailable'); } } });
  assert.equal(await unreachable.challenge('/private/owned.sock', expected, 500), 'UNKNOWN');
});

test('exit proof comes from the observed child handle instead of a saved PID', async () => {
  const create = await factory();
  const identity = create({ probe: () => { throw new Error('Exit proof must not probe a PID'); } });
  assert.equal(await identity.observeExit({ pid: 123, exit: Promise.resolve({ code: 0, signal: null }) }), 'ABSENT');
});
