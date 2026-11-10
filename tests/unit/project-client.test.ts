import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { LocalClient, type CommandOptions } from '../../src/client/local-client.js';
import type { ClientBackend } from '../../src/ports/platform.js';
import type { PublicResult } from '../../src/protocol/messages.js';
import { foundationError } from '../../src/domain/errors.js';

const storeId = '25c6b95f-253b-49c4-9825-ff0abbe98f3a';
const base: PublicResult = { protocolVersion: 1, storeId, instanceId: null, requestId: null,
  result: 'OK', outcome: null, freshness: 'LIVE', liveness: 'LIVE_VERIFIED', data: {}, error: null };
interface ProjectClient {
  runProject(method: 'register' | 'operation' | 'remove', params: Readonly<Record<string, unknown>>, options?: CommandOptions): Promise<PublicResult>;
}
function client(project?: (directory: string, method: string, params: Readonly<Record<string, unknown>>, timeoutMs: number) => Promise<PublicResult>): ProjectClient {
  const unexpected = async (): Promise<never> => { throw new Error('must not autostart/control/inspect Foundation during registry polling'); };
  const backend: ClientBackend = { defaultDirectory: '/owned/archive', ...(project ? { project } : {}),
    inspect: unexpected, operation: unexpected, control: unexpected, diagnostics: unexpected, events: unexpected, follow: unexpected };
  const instance = new LocalClient(backend) as unknown as ProjectClient;
  assert.equal(typeof instance.runProject, 'function', 'required registry client has not been implemented');
  return instance;
}
function interrupted(requestId: string): PublicResult {
  const error = foundationError('INTERRUPTED', { persisted: true, operationId: requestId });
  return { ...base, requestId, result: 'ERROR', outcome: 'INTERRUPTED', error, data: { operation: {
    requestId, action: 'REGISTER', projectId: null, phase: 'FINALIZED', outcome: 'INTERRUPTED', acceptedAt: '2026-11-10T12:00:00.000Z',
    deadlineAt: '2026-11-10T12:00:28.000Z', completedAt: '2026-11-10T12:00:01.000Z', result: {
      requestId, action: 'REGISTER', projectId: null, outcome: 'INTERRUPTED', effect: 'NONE', configRevision: null,
      observationRevision: null, completedAt: '2026-11-10T12:00:01.000Z', error,
    } } } };
}

test('registry client sends one immutable intent, polls with the same requestId and preserves its terminal result', async () => {
  const id = randomUUID();
  const calls: Array<{ method: string; params: Readonly<Record<string, unknown>>; at: number }> = [];
  const api = client(async (_directory, method, params, timeout) => {
    assert.ok(timeout > 0 && timeout <= 30_000);
    calls.push({ method, params, at: performance.now() });
    if (method === 'projects.register') return { ...base, requestId: id, result: 'BUSY', outcome: 'IN_PROGRESS', data: {
      requestId: id, accepted: true, outcome: 'IN_PROGRESS', pollMethod: 'projects.operation.get' } };
    assert.equal(method, 'projects.operation.get'); assert.deepEqual(params, { requestId: id });
    return interrupted(id);
  });
  const result = await api.runProject('register', { path: '/unavailable', name: ' Maestro ' }, { requestId: id });
  assert.deepEqual(result, interrupted(id));
  assert.deepEqual(calls.map(call => call.method), ['projects.register', 'projects.operation.get']);
  assert.equal(calls[0]?.params.requestId, id);
  assert.ok(calls[1]!.at - calls[0]!.at >= 45, 'polling backoff begins at 50ms');
});

test('client deadline preserves request identity and never repeats a mutation when its observation hangs', async () => {
  const calls: string[] = [];
  let original: string | undefined;
  const api = client(async (_directory, method, params) => {
    calls.push(method); original = params.requestId as string;
    return new Promise(() => {});
  });
  const result = await api.runProject('register', { path: '/unavailable' }, { timeoutMs: 25 });
  assert.equal(result.result, 'UNKNOWN_OUTCOME'); assert.equal(result.requestId, original);
  assert.equal(result.error?.code, 'UNKNOWN_OUTCOME'); assert.equal(result.outcome, null);
  assert.deepEqual(calls, ['projects.register']);
});

test('queue rejection is not polled and explicit operation query does not wait for terminal completion', async () => {
  let calls = 0;
  const id = randomUUID();
  const rejected: PublicResult = { ...base, requestId: id, result: 'BUSY', data: { requestId: id, accepted: false, outcome: null }, error: foundationError('BUSY') };
  const api = client(async () => { calls++; return rejected; });
  assert.deepEqual(await api.runProject('register', { path: '/unavailable' }, { requestId: id }), rejected);
  assert.equal(calls, 1);
  const query = client(async (_directory, method) => { assert.equal(method, 'projects.operation.get'); return interrupted(id); });
  assert.deepEqual(await query.runProject('operation', { requestId: id }), interrupted(id));
});

test('registry client refuses missing capability support, malformed responses and invalid deadlines', async () => {
  const api = client(async () => ({ ...base, result: 'BUSY', outcome: 'IN_PROGRESS', data: { accepted: true } }));
  const malformedMutation = await api.runProject('register', { path: '/a' });
  assert.equal(malformedMutation.result, 'UNKNOWN_OUTCOME'); assert.ok(malformedMutation.requestId);
  await assert.rejects(api.runProject('register', { path: '/a' }, { timeoutMs: 30_001 }), /INVALID_REQUEST/);
  await assert.rejects(api.runProject('operation', { requestId: randomUUID() }, { timeoutMs: 2_001 }), /INVALID_REQUEST/);
  await assert.rejects(api.runProject('register', { path: 'relative' }), /INVALID_REQUEST/);
  const id = randomUUID();
  const wrong = client(async () => interrupted(randomUUID()));
  await assert.rejects(wrong.runProject('operation', { requestId: id }), /INVALID_REQUEST/);
  await assert.rejects(client().runProject('operation', { requestId: id }), /UNSUPPORTED_VERSION/);
  const extra = interrupted(id);
  const malformed = client(async () => ({ ...extra, data: { operation: {
    ...(extra.data.operation as object), canonicalIntent: 'sentinel-secret',
  } } }));
  await assert.rejects(malformed.runProject('operation', { requestId: id }), /INVALID_REQUEST/);
});
