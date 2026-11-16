import { SCHEMA_VERSION } from '../../src/storage/schema.js';
import { createHash, randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { canonicalProjectIntent } from '../../src/domain/projects/intent.js';
import type { ProjectAction, ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { AcceptProjectOperation } from '../../src/ports/registry.js';
import { foundationError } from '../../src/domain/errors.js';
import { createTestContext } from './test-context.js';

export async function createRegistryStore(t: TestContext, checkpoint?: (point: string) => void, newProjectId?: () => string) {
  const context = await createTestContext(t);
  const directory = await realpath(context.directory);
  const path = join(directory, 'state.sqlite');
  const storeId = randomUUID(), instanceId = randomUUID(), bootstrap = randomUUID(), ticketId = randomUUID();
  let armed = false;
  const hooks = { checkpoint: (point: string) => { if (armed) checkpoint?.(point); }, ...(newProjectId ? { newProjectId } : {}) };
  const store = new SQLiteStore({ path, identity: { storeId, schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: directory, revision: '0' } }, hooks);
  t.after(() => store.close());
  const acceptedAt = '2026-11-10T12:00:00.000Z';
  store.acceptOperation({ requestId: bootstrap, action: 'start', payloadHash: 'c'.repeat(64), ownerUid: process.getuid!(), targetInstanceId: null, acceptedAt });
  store.issueTicket({ requestId: bootstrap, ticketId, instanceId, generation: '1' });
  store.claimTicket(ticketId, '1', process.pid);
  store.recordInstance({ instanceId, generation: '1', pid: process.pid, lifecycle: 'RUNNING', startedAt: acceptedAt, shutdownPrepared: false, lastError: null });
  store.completeOperation(bootstrap, 'SUCCEEDED', acceptedAt, null);
  armed = true;
  function intent(action: ProjectAction = 'REGISTER', params: Record<string, unknown> = { path: '/not-present/🎼' }): AcceptProjectOperation {
    const canonicalIntent = canonicalProjectIntent(storeId, action, params);
    return { requestId: randomUUID(), action, canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'),
      projectId: null, expectedConfigRevision: (params.expectedRevision as string | undefined) ?? null,
      owningInstanceId: instanceId, ownerUid: process.getuid!(), acceptedAt, deadlineAt: '2026-11-10T12:00:28.000Z' };
  }
  function terminal(input: AcceptProjectOperation, outcome: 'FAILED' | 'BLOCKED' | 'INTERRUPTED' = 'INTERRUPTED'): ProjectOperationResult {
    return { requestId: input.requestId, action: input.action, projectId: input.projectId, outcome,
      effect: 'NONE', configRevision: null, observationRevision: null, completedAt: '2026-11-10T12:00:01.000Z',
      error: foundationError(outcome === 'BLOCKED' ? 'INSPECTION_UNSAFE' : 'INVALID_REQUEST', { persisted: true, operationId: input.requestId }) };
  }
  return { context, directory, path, storeId, instanceId, store, intent, terminal };
}
