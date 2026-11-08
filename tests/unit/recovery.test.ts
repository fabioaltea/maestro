import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { OperationRecord } from '../../src/ports/storage.js';
import { loadContract } from '../fixtures/load-contract.js';

interface RecoveryInput {
  operation: OperationRecord; requested: {requestId: string; action: string};
  observation: 'READY' | 'ABSENT' | 'UNKNOWN'; ticketStatus: 'ISSUED' | 'CLAIMED' | null;
  currentInstanceId: string | null;
}
interface Recovery { decideRecovery(input: RecoveryInput): 'COMPLETE' | 'RESUME' | 'INTERRUPT' | 'BLOCKED' | 'HISTORICAL' }
const op = (): OperationRecord => ({ requestId: randomUUID(), action: 'start', payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(),
  targetInstanceId: null, successorInstanceId: randomUUID(), phase: 'SPAWN_INTENT', outcome: 'IN_PROGRESS', acceptedAt: '', completedAt: null, error: null });

test('lost controller: only same intent resumes an unclaimed launch; explicit stop interrupts it', async () => {
  const { decideRecovery } = await loadContract<Recovery>('core/recovery.js', ['decideRecovery']);
  const operation = op();
  const input: RecoveryInput = { operation, requested: {requestId: operation.requestId, action: 'start'}, observation: 'ABSENT', ticketStatus: 'ISSUED', currentInstanceId: null };
  assert.equal(decideRecovery(input), 'RESUME');
  assert.equal(decideRecovery({ ...input, requested: {requestId: randomUUID(), action: 'restart'} }), 'BLOCKED');
  assert.equal(decideRecovery({ ...input, requested: {requestId: randomUUID(), action: 'stop'} }), 'INTERRUPT');
  assert.throws(() => decideRecovery({ ...input, requested: {requestId: operation.requestId, action: 'stop'} }), /IDEMPOTENCY_CONFLICT/);
});

test('claimed candidates require verified effect or absence; terminal results never authorize effects', async () => {
  const { decideRecovery } = await loadContract<Recovery>('core/recovery.js', ['decideRecovery']);
  const operation = op();
  const input: RecoveryInput = { operation, requested: {requestId: randomUUID(), action: 'stop'}, observation: 'UNKNOWN', ticketStatus: 'CLAIMED', currentInstanceId: operation.successorInstanceId };
  assert.equal(decideRecovery(input), 'BLOCKED');
  assert.equal(decideRecovery({ ...input, observation: 'READY' }), 'COMPLETE');
  assert.equal(decideRecovery({ ...input, observation: 'ABSENT' }), 'INTERRUPT');
  for (const outcome of ['SUCCEEDED', 'FAILED', 'INTERRUPTED'] as const) {
    assert.equal(decideRecovery({ ...input, operation: { ...operation, outcome } }), 'HISTORICAL');
  }
  const restart = { ...operation, action: 'restart' as const, successorInstanceId: null, phase: 'WAIT_EXIT' as const };
  assert.equal(decideRecovery({ ...input, operation: restart, observation: 'ABSENT', ticketStatus: null }), 'INTERRUPT');
  assert.equal(decideRecovery({ ...input, operation: restart, observation: 'ABSENT', ticketStatus: null,
    requested: {requestId: restart.requestId, action: 'restart'} }), 'RESUME');
});
