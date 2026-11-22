import test from 'node:test';
import assert from 'node:assert/strict';
import { initialProjectView, projectViewReducer, decodeProject } from '../../src/renderer/state/project-view.ts';
import { randomUUID } from 'node:crypto';
test('project view rejects stale replies, preserves null and historic observation', () => {
  const project = { projectId: randomUUID(), displayName: '<img onerror=bad>', referenceCheckout: '/tmp/repo', baseBranch: null, baseState: 'UNCONFIGURED', configRevision: '3', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z', observation: null };
  const state = projectViewReducer(initialProjectView, { type: 'context', epoch: 2, storeId: randomUUID() });
  assert.equal(projectViewReducer(state, { type: 'page', epoch: 1, projects: [project], cursor: null }), state);
  assert.equal(decodeProject(project).observation, null);
  assert.throws(() => decodeProject({ ...project, configRevision: 3 }));
  const ready = projectViewReducer(state, { type: 'page', epoch: 2, projects: [project], cursor: null });
  assert.equal(ready.projects[0]!.displayName, project.displayName);
  assert.equal(projectViewReducer(ready, { type: 'invalidated', epoch: 2 }).projects.length, 0);
});
test('list cache bounded and new context clears selection and cached records', () => {
  const projects = Array.from({ length: 150 }, (_, i) => ({ projectId: randomUUID(), displayName: String(i), referenceCheckout: '/tmp/repo', baseBranch: null, baseState: 'UNCONFIGURED', configRevision: '1', createdAt: '', updatedAt: '', observation: null }));
  const state = projectViewReducer(initialProjectView, { type: 'page', epoch: 0, projects, cursor: null });
  assert.ok(state.projects.length <= 100);
  const next = projectViewReducer(state, { type: 'context', epoch: 1, storeId: null });
  assert.equal(next.projects.length, 0); assert.equal(next.detail, null);
});
