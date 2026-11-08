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
