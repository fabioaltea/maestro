import test from 'node:test';
import assert from 'node:assert/strict';

async function clockContract() {
  const module = await import(new URL('../../src/ports/clock.js', import.meta.url).href).catch(() => ({}));
  assert.equal(typeof module.makeDeadline, 'function', 'Monotonic deadline contract must be implemented');
  return module;
}

test('civil time jumps cannot extend a monotonic deadline', async () => {
  const api = await clockContract();
  let monotonic = 10;
  let civil = '2026-11-08T12:00:00.000Z';
  const clock = { wallUtc: () => civil, monotonicNow: () => monotonic };
  const deadline = api.makeDeadline(clock, 500);
  civil = '2020-01-01T00:00:00.000Z';
  monotonic = 200;
  assert.equal(deadline.remainingMs(), 310);
  monotonic = 510;
  assert.equal(deadline.expired(), true);
  monotonic = 900;
  assert.equal(deadline.remainingMs(), 0);
});

test('deadlines reject nonfinite or negative timeouts', async () => {
  const api = await clockContract();
  const clock = { wallUtc: () => '', monotonicNow: () => 0 };
  for (const timeout of [-1, NaN, Infinity]) assert.throws(() => api.makeDeadline(clock, timeout), /INVALID_TIMEOUT/);
  assert.equal(api.makeDeadline(clock, 0).expired(), true);
});
