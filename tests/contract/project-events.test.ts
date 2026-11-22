import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { redactEventDraft } from '../../src/protocol/events.js';
import { MAX_EVENT_BYTES, MAX_OUTBOX_BYTES, MAX_EVENT_PAGE_BYTES, MAX_CLIENT_BUFFER_BYTES } from '../../src/protocol/messages.js';

test('registry event redaction retains only scoped correlation, effects and exact revisions', () => {
  const projectId = randomUUID(), operationId = randomUUID(), instanceId = randomUUID();
  const draft = redactEventDraft({ type: 'operation.completed', operationId, instanceId,
    payload: { scope: 'project', projectId, action: 'REGISTER', outcome: 'SUCCEEDED', effect: 'CREATED',
      configRevision: '9007199254740993', observationRevision: '1', name: 'sentinel-secret',
      path: '/private/sentinel-secret', branch: 'sentinel-secret', remote: 'sentinel-secret', stderr: 'sentinel-secret' } });
  assert.equal(draft.operationId, operationId);
  assert.equal(draft.instanceId, instanceId);
  assert.deepEqual(draft.payload, { scope: 'project', projectId, action: 'REGISTER', outcome: 'SUCCEEDED', effect: 'CREATED',
    configRevision: '9007199254740993', observationRevision: '1', truncated: true, redactedFields: 5 });
  assert.doesNotMatch(JSON.stringify(draft), /sentinel-secret/);
  assert.ok(Buffer.byteLength(JSON.stringify(draft)) <= MAX_EVENT_BYTES);
});

test('all registry operation event types retain scope and safe errors without new event taxonomy', () => {
  for (const [type, outcome] of [['operation.accepted', 'IN_PROGRESS'], ['operation.completed', 'SUCCEEDED'],
    ['operation.failed', 'FAILED'], ['operation.blocked', 'BLOCKED'], ['operation.failed', 'INTERRUPTED']] as const) {
    for (const action of ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE']) {
      const draft = redactEventDraft({ type, operationId: randomUUID(), payload: { scope: 'project', action, outcome,
        ...(outcome === 'BLOCKED' ? { code: 'INSPECTION_UNSAFE' } : {}) } });
      assert.equal(draft.payload.scope, 'project'); assert.equal(draft.payload.action, action);
      assert.equal(draft.payload.outcome, outcome);
      assert.equal(draft.payload.truncated, undefined);
    }
  }
  assert.equal(MAX_EVENT_BYTES, 16 * 1024); assert.equal(MAX_OUTBOX_BYTES, 64 * 1024);
  assert.equal(MAX_EVENT_PAGE_BYTES, 60 * 1024); assert.equal(MAX_CLIENT_BUFFER_BYTES, 1024 * 1024);
});

test('invalid registry values cannot enter journal fields and unscoped lifecycle payloads retain prior behavior', () => {
  const draft = redactEventDraft({ type: 'operation.failed', operationId: randomUUID(), payload: {
    scope: 'project', projectId: '/foreign/path', configRevision: '-1', observationRevision: '0', effect: 'DELETE_FILES',
    action: 'shell', code: 'sentinel-secret' } });
  assert.deepEqual(draft.payload, { scope: 'project', truncated: true, redactedFields: 6 });
  const lifecycle = redactEventDraft({ type: 'operation.accepted', operationId: randomUUID(), payload: { action: 'start' } });
  assert.deepEqual(lifecycle.payload, { action: 'start' });
  assert.throws(() => redactEventDraft({ type: 'operation.accepted', payload: { scope: 'project', action: 'REGISTER' } }), /INVALID_REQUEST/);
});
