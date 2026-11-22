import test from 'node:test';
import assert from 'node:assert/strict';
import { createCliHarness } from '../fixtures/cli-harness.js';

test('ten concurrent starts create at most one owner and never report unverified readiness', async (t) => {
  const harness = await createCliHarness(t);
  const starts = await Promise.all(Array.from({ length: 10 }, () => harness.call('start')));
  for (const result of starts) assert.ok(result.code === 0 || result.code === 3, result.stdout || result.stderr);
  assert.ok(starts.some(result => result.code === 0));
  const status = JSON.parse((await harness.call('status')).stdout);
  assert.equal(status.data.ready, true);
  const repeated = await harness.call('start');
  assert.equal(repeated.code, 0, repeated.stdout);
  const same = JSON.parse((await harness.call('status')).stdout);
  assert.equal(same.instanceId, status.instanceId);
  assert.equal(same.data.pid, status.data.pid);
});

test('separate archives keep independent daemon identities and stop does not affect the other', async (t) => {
  const first = await createCliHarness(t);
  const second = await createCliHarness(t);
  assert.equal((await first.call('status')).code, 0);
  assert.equal((await first.call('start')).code, 0);
  assert.equal((await second.call('start')).code, 0);
  const original = JSON.parse((await second.call('status')).stdout);
  const one = JSON.parse((await first.call('status')).stdout);
  assert.notEqual(one.storeId, original.storeId);
  assert.notEqual(one.instanceId, original.instanceId);
  assert.equal((await first.call('stop')).code, 0);
  const unaffected = JSON.parse((await second.call('status')).stdout);
  assert.equal(unaffected.instanceId, original.instanceId);
  assert.equal(unaffected.data.ready, true);
});
