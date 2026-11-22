import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { observationStore } from '../fixtures/project-observation.js';
import { removeProject } from '../../src/core/projects/remove.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';

test('registration-only removal requires no Git capability, repository filesystem or probe', async t => {
  const f = await observationStore(t), input = { ...f.intent('REMOVE', { projectId: f.projectId, expectedRevision: '1' }), projectId: f.projectId };
  f.store.acceptProjectOperation(input);
  const result = await removeProject({ operation: f.store.getProjectOperation(input.requestId)!, deadline: makeDeadline(systemClock, 2_000),
    signal: new AbortController().signal, checkpoint: async () => {}, probe: async () => { throw new Error('Git unavailable and must never be invoked'); } }, {
    getProject: async id => f.store.getProject(id), commitProjectRemoval: async commit => f.store.commitProjectRemoval(commit),
  });
  assert.equal(result.effect, 'REMOVED'); assert.equal(result.configRevision, '2');
});

test('unknown IDs fail explicitly before removal and stale revisions cannot authorize a different target', async t => {
  const f = await observationStore(t), original = f.store.getProject(f.projectId);
  for (const [projectId, expectedRevision] of [[randomUUID(), '1'], [f.projectId, '9']]) {
    const input = { ...f.intent('REMOVE', { projectId, expectedRevision }), projectId: projectId === f.projectId ? projectId! : null };
    f.store.acceptProjectOperation(input);
    const context: ProjectExecution = { operation: f.store.getProjectOperation(input.requestId)!, deadline: makeDeadline(systemClock, 2_000),
      signal: new AbortController().signal, checkpoint: async () => {}, probe: async () => { throw new Error('forbidden'); } };
    await assert.rejects(removeProject(context, { getProject: async id => f.store.getProject(id), commitProjectRemoval: async () => { throw new Error('must not commit'); } }),
      projectId === f.projectId ? /REVISION_CONFLICT/ : /PROJECT_NOT_FOUND/);
    assert.deepEqual(f.store.getProject(f.projectId), original);
  }
});
