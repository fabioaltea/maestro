import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openStorage } from '../../src/storage/worker.js';
import type { AcceptOperation, LaunchTicket, OperationRecord, StoragePort } from '../../src/ports/storage.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';

interface Operations {
  accept(intent: Omit<AcceptOperation, 'payloadHash' | 'ownerUid' | 'acceptedAt'> & {canonicalStateDir: string}): Promise<{operation: OperationRecord; accepted: boolean}>;
  issueLaunch(requestId: string, instanceId: string): Promise<LaunchTicket>;
  replaceUnclaimed(ticketId: string): Promise<LaunchTicket>;
  claimLaunch(ticketId: string, generation: string, pid: number): Promise<boolean>;
}
const operationFactory = () => loadContract<{createOperations(store: StoragePort, uid: number): Operations}>('core/operations.js', ['createOperations']);
const requestId = '5fc02636-f95e-4ee8-9969-2a7e0c2478f0';
const instanceId = '234ce67a-4316-4b24-bff6-d13a97f47888';

test('core acceptance is idempotent and an issued ticket cannot launch twice', async (t) => {
  const { createOperations } = await operationFactory();
  const context = await createTestContext(t);
  const store = await openStorage({ path: join(context.directory, 'state.sqlite'), identity: {
    storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: 2, ownerUid: process.getuid!(),
    canonicalPath: context.directory, revision: '0',
  } });
  try {
    const operations = createOperations(store, process.getuid!());
    const intent = {requestId, action: 'start' as const, targetInstanceId: null, canonicalStateDir: context.directory};
    assert.equal((await operations.accept(intent)).accepted, true);
    assert.equal((await operations.accept(intent)).accepted, false);
    const ticket = await operations.issueLaunch(requestId, instanceId);
    await assert.rejects(operations.issueLaunch(requestId, instanceId), /BUSY/);
    assert.deepEqual(await Promise.all([
      operations.claimLaunch(ticket.ticketId, ticket.generation, 100),
      operations.claimLaunch(ticket.ticketId, ticket.generation, 101),
    ]), [true, false]);
    await assert.rejects(operations.replaceUnclaimed(ticket.ticketId), /BLOCKED/);
  } finally { await store.close(); }
});

test('replacement cancels the delayed candidate before issuing a new generation', async (t) => {
  const { createOperations } = await operationFactory();
  const context = await createTestContext(t);
  const store = await openStorage({ path: join(context.directory, 'state.sqlite'), identity: {
    storeId: '25c6b95f-253b-49c4-9825-ff0abbe98f3a', schemaVersion: 2, ownerUid: process.getuid!(),
    canonicalPath: context.directory, revision: '0',
  } });
  try {
    const operations = createOperations(store, process.getuid!());
    await operations.accept({requestId, action: 'start', targetInstanceId: null, canonicalStateDir: context.directory});
    const old = await operations.issueLaunch(requestId, instanceId);
    const next = await operations.replaceUnclaimed(old.ticketId);
    assert.notEqual(next.ticketId, old.ticketId);
    assert.equal(next.generation, '2');
    assert.equal(await operations.claimLaunch(old.ticketId, old.generation, 100), false);
    assert.equal(await operations.claimLaunch(next.ticketId, next.generation, 101), true);
  } finally { await store.close(); }
});
