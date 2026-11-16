import test from 'node:test';
import assert from 'node:assert/strict';

async function stateModule() {
  return await import(new URL('../../src/domain/discovery/state.js', import.meta.url).href) as {
    transitionDiscovery(state: string, next: string, evidence?: { exitVerified?: boolean; approvalValidated?: boolean }): string;
    transitionRunPhase(phase: string, next: string): string;
    holdsDiscoverySlot(state: string): boolean;
  };
}
test('waiting user keeps the logical slot; ready review releases only after proven exit', async () => {
  const domain = await stateModule();
  assert.equal(domain.holdsDiscoverySlot('WAITING_USER'), true);
  assert.equal(domain.holdsDiscoverySlot('RECONCILING'), true);
  assert.equal(domain.holdsDiscoverySlot('CANCELLING'), true);
  assert.equal(domain.holdsDiscoverySlot('READY_TO_START'), false);
  assert.equal(domain.holdsDiscoverySlot('READY_FOR_REVIEW'), false);
  assert.throws(() => domain.transitionDiscovery('RUNNING', 'WAITING_USER'));
  assert.equal(domain.transitionDiscovery('RUNNING', 'WAITING_USER', { exitVerified: true }), 'WAITING_USER');
  assert.throws(() => domain.transitionDiscovery('RUNNING', 'READY_FOR_REVIEW'));
  assert.equal(domain.transitionDiscovery('RUNNING', 'READY_FOR_REVIEW', { exitVerified: true }), 'READY_FOR_REVIEW');
});
test('agent completion never approves and corrections acquire the slot without rewriting history', async () => {
  const domain = await stateModule();
  assert.throws(() => domain.transitionDiscovery('RUNNING', 'APPROVED', { exitVerified: true }));
  assert.throws(() => domain.transitionDiscovery('READY_FOR_REVIEW', 'APPROVED'));
  assert.equal(domain.transitionDiscovery('READY_FOR_REVIEW', 'APPROVED', { approvalValidated: true }), 'APPROVED');
  assert.equal(domain.transitionDiscovery('APPROVED', 'UPDATING'), 'UPDATING');
  assert.equal(domain.holdsDiscoverySlot('UPDATING'), true);
  assert.equal(domain.transitionDiscovery('UPDATING', 'RUNNING'), 'RUNNING');
  assert.equal(domain.transitionDiscovery('APPROVED', 'STALE'), 'STALE');
  assert.throws(() => domain.transitionDiscovery('STALE', 'APPROVED', { approvalValidated: true }));
});
test('unknown ownership cannot release a slot or resume an orphan generation', async () => {
  const domain = await stateModule();
  assert.equal(domain.transitionDiscovery('RUNNING', 'RECONCILING'), 'RECONCILING');
  assert.throws(() => domain.transitionDiscovery('RECONCILING', 'CANCELLED'));
  assert.throws(() => domain.transitionDiscovery('RECONCILING', 'RUNNING'));
  assert.equal(domain.transitionDiscovery('RECONCILING', 'INTERRUPTED', { exitVerified: true }), 'INTERRUPTED');
  assert.equal(domain.transitionDiscovery('WAITING_USER', 'CANCELLED'), 'CANCELLED');
  assert.throws(() => domain.transitionDiscovery('CANCELLED', 'RUNNING'));
});
test('run phases cannot skip durable authorization or confuse operation admission with completion', async () => {
  const domain = await stateModule();
  assert.equal(domain.transitionRunPhase('SPAWN_INTENT', 'HOST_READY'), 'HOST_READY');
  assert.equal(domain.transitionRunPhase('HOST_READY', 'SPAWN_AUTHORIZED'), 'SPAWN_AUTHORIZED');
  assert.throws(() => domain.transitionRunPhase('SPAWN_INTENT', 'PROVIDER_RUNNING'));
  assert.throws(() => domain.transitionRunPhase('HOST_READY', 'FINALIZED'));
  assert.equal(domain.transitionRunPhase('EXIT_OBSERVED', 'FINALIZED'), 'FINALIZED');
  assert.throws(() => domain.transitionRunPhase('FINALIZED', 'SPAWN_INTENT'));
});
