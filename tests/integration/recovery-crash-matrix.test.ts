import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPoints, recoveryScenario } from '../fixtures/recovery-scenarios.js';
import { loadContract } from '../fixtures/load-contract.js';
import { openStorage } from '../../src/storage/worker.js';

for (const point of recoveryPoints) {
  test(`reconcile actual process crash at ${point} without duplicating confirmed effects`, async t => {
    await loadContract('core/recovery.js', ['reconcileControl']);
    const h = await recoveryScenario(t, point);
    const store = await openStorage({ path: h.paths.stateFile, readonly: true });
    let previous;
    try { previous = await store.getOperation(h.requestId); } finally { await store.close(); }
    const recovered = await h.call(h.action, '--request-id', h.requestId);
    assert.equal(recovered.code, 0, recovered.stdout);
    const result = JSON.parse(recovered.stdout);
    assert.equal(result.outcome, 'SUCCEEDED');
    const repeated = await h.call(h.action, '--request-id', h.requestId);
    assert.equal(repeated.code, 0, repeated.stdout);
    const historical = JSON.parse(repeated.stdout).data.operation;
    assert.equal(historical.successorInstanceId, result.data.operation.successorInstanceId);
    if (previous?.outcome === 'SUCCEEDED') assert.deepEqual(historical, previous);
  });
}

test('new stop cancels an unclaimed old launch and a delayed candidate is fenced', async t => {
  const h = await recoveryScenario(t, 'control.ticketIssued');
  assert.equal((await h.call('start')).code, 3);
  const store = await openStorage({path: h.paths.stateFile, readonly: true});
  try {
    const ticket = (await store.listTickets(h.requestId))[0]!;
    const stopped = await h.call('stop');
    assert.equal(stopped.code, 0, stopped.stdout);
    assert.equal((await store.getOperation(h.requestId))?.outcome, 'INTERRUPTED');
    assert.equal((await store.getTicket(ticket.ticketId))?.status, 'CANCELLED');
    const { createDaemonLauncher } = await import('../../src/platform/macos/launcher.js');
    const late = await createDaemonLauncher().spawnDaemon({ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: h.archive});
    assert.notEqual((await late.exit).code, 0);
    assert.equal((await store.readSnapshot())?.instance, null);
  } finally { await store.close(); }
});

test('a different stop interrupts a lost restart after stop, without resuming its start phase', async t => {
  const h = await recoveryScenario(t, 'control.stopObserved', 'restart');
  assert.equal((await h.call('start')).code, 3);
  assert.equal((await h.call('stop')).code, 0);
  const store = await openStorage({path: h.paths.stateFile, readonly: true});
  try {
    const old = await store.getOperation(h.requestId);
    assert.equal(old?.outcome, 'INTERRUPTED');
    assert.equal(old?.successorInstanceId, null);
    assert.equal((await store.readSnapshot())?.instance?.lifecycle, 'STOPPED');
  } finally { await store.close(); }
});
