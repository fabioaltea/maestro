import type { StoragePort } from '../../ports/storage.js';
import type { AgentRuntimePort, AgentExitProof, AgentProcessIdentity } from '../../ports/agent-runtime.js';
import { makeDeadline, systemClock, type Deadline } from '../../ports/clock.js';
import { createDiscoveryRecovery } from './recovery.js';
export function createDiscoveryLifecycle(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata'>; agent: AgentRuntimePort;
  settle(identity: AgentProcessIdentity, proof: AgentExitProof): Promise<void> }) {
  const recovery = createDiscoveryRecovery(options);
  return { recover: () => recovery.recover(),
    async cancel(discoveryId: string, requestId: string) {
      const d = await recovery.meta({ kind: 'discovery', id: discoveryId }); if (!d?.currentRunId) throw new Error('STALE_TARGET');
      const process = await recovery.meta({ kind: 'process', id: d.currentRunId });
      const result = process ? await options.agent.cancel(process, makeDeadline(systemClock, 4000)) : null;
      if (await recovery.finish(discoveryId, result?.ok ? result.value : null)) await recovery.completeCancellations(discoveryId);
      else await recovery.commit({ kind: 'operation-uncertain', requestId, error: 'RESOURCE_IDENTITY_UNKNOWN' });
    },
    async stop(deadline: Deadline) {
      const result = await options.agent.stopWithin(deadline); if (!result.ok) throw new Error(result.code);
      for (const d of await recovery.list('activeDiscoveries')) {
        if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
        const process = d.currentRunId ? await recovery.meta({ kind: 'process', id: d.currentRunId }) : null;
        const proof = process && process.releaseState !== 'RELEASED' ? await options.agent.cancel(process, deadline) : null;
        if (!await recovery.finish(d.discoveryId, proof?.ok ? proof.value : null)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
        await recovery.completeCancellations(d.discoveryId);
      }
      if ((await recovery.list('processes')).some(p => p.releaseState !== 'RELEASED')) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    },
  };
}
