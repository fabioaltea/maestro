import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { projectMutationEffect } from '../../src/renderer/state/project-actions.ts';
import type { PublicResult } from '../../src/shared/bridge-contract.ts';
const projectId = randomUUID();
const response = (): PublicResult => ({ protocolVersion: 1, requestId: randomUUID(), storeId: randomUUID(), instanceId: randomUUID(), result: 'OK', outcome: 'SUCCEEDED', freshness: 'LIVE', liveness: 'LIVE_VERIFIED', data: { effect: 'UPDATED', projectId }, error: null });
test('only a confirmed successful result changes a project view; uncertainty never borrows a claimed effect', () => {
  assert.deepEqual(projectMutationEffect(response()), { type: 'updated', projectId });
  assert.equal(projectMutationEffect({ ...response(), result: 'UNKNOWN_OUTCOME' }).type, 'unknown');
  assert.equal(projectMutationEffect({ ...response(), outcome: 'IN_PROGRESS' }).type, 'none');
  assert.equal(projectMutationEffect({ ...response(), result: 'BLOCKED', outcome: 'BLOCKED' }).type, 'none');
  assert.equal(projectMutationEffect({ ...response(), data: { operation: { result: { effect: 'EXISTING', projectId } } } }).type, 'existing');
});
