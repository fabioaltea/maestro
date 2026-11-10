import { createHash, randomUUID } from 'node:crypto';
import { requireUuid } from '../domain/identifiers.js';
import { systemClock, type Clock } from '../ports/clock.js';
import type { AcceptOperation, StoragePort, LaunchTicket, OperationRecord, InstanceRecord } from '../ports/storage.js';

type Intent = Omit<AcceptOperation, 'payloadHash' | 'ownerUid' | 'acceptedAt'> & { readonly canonicalStateDir: string };

export function createOperations(store: StoragePort, ownerUid: number, clock: Clock = systemClock) {
  async function authorize() {
    const snapshot = await store.readSnapshot();
    if (!snapshot || snapshot.store.ownerUid !== ownerUid) throw new Error('UNAUTHORIZED');
    return snapshot;
  }
  return {
    async accept(intent: Intent) {
      requireUuid(intent.requestId);
      const snapshot = await authorize();
      if (intent.canonicalStateDir !== snapshot.store.canonicalPath) throw new Error('UNAUTHORIZED');
      const payload = JSON.stringify({ action: intent.action, canonicalStateDir: intent.canonicalStateDir,
        targetInstanceId: intent.targetInstanceId });
      // Preserve the established lifecycle hash. Storage reserves it in the shared
      // request catalog atomically with the lifecycle ledger, including cross-scope checks.
      return store.acceptOperation({ requestId: intent.requestId, action: intent.action,
        targetInstanceId: intent.targetInstanceId, ownerUid, acceptedAt: clock.wallUtc(),
        payloadHash: createHash('sha256').update(payload).digest('hex') });
    },
    async issueLaunch(requestId: string, instanceId: string): Promise<LaunchTicket> {
      await authorize();
      const operation = await store.getOperation(requireUuid(requestId));
      if (!operation || operation.outcome !== 'IN_PROGRESS') throw new Error('STALE_TARGET');
      if (operation.successorInstanceId !== null) throw new Error('BUSY');
      return store.issueTicket({ ticketId: randomUUID(), requestId, instanceId: requireUuid(instanceId), generation: '1' });
    },
    async replaceUnclaimed(ticketId: string): Promise<LaunchTicket> {
      await authorize();
      const previous = await store.getTicket(requireUuid(ticketId));
      if (!previous || previous.status !== 'ISSUED') throw new Error('BLOCKED');
      if (!await store.cancelTicket(ticketId)) throw new Error('BLOCKED');
      return store.issueTicket({ ticketId: randomUUID(), requestId: previous.requestId,
        instanceId: previous.instanceId, generation: String(BigInt(previous.generation) + 1n) });
    },
    async claimLaunch(ticketId: string, generation: string, pid: number) {
      await authorize();
      return store.claimTicket(requireUuid(ticketId), generation, pid);
    },
  };
}

/** Admission never retargets an already accepted request to a successor. */
export function controlDisposition(operation: OperationRecord, current: InstanceRecord | null): 'EXECUTE' | 'RETRY' | 'HISTORICAL' {
  if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(operation.outcome)) return 'HISTORICAL';
  if ((current?.instanceId ?? null) !== operation.targetInstanceId) throw new Error('STALE_TARGET');
  if (operation.outcome === 'BLOCKED') {
    if (operation.successorInstanceId !== null) throw new Error('BLOCKED');
    return 'RETRY';
  }
  return 'EXECUTE';
}

export function authorizePrepareStop(input: {
  role: string; currentCredential: boolean; controlLeaseHeld: boolean;
  instance: InstanceRecord; operation: OperationRecord | null; params: Readonly<Record<string, unknown>>;
}): void {
  const { operation, instance, params } = input;
  if (input.role !== 'controller' || !input.currentCredential || !input.controlLeaseHeld || !operation
    || operation.outcome !== 'IN_PROGRESS' || !['stop', 'restart'].includes(operation.action)
    || !['STOP_REQUESTED', 'DRAINING', 'WAIT_EXIT'].includes(operation.phase)
    || operation.requestId !== params.requestId) throw new Error('UNAUTHORIZED');
  if (operation.targetInstanceId !== instance.instanceId || params.targetInstanceId !== instance.instanceId
    || params.generation !== instance.generation) throw new Error('STALE_TARGET');
}
