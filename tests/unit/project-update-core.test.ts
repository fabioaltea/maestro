import test from 'node:test';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';
import { updateProject } from '../../src/core/projects/update.js';
import type { StoragePort } from '../../src/ports/storage.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';

for (const patch of [{ name: 'Renamed' }, { baseBranch: null }, { name: 'Renamed', baseBranch: null }]) {
  test(`configuration-only update ${JSON.stringify(patch)} never calls Git or filesystem`, async t => {
    const f = await observationStore(t), intent = { ...f.intent('UPDATE', { projectId: f.projectId, expectedRevision: '1', patch }), projectId: f.projectId };
    f.store.acceptProjectOperation(intent);
    const storage = { getProject: async (id: string) => f.store.getProject(id),
      commitProjectUpdate: async (input: Parameters<typeof f.store.commitProjectUpdate>[0]) => f.store.commitProjectUpdate(input) } as StoragePort;
    const forbidden = async (): Promise<never> => { throw new Error('configuration-only update must not inspect a repository'); };
    const result = await updateProject({ operation: f.store.getProjectOperation(intent.requestId)!, deadline: makeDeadline(systemClock, 2_000),
      signal: new AbortController().signal, checkpoint: async () => {}, probe: forbidden }, storage, { capture: forbidden, compare: () => { throw new Error('forbidden'); } });
    assert.equal(result.effect, 'UPDATED'); assert.equal(result.configRevision, '2');
  });
}
