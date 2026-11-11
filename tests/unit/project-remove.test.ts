import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { observationStore } from '../fixtures/project-observation.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';

interface Commit { requestId: string; instanceId: string; projectId: string; expectedConfigRevision: string; completedAt: string }
interface RemoveStore { commitProjectRemoval(input: Commit): ProjectOperationResult }
async function fixture(t: Parameters<typeof observationStore>[0]) {
  const f = await observationStore(t), store = f.store as typeof f.store & RemoveStore;
  assert.equal(typeof store.commitProjectRemoval, 'function', 'atomic removal is missing');
  const prepare = (revision = '1') => {
    const intent = { ...f.intent('REMOVE', { projectId: f.projectId, expectedRevision: revision }), projectId: f.projectId };
    store.acceptProjectOperation(intent);
    const input: Commit = { requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
      expectedConfigRevision: revision, completedAt: '2026-11-11T12:00:00.000Z' };
    return { intent, input };
  };
  return { ...f, store, prepare };
}

test('remove persists an immutable tombstone with one config/registry increment and retains every historical observation/operation', async t => {
  const f = await fixture(t), saved = f.store.getProject(f.projectId)!, revision = f.store.listProjects().registryRevision;
  const { input, intent } = f.prepare();
  const result = f.store.commitProjectRemoval(input);
  assert.equal(result.effect, 'REMOVED'); assert.equal(result.configRevision, '2'); assert.equal(result.observationRevision, '1');
  const current = f.store.getProject(f.projectId)!;
  assert.deepEqual(current.project, { ...saved.project, removedAt: input.completedAt, updatedAt: input.completedAt, configRevision: '2' });
  assert.deepEqual(current.observation, saved.observation);
  assert.equal(f.store.listProjects().projects.length, 0); assert.equal(f.store.listProjects().registryRevision, String(BigInt(revision) + 1n));
  const replay = f.store.acceptProjectOperation(intent);
  assert.equal(replay.accepted, false); assert.deepEqual(replay.operation.result, result);
  assert.deepEqual(f.store.getProjectOperation(saved.observation!.requestId)!.result!.effect, 'CREATED');
  assert.deepEqual(f.store.getProject(f.projectId), current);
});

test('stale revision, mismatched target and a second distinct remove leave all project data intact', async t => {
  const f = await fixture(t), saved = f.store.getProject(f.projectId);
  assert.throws(() => f.store.commitProjectRemoval(f.prepare('9').input), /REVISION_CONFLICT/);
  const target = f.prepare();
  assert.throws(() => f.store.commitProjectRemoval({ ...target.input, projectId: randomUUID() }), /INVALID_REQUEST|INVALID_TRANSITION|PROJECT_NOT_FOUND/);
  assert.deepEqual(f.store.getProject(f.projectId), saved);
  f.store.commitProjectRemoval(target.input); const tombstone = f.store.getProject(f.projectId);
  assert.throws(() => f.store.commitProjectRemoval(f.prepare('2').input), /PROJECT_REMOVED/);
  assert.deepEqual(f.store.getProject(f.projectId), tombstone);
});
