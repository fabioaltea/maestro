import { createHash, randomUUID } from 'node:crypto';
import { requireUuid } from '../domain/identifiers.js';
import { systemClock, type Clock } from '../ports/clock.js';
import type { AcceptOperation, StoragePort, LaunchTicket } from '../ports/storage.js';

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
