import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectDispatch, PROJECT_METHODS } from '../../src/core/projects/dispatch.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import type { AuthenticatedPeer, RpcRequest } from '../../src/ports/platform.js';

test('registry dispatch authorizes before private lookup, projects only public fields and rejects invalid methods', async t => {
  const f = await createRegistryStore(t);
  const input = f.intent(); f.store.acceptProjectOperation(input);
  let reads = 0;
  const dispatch = createProjectDispatch({ storage: { getEventState: async () => f.store.getEventState(), getProject: async id => f.store.getProject(id), listProjects: async options => f.store.listProjects(options) }, operations: {
    get: async (_peer, id) => { reads++; return f.store.getProjectOperation(id); }, admit: async () => { throw new Error('unfinished method must not run'); },
  } });
  const request: RpcRequest = { protocolVersion: 1, correlationId: randomUUID(), method: 'projects.operation.get', params: { requestId: input.requestId } };
  const client: AuthenticatedPeer = { role: 'client', credentialId: 'owned-fixture', identity: f.instanceId };
  const snapshot = f.store.readSnapshot()!;
  const denied = await dispatch(request, { ...client, role: 'controller' }, snapshot);
  assert.equal((denied.data as { code: string }).code, 'UNAUTHORIZED'); assert.equal(reads, 0);
  const pending = await dispatch(request, client, snapshot);
  assert.equal(pending.result, 'BUSY'); assert.equal(reads, 1);
  assert.doesNotMatch(JSON.stringify(pending), /payloadHash|canonicalIntent|owningInstanceId|not-present/);
  assert.deepEqual(PROJECT_METHODS, ['projects.operation.get', 'projects.register', 'projects.create', 'projects.get', 'projects.list', 'projects.verify', 'projects.update', 'projects.remove']);
  const missing = await dispatch({ ...request, params: { requestId: randomUUID() } }, client, snapshot);
  assert.equal((missing.data as { code: string }).code, 'OPERATION_NOT_FOUND');
  const unfinished = await dispatch({ ...request, method: 'projects.unknown', params: { requestId: randomUUID(), projectId: randomUUID(), expectedRevision: '1' } }, client, snapshot);
  assert.equal((unfinished.data as { code: string }).code, 'INVALID_REQUEST');
  assert.equal(reads, 2);
});
