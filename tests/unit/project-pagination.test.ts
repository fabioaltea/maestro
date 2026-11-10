import test from 'node:test';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';

test('page validation binds store/revision, never exposes private anchors and verify invalidates old cursors', async t => {
  const f = await observationStore(t);
  const page = f.store.listProjects({ limit: 1 });
  assert.equal(page.projects.length, 1); assert.equal(page.nextCursor, null); assert.equal(page.registryRevision, '1');
  assert.doesNotMatch(JSON.stringify(page), /"(?:repositoryIdentity|birthtimeNs|canonicalIntent)"\s*:/);
  for (const limit of [0, 101, -1, 1.5]) assert.throws(() => f.store.listProjects({ limit }), /INVALID_REQUEST/);
  for (const cursor of ['', '{}', '%%%']) assert.throws(() => f.store.listProjects({ cursor }), /INVALID_REQUEST/);
  const cursor = (storeId = f.storeId, registryRevision = '1') => Buffer.from(JSON.stringify({ storeId, registryRevision, lastProjectId: f.projectId })).toString('base64url');
  assert.equal(f.store.listProjects({ cursor: cursor() }).projects.length, 0);
  assert.throws(() => f.store.listProjects({ cursor: cursor('00000000-0000-4000-8000-000000000000') }), /WRONG_STORE/);
  const intent = f.intent('VERIFY', { projectId: f.projectId }); f.store.acceptProjectOperation({ ...intent, projectId: f.projectId });
  f.store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
    expectedConfigRevision: '1', expectedObservationRevision: '1', observation: f.evidence.observation, completedAt: f.evidence.observation.completedAt });
  assert.throws(() => f.store.listProjects({ cursor: cursor() }), /REGISTRY_CHANGED/);
  assert.equal(f.store.listProjects().registryRevision, '2');
});
