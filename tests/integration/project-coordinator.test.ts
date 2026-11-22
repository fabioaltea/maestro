import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { openStorage } from '../../src/storage/worker.js';
import { createProjectOperations } from '../../src/core/projects/operations.js';
import { foundationError } from '../../src/domain/errors.js';

test('coordinator acknowledges a durable original intent and commits its result/events through the real storage worker', async t => {
  const f = await createRegistryStore(t);
  const storage = await openStorage({ path: f.path });
  let probes = 0;
  const api = createProjectOperations({ storage, ownerUid: process.getuid!(), instanceId: f.instanceId,
    supervisor: { start: async (_request, ownership) => {
      probes++;
      return { ownership, cancel: async () => 'ABSENT', result: Promise.resolve({ ok: false,
        error: { code: 'INSPECTION_UNSAFE', retryable: false, nextAction: 'check-inspection-capability' } }) };
    } },
    execute: async context => {
      const saved = await storage.getProjectOperation(context.operation.requestId);
      assert.equal(saved?.canonicalIntent, context.operation.canonicalIntent);
      await context.probe({ kind: 'CANDIDATE', path: '/not-present' });
      return { action: context.operation.action, requestId: context.operation.requestId, projectId: null,
        outcome: 'BLOCKED', effect: 'NONE', configRevision: null, observationRevision: null,
        completedAt: new Date().toISOString(), error: foundationError('INSPECTION_UNSAFE', { persisted: true }) };
    } });
  t.after(async () => { await api.shutdown(); await storage.close(); });
  const requestId = randomUUID();
  const peer = { role: 'client' };
  assert.equal((await api.admit(peer, 'REGISTER', requestId, { path: '/unavailable', name: ' Maestro ' })).accepted, true);
  const until = performance.now() + 2_000;
  while ((await api.get(peer, requestId))?.outcome === 'IN_PROGRESS') {
    assert.ok(performance.now() < until, 'terminal must be published without retaining a client session');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  const terminal = await api.get(peer, requestId);
  assert.equal(terminal?.outcome, 'BLOCKED');
  assert.equal(terminal?.result?.error?.code, 'INSPECTION_UNSAFE');
  const retried = await api.admit(peer, 'REGISTER', requestId, { name: 'Maestro', path: '/unavailable' });
  assert.equal(retried.accepted, true);
  if (retried.accepted) assert.deepEqual(retried.operation, terminal);
  assert.equal(probes, 1);
  const events = (await storage.listEvents({ limit: 100 })).records.filter(event => event.operationId === requestId);
  assert.deepEqual(events.map(event => event.type), ['operation.accepted', 'operation.blocked']);
  for (const event of events) assert.equal(event.payload.scope, 'project');
});
