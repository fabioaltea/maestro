import test from 'node:test';
import assert from 'node:assert/strict';
import { loadContract } from '../fixtures/load-contract.js';
import type { RpcRequest } from '../../src/ports/platform.js';

interface Codec {
  decodeRequest(frame: string | Uint8Array): RpcRequest;
  requireProjectClient(role: string): void;
  requireProjectCapability(capabilities: unknown): void;
  validateProjectAdmission(data: unknown): void;
}
const codec = () => loadContract<Codec>('protocol/validation.js', ['decodeRequest', 'requireProjectClient', 'requireProjectCapability', 'validateProjectAdmission']);
const id = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';
const frame = (method: string, params: unknown) => JSON.stringify({ protocolVersion: 1, correlationId: id, method, params });

test('registry methods extend the existing Foundation v1 envelope with closed typed params', async () => {
  const api = await codec();
  for (const [method, params] of [
    ['projects.register', { requestId: id, path: '/a b/🎼', name: 'Maestro', baseBranch: 'topic/x' }],
    ['projects.list', {}], ['projects.list', { limit: 100, cursor: 'opaque-store-bound-cursor' }],
    ['projects.get', { projectId: id }], ['projects.verify', { requestId: id, projectId: id }],
    ['projects.update', { requestId: id, projectId: id, expectedRevision: '9007199254740993', patch: { name: 'New', baseBranch: null } }],
    ['projects.remove', { requestId: id, projectId: id, expectedRevision: '1' }],
    ['projects.operation.get', { requestId: id }],
  ] as const) {
    const request = api.decodeRequest(frame(method, params));
    assert.equal(request.protocolVersion, 1); assert.equal(request.method, method);
    assert.deepEqual(request.params, params);
    assert.throws(() => api.decodeRequest(frame(method, { ...params, force: true })), /INVALID_REQUEST/);
  }
  assert.equal(api.decodeRequest(frame('status.get', {})).method, 'status.get');
  assert.throws(() => api.decodeRequest(JSON.stringify({ protocolVersion: 1, correlationId: id,
    method: 'projects.list', params: {}, extra: true })), /INVALID_REQUEST/);
  assert.throws(() => api.decodeRequest(frame('projects.execute', {})), /INVALID_REQUEST/);
});

test('registry codec rejects coercion, extra authority, malformed Unicode and payloads outside limits', async () => {
  const api = await codec();
  const cases = [
    ['projects.register', { requestId: id, path: 'relative' }],
    ['projects.register', { requestId: id, path: '/a', baseBranch: null }],
    ['projects.register', { requestId: id, path: '/a', name: '\ud800' }],
    ['projects.register', { requestId: id, path: '/a', baseBranch: 'é'.repeat(513) }],
    ['projects.register', { requestId: id, path: '/' + 'é'.repeat(8192) }],
    ['projects.get', { projectId: '../../x' }],
    ['projects.get', { projectId: id, ownerUid: 0 }],
    ['projects.list', { limit: '25' }], ['projects.list', { limit: 0 }], ['projects.list', { limit: 101 }],
    ['projects.list', { cursor: '' }], ['projects.list', { cursor: 'a'.repeat(8192) }],
    ['projects.remove', { requestId: id, projectId: id, expectedRevision: 1 }],
    ['projects.remove', { requestId: id, projectId: id, expectedRevision: '0' }],
    ['projects.remove', { requestId: id, projectId: id, expectedRevision: '01' }],
    ['projects.remove', { requestId: id, projectId: id, expectedRevision: '9223372036854775808' }],
    ['projects.update', { requestId: id, projectId: id, expectedRevision: '1', patch: {} }],
    ['projects.update', { requestId: id, projectId: id, expectedRevision: '1', patch: { cleanup: true } }],
    ['projects.verify', { requestId: 1, projectId: id }],
    ['projects.operation.get', {}],
  ] as const;
  for (const [method, params] of cases) assert.throws(() => api.decodeRequest(frame(method, params)), /INVALID_REQUEST|INVALID_NAME|INVALID_BASE_BRANCH/);
  assert.throws(() => api.decodeRequest(frame('projects.register', { requestId: id, path: '/' + 'x'.repeat(65536) })), /INVALID_REQUEST/);
});

test('client role and actual registry capability are required without granting internal authority', async () => {
  const api = await codec();
  api.requireProjectClient('client');
  for (const role of ['controller', 'auxiliary', '', 'admin']) assert.throws(() => api.requireProjectClient(role), /UNAUTHORIZED/);
  api.requireProjectCapability({ projectRegistryVersion: 1 });
  for (const capabilities of [null, {}, { projectRegistryVersion: 2 }, { projectRegistryVersion: '1' }]) {
    assert.throws(() => api.requireProjectCapability(capabilities), /UNSUPPORTED_VERSION/);
  }
});

test('admission separates durable accepted work from BUSY rejection without claiming a terminal result', async () => {
  const api = await codec();
  api.validateProjectAdmission({ requestId: id, accepted: true, outcome: 'IN_PROGRESS', pollMethod: 'projects.operation.get' });
  api.validateProjectAdmission({ requestId: id, accepted: false, outcome: null });
  for (const data of [
    { requestId: id, accepted: true, outcome: 'SUCCEEDED', pollMethod: 'projects.operation.get' },
    { requestId: id, accepted: true, outcome: 'IN_PROGRESS', pollMethod: 'internal.prepareStop' },
    { requestId: id, accepted: false, outcome: 'IN_PROGRESS' },
    { requestId: id, accepted: 'true', outcome: 'IN_PROGRESS' },
    { requestId: 'bad', accepted: true, outcome: 'IN_PROGRESS', pollMethod: 'projects.operation.get' },
  ]) assert.throws(() => api.validateProjectAdmission(data), /INVALID_REQUEST/);
});

test('all registry errors have deterministic allowlisted categories and safe next actions', async () => {
  const { foundationError } = await loadContract<{ foundationError(code: string, context?: object): {
    code: string; category: string; nextAction: string; retryable: boolean; cause: unknown;
  } }>('domain/errors.js', ['foundationError']);
  const expected = {
    INVALID_NAME: 'VALIDATION', INVALID_BASE_BRANCH: 'VALIDATION', PATH_ACCESS_DENIED: 'AUTHORIZATION',
    REVISION_CONFLICT: 'CONCURRENCY', IDEMPOTENCY_CONFLICT: 'CONCURRENCY', OBSERVATION_SUPERSEDED: 'CONCURRENCY', REGISTRY_CHANGED: 'CONCURRENCY',
    REPOSITORY_NOT_FOUND: 'RUNTIME', REFERENCE_CHECKOUT_UNAVAILABLE: 'RUNTIME', REPOSITORY_UNSUPPORTED: 'RUNTIME', GIT_UNAVAILABLE: 'RUNTIME',
    REPOSITORY_CHANGED: 'SAFETY', REPOSITORY_UNSTABLE: 'SAFETY', INSPECTION_UNAVAILABLE: 'SAFETY', INSPECTION_UNSAFE: 'SAFETY',
    UNKNOWN_OUTCOME: 'TIMEOUT', OUTPUT_LIMIT: 'RUNTIME', PROJECT_NOT_FOUND: 'RUNTIME', PROJECT_REMOVED: 'RUNTIME',
    REGISTRY_NOT_INITIALIZED: 'RUNTIME', STATE_ABSENT: 'RUNTIME', DAEMON_UNAVAILABLE: 'RUNTIME',
  };
  for (const [code, category] of Object.entries(expected)) {
    const error = foundationError(code);
    assert.equal(error.code, code); assert.equal(error.category, category);
    assert.equal(typeof error.retryable, 'boolean'); assert.ok(error.nextAction.length > 0);
    assert.equal(error.cause, null);
    assert.deepEqual(error, foundationError(code));
  }
  assert.throws(() => foundationError('raw Git stderr with sentinel-secret'), /INVALID_ERROR_CODE/);
});
