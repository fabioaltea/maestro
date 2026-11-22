import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { observationStore } from '../fixtures/project-observation.js';
import { verifyProject } from '../../src/core/projects/verify.js';
import { removeProject } from '../../src/core/projects/remove.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import { createProjectDispatch } from '../../src/core/projects/dispatch.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { canonicalRepositoryIdentity } from '../../src/domain/projects/repository-evidence.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';

test('two real clients removing one revision confirm exactly one tombstone', async t => {
  const a = await createProjectHarness(t), added = await a.register(await a.f.createRepository('two-removes'));
  const results = await Promise.all([a.client, a.other].map(actor => actor.runProject('remove', {
    projectId: added.projectId, expectedRevision: '1',
  }, { stateDirectory: a.h.archive })));
  assert.equal(results.filter(result => result.outcome === 'SUCCEEDED').length, 1);
  assert.equal(results.filter(result => result.error?.code === 'PROJECT_REMOVED').length, 1);
  const listed = await a.client.runProject('list', {}, { stateDirectory: a.h.archive }); assert.deepEqual(listed.data.projects, []);
  const missing = await a.other.runProject('get', { projectId: added.projectId }, { stateDirectory: a.h.archive });
  assert.equal((missing.data.tombstone as { configRevision: string }).configRevision, '2');
});

test('remove during verify fences the old observation even when the same repository has already been reimported', async t => {
  const f = await observationStore(t), original = f.store.getProject(f.projectId)!;
  const storage = { getProject: async (id: string) => f.store.getProject(id),
    commitProjectObservation: async (input: Parameters<typeof f.store.commitProjectObservation>[0]) => f.store.commitProjectObservation(input),
    commitProjectRemoval: async (input: Parameters<typeof f.store.commitProjectRemoval>[0]) => f.store.commitProjectRemoval(input) } as StoragePort;
  const context = (action: 'REMOVE' | 'VERIFY'): ProjectExecution => {
    const intent = { ...f.intent(action, { projectId: f.projectId, ...(action === 'REMOVE' ? { expectedRevision: '1' } : {}) }), projectId: f.projectId };
    f.store.acceptProjectOperation(intent);
    return { operation: f.store.getProjectOperation(intent.requestId)!, deadline: makeDeadline(systemClock, 2_000),
      signal: new AbortController().signal, checkpoint: async () => {}, probe: async () => ({ ok: true, value: f.evidence }) };
  };
  let entered!: () => void, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { entered = resolve; });
  const delayed = context('VERIFY'), verify = verifyProject({ ...delayed, checkpoint: async point => {
    if (point === 'project.verified') { entered(); await gate; }
  } }, storage, { capture: async path => path === '/fixture' ? f.evidence.reference.root : f.evidence.identity.commonDirectory, compare: () => 'VERIFIED' });
  await ready;
  let nextId: string;
  try {
    await removeProject(context('REMOVE'), storage);
    const intent = f.intent('REGISTER', { path: '/fixture' }); f.store.acceptProjectOperation(intent);
    const next = f.store.commitProjectRegistration({ requestId: intent.requestId, instanceId: f.instanceId, displayName: 'New registration', baseBranch: 'fixture-base',
      repositoryKey: createHash('sha256').update(canonicalRepositoryIdentity(f.evidence.identity)).digest('hex'), repositoryIdentity: f.evidence.identity,
      referenceCheckout: f.evidence.reference, observation: f.evidence.observation, completedAt: new Date().toISOString() });
    nextId = next.projectId!;
  } finally { release(); }
  await assert.rejects(verify, /PROJECT_REMOVED/);
  assert.notEqual(nextId!, f.projectId); assert.ok(f.store.getProject(f.projectId)!.project.removedAt);
  assert.deepEqual(f.store.getProject(f.projectId)!.observation, original.observation);
  assert.equal(f.store.getProject(nextId!)!.project.configRevision, '1'); assert.equal(f.store.getProject(nextId!)!.observation!.observationRevision, '1');
  assert.deepEqual(f.store.listProjects().projects.map(project => project.projectId), [nextId!]);
  assert.equal(f.store.listEvents({ limit: 100 }).records.filter(event => event.operationId === delayed.operation.requestId && event.type === 'operation.completed').length, 0);
});

test('a concurrent new import and the old remove retry never share a project ID or remove the new registration', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('concurrent-reimport'), first = await a.register(repo);
  const params = { projectId: first.projectId, expectedRevision: '1' }, requestId = randomUUID();
  const removed = await a.client.runProject('remove', params, { stateDirectory: a.h.archive, requestId });
  assert.equal(removed.outcome, 'SUCCEEDED');
  const [next, retry] = await Promise.all([a.register(repo), a.other.runProject('remove', params, { stateDirectory: a.h.archive, requestId })]);
  assert.notEqual(next.projectId, first.projectId); assert.equal((await a.get(next.projectId!)).projectId, next.projectId);
  assert.deepEqual(decodeProjectOperationView(retry.data.operation).result, decodeProjectOperationView(removed.data.operation).result);
});

test('actual local controller authentication cannot authorize remove or reach private admission', async t => {
  const f = await observationStore(t), before = f.store.getProject(f.projectId), requestId = randomUUID(); let calls = 0;
  const dispatch = createProjectDispatch({ storage: { getProject: async id => f.store.getProject(id),
    listProjects: async options => f.store.listProjects(options), getEventState: async () => f.store.getEventState() }, operations: {
    get: async () => { calls++; throw new Error('forbidden'); }, admit: async () => { calls++; throw new Error('forbidden'); },
  } });
  const key = randomBytes(32).toString('hex'), endpoint = join(f.directory, 'remove-auth.sock'), transport = createLocalTransport();
  const server = await transport.listen(endpoint, f.instanceId, new Map([[key, 'controller']]), (request, peer) => dispatch(request, peer, f.store.readSnapshot()!));
  try {
    const response = await transport.call(endpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: 'projects.remove',
      params: { requestId, projectId: f.projectId, expectedRevision: '1' } }, 1_000);
    assert.equal((response.data as { code: string }).code, 'UNAUTHORIZED'); assert.equal(calls, 0);
    assert.deepEqual(f.store.getProject(f.projectId), before); assert.equal(f.store.getProjectOperation(requestId), null);
  } finally { await server.close(); }
});
