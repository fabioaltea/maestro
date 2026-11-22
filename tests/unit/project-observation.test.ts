import test from 'node:test';
import assert from 'node:assert/strict';
import type { RepositoryObservationEvidence } from '../../src/ports/repository.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import { observationStore } from '../fixtures/project-observation.js';
import { projectDetail } from '../../src/core/projects/read.js';

interface Commit { requestId: string; instanceId: string; projectId: string; expectedConfigRevision: string; expectedObservationRevision: string | null;
  observation: RepositoryObservationEvidence; completedAt: string }
interface Store { commitProjectObservation(input: Commit): ProjectOperationResult }

test('observation CAS preserves config, nullable facts, base states and reference-only limitations', async t => {
  const f = await observationStore(t), store = f.store as unknown as Store;
  assert.equal(typeof store.commitProjectObservation, 'function', 'observation CAS is missing');
  const before = f.store.getProject(f.projectId)!.project;
  for (const baseState of ['VALID', 'INVALID', 'UNVERIFIED'] as const) {
    const old = f.store.getProject(f.projectId)!, intent = f.intent('VERIFY', { projectId: f.projectId });
    f.store.acceptProjectOperation({ ...intent, projectId: f.projectId });
    const observation = { ...f.evidence.observation, baseState, baseOid: baseState === 'VALID' ? 'a'.repeat(40) : null,
      trackedChanges: null, untrackedChanges: null, conflicts: null };
    const result = store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
      expectedConfigRevision: '1', expectedObservationRevision: old.observation!.observationRevision, observation, completedAt: observation.completedAt });
    assert.equal(result.effect, 'OBSERVED'); assert.equal(result.configRevision, '1');
    const current = f.store.getProject(f.projectId)!;
    assert.deepEqual(current.project, before); assert.equal(current.observation!.trackedChanges, null);
    assert.equal(projectDetail(current).baseState, baseState);
    assert.deepEqual(current.observation!.limitations, ['SUBMODULE_CONTENTS_NOT_INSPECTED']);
  }
});

test('a superseded verify cannot overwrite config or observation and cannot emit a success event', async t => {
  const f = await observationStore(t), store = f.store as unknown as Store;
  assert.equal(typeof store.commitProjectObservation, 'function');
  const saved = f.store.getProject(f.projectId)!;
  for (const [expectedConfigRevision, expectedObservationRevision] of [['2', '1'], ['1', '9']]) {
    const intent = f.intent('VERIFY', { projectId: f.projectId }); f.store.acceptProjectOperation({ ...intent, projectId: f.projectId });
    assert.throws(() => store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
      expectedConfigRevision: expectedConfigRevision!, expectedObservationRevision: expectedObservationRevision!,
      observation: f.evidence.observation, completedAt: f.evidence.observation.completedAt }), /OBSERVATION_SUPERSEDED/);
    assert.deepEqual(f.store.getProject(f.projectId), saved);
    assert.equal(f.store.getProjectOperation(intent.requestId)!.outcome, 'IN_PROGRESS');
  }
});
