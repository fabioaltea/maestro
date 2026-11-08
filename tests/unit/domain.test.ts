import test from 'node:test';
import assert from 'node:assert/strict';

interface DomainContract {
  transition(from: string, to: string): string;
  observeState(snapshot: { lifecycle: string; revision: string }, liveness: string, volatile?: boolean): {
    ready: boolean; freshness: string; lifecycle: string;
  };
  isTerminalOutcome(outcome: string): boolean;
}
async function domain(): Promise<DomainContract> {
  const url = new URL('../../src/domain/states.js', import.meta.url);
  const module = await import(url.href).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    return {};
  }) as Partial<DomainContract>;
  assert.equal(typeof module.transition, 'function', 'Domain contract transition must be implemented');
  return module as DomainContract;
}

test('lifecycle permits controlled startup, recovery, drain and completed stop', async () => {
  const api = await domain();
  assert.equal(api.transition('STOPPED', 'STARTING'), 'STARTING');
  assert.equal(api.transition('STARTING', 'RECOVERING'), 'RECOVERING');
  assert.equal(api.transition('RECOVERING', 'RUNNING'), 'RUNNING');
  assert.equal(api.transition('RUNNING', 'STOPPING'), 'STOPPING');
  assert.equal(api.transition('STOPPING', 'STOPPED'), 'STOPPED');
});

test('no transition invents success from a blocked state or bypasses startup', async () => {
  const api = await domain();
  assert.throws(() => api.transition('STOPPED', 'RUNNING'), /INVALID_TRANSITION/);
  assert.throws(() => api.transition('BLOCKED', 'RUNNING'), /INVALID_TRANSITION/);
  assert.throws(() => api.transition('RUNNING', 'STOPPED'), /INVALID_TRANSITION/);
  assert.throws(() => api.transition('CRASHED', 'RUNNING'), /INVALID_TRANSITION/);
});

test('a crash leaves last known lifecycle but never proves readiness', async () => {
  const api = await domain();
  const persisted = { lifecycle: 'RUNNING', revision: '9007199254740993' };
  const observation = api.observeState(persisted, 'UNKNOWN');
  assert.equal(observation.ready, false);
  assert.equal(observation.lifecycle, 'RUNNING');
  assert.equal(observation.freshness, 'LAST_KNOWN');
  assert.equal(persisted.lifecycle, 'RUNNING');
  assert.equal(api.observeState(persisted, 'LIVE_VERIFIED').ready, true);
  const volatile = api.observeState(persisted, 'LIVE_VERIFIED', true);
  assert.equal(volatile.ready, false);
  assert.equal(volatile.freshness, 'VOLATILE');
});

test('blocked operations are retryable, terminal results do not authorize replay', async () => {
  const api = await domain();
  assert.equal(api.isTerminalOutcome('BLOCKED'), false);
  assert.equal(api.isTerminalOutcome('IN_PROGRESS'), false);
  for (const outcome of ['SUCCEEDED', 'FAILED', 'INTERRUPTED']) {
    assert.equal(api.isTerminalOutcome(outcome), true);
  }
});

test('identifiers validate UUIDs and preserve decimal revisions without Number conversion', async () => {
  const module = await import(new URL('../../src/domain/identifiers.js', import.meta.url).href).catch(() => ({}));
  assert.equal(typeof module.requireUuid, 'function', 'UUID contract must be implemented');
  assert.equal(module.requireUuid('5fc02636-f95e-4ee8-9969-2a7e0c2478f0'), '5fc02636-f95e-4ee8-9969-2a7e0c2478f0');
  assert.throws(() => module.requireUuid('../../another-store'), /INVALID_IDENTIFIER/);
  assert.equal(module.requireDecimal('9007199254740993'), '9007199254740993');
  assert.throws(() => module.requireDecimal('-1'), /INVALID_IDENTIFIER/);
});

test('public errors contain safe actionable text without raw causes or secrets', async () => {
  const module = await import(new URL('../../src/domain/errors.js', import.meta.url).href).catch(() => ({}));
  assert.equal(typeof module.foundationError, 'function', 'Error contract must be implemented');
  const error = module.foundationError('PERSISTENCE_UNAVAILABLE', { persisted: false });
  assert.equal(error.code, 'PERSISTENCE_UNAVAILABLE');
  assert.equal(error.persisted, false);
  assert.equal(typeof error.nextAction, 'string');
  assert.ok(error.nextAction.length > 0);
  assert.equal('cause' in error, false);
});
