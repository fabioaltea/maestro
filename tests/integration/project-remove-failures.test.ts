import test from 'node:test';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';
import { classifyStorageFailure } from '../../src/storage/worker.js';

for (const [code, cause] of [['SQLITE_FULL', 'DISK_FULL'], ['SQLITE_IOERR_FSYNC', 'IO_ERROR']] as const) {
  test(`injected ${code} after REMOVE tombstone write rolls back config, terminal result and success event together`, async t => {
    let armed = false;
    const f = await observationStore(t, point => {
      if (armed && point === 'project.remove.written') throw Object.assign(new Error('sentinel-secret /private/driver-path'), { code });
    });
    const intent = { ...f.intent('REMOVE', { projectId: f.projectId, expectedRevision: '1' }), projectId: f.projectId };
    f.store.acceptProjectOperation(intent);
    const saved = f.store.getProject(f.projectId), registry = f.store.listProjects().registryRevision, events = f.store.listEvents({ limit: 100 });
    armed = true;
    assert.throws(() => f.store.commitProjectRemoval({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
      expectedConfigRevision: '1', completedAt: '2026-11-11T12:00:00.000Z' }), error => {
      const safe = classifyStorageFailure(error);
      assert.equal(safe.code, 'PERSISTENCE_UNAVAILABLE'); assert.equal(safe.cause, cause);
      assert.doesNotMatch(JSON.stringify(safe), /sentinel-secret|driver-path/); return true;
    });
    assert.deepEqual(f.store.getProject(f.projectId), saved); assert.equal(f.store.listProjects().registryRevision, registry);
    assert.equal(f.store.getProjectOperation(intent.requestId)!.outcome, 'IN_PROGRESS');
    assert.deepEqual(f.store.listEvents({ limit: 100 }), events);
  });
}
