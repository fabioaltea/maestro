import test from 'node:test';
import assert from 'node:assert/strict';
import { unavailableObservation, verifyProject } from '../../src/core/projects/verify.js';
import { observationStore } from '../fixtures/project-observation.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';
import type { StoragePort } from '../../src/ports/storage.js';

test('unavailable observations preserve unknown facts and distinguish no base from an unverified configured base', async t => {
  const f = await observationStore(t), state = f.store.getProject(f.projectId)!;
  for (const baseBranch of [null, 'fixture-base']) for (const code of ['REFERENCE_CHECKOUT_UNAVAILABLE', 'PATH_ACCESS_DENIED', 'REPOSITORY_CHANGED'] as const) {
    const observation = unavailableObservation({ ...state, project: { ...state.project, baseBranch } },
      { code, retryable: false, nextAction: 'restore-checkout' }, '2026-11-10T12:00:01.000Z', '2026-11-10T12:00:02.000Z');
    assert.equal(observation.baseState, baseBranch === null ? 'UNCONFIGURED' : 'UNVERIFIED');
    assert.equal(observation.trackedChanges, null); assert.equal(observation.conflicts, null); assert.equal(observation.hasCommits, null);
    assert.equal(observation.repositoryIdentityStatus, code === 'REPOSITORY_CHANGED' ? 'CHANGED' : 'UNVERIFIED');
  }
});

test('verification publishes unavailable state atomically through captured config and observation revisions', async t => {
  const f = await observationStore(t), intent = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId };
  f.store.acceptProjectOperation(intent);
  const operation = f.store.getProjectOperation(intent.requestId)!;
  const storage = { getProject: async (id: string) => f.store.getProject(id),
    commitProjectObservation: async (input: Parameters<typeof f.store.commitProjectObservation>[0]) => f.store.commitProjectObservation(input) } as StoragePort;
  const context: ProjectExecution = { operation, deadline: makeDeadline(systemClock, 2_000), signal: new AbortController().signal,
    checkpoint: async () => {}, probe: async request => {
      assert.equal(request.kind, 'REGISTERED');
      return { ok: false, error: { code: 'REFERENCE_CHECKOUT_UNAVAILABLE', retryable: true, nextAction: 'restore-checkout' } };
    } };
  const result = await verifyProject(context, storage, { capture: async () => { throw new Error('not reached'); }, compare: () => 'UNKNOWN' });
  assert.equal(result.effect, 'OBSERVED'); assert.equal(result.error, null); assert.equal(result.configRevision, '1');
  const state = f.store.getProject(f.projectId)!;
  assert.equal(state.observation!.error!.code, 'REFERENCE_CHECKOUT_UNAVAILABLE'); assert.equal(state.observation!.error!.persisted, true);
});
