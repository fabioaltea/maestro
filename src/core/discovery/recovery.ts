import type { StoragePort } from '../../ports/storage.js';
import type { AgentRuntimePort, AgentExitProof, AgentProcessIdentity } from '../../ports/agent-runtime.js';
import type { DiscoveryMetadataQuery, DiscoveryMetadataData, DiscoveryMetadataChange, DiscoveryMetadataLists } from '../../ports/discovery.js';
import type { DiscoveryRun } from '../../domain/discovery/model.js';
export function createDiscoveryRecovery(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata'>; agent: AgentRuntimePort;
  settle(identity: AgentProcessIdentity, proof: AgentExitProof): Promise<void> }) {
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> { const r = await options.storage.readDiscoveryMetadata!(query); if (!r.ok) throw new Error(r.code); return r.value.data; }
  async function commit(change: DiscoveryMetadataChange) { const r = await options.storage.commitDiscoveryMetadata!(change); if (!r.ok) throw new Error(r.code); }
  async function list<K extends 'activeDiscoveries' | 'processes' | 'pendingOperations'>(kind: K) {
    const all: DiscoveryMetadataLists[K][] = []; let offset = 0;
    for (;;) { const page = await meta({ kind, offset, limit: 20 }); if (!page) throw new Error('ARTIFACT_CORRUPT'); all.push(...page.items as DiscoveryMetadataLists[K][]); if (all.length > 4096) throw new Error('DISCOVERY_LIMIT'); if (page.nextOffset === null) return all; if (page.nextOffset <= offset) throw new Error('ARTIFACT_CORRUPT'); offset = page.nextOffset; }
  }
  async function finish(discoveryId: string, proof?: AgentExitProof | null) {
    let d = await meta({ kind: 'discovery', id: discoveryId }); if (!d?.currentRunId) return false;
    let run = await meta({ kind: 'run', id: d.currentRunId }); if (!run) return false;
    const process = await meta({ kind: 'process', id: run.runId });
    const verified = proof ? proof.hostExited && proof.providerExited && proof.runId === run.runId && proof.generation === run.generation
      : process ? process.observation === 'ABSENT' && process.releaseState === 'RELEASED' : run.phase === 'SPAWN_INTENT' || run.phase === 'FINALIZED';
    if (!verified) {
      if (['RUNNING', 'UPDATING', 'CANCELLING'].includes(d.state)) await commit({ kind: 'state', discoveryId, expectedRevision: d.stateRevision, next: 'RECONCILING', exitVerified: false });
      return false;
    }
    if (process && proof) {
      await options.settle(process, proof);
      await commit({ kind: 'process', value: { ...process, observation: 'ABSENT', releaseState: 'RELEASED' } });
      d = await meta({ kind: 'discovery', id: discoveryId }); run = await meta({ kind: 'run', id: process.runId }); if (!d || !run || d.currentRunId !== run.runId) return false;
    }
    if (['WAITING_USER', 'READY_FOR_REVIEW', 'APPROVED'].includes(d.state)) return run.phase === 'FINALIZED';
    const next = d.state === 'CANCELLING' || d.state === 'CANCELLED' ? 'CANCELLED' : 'INTERRUPTED';
    if (run.phase !== 'FINALIZED') {
      if (run.phase !== 'EXIT_OBSERVED') { const exited: DiscoveryRun = { ...run, phase: 'EXIT_OBSERVED', outcome: next, endedAt: new Date().toISOString(), error: null }; await commit({ kind: 'run', value: exited, expectedPhase: run.phase, exitVerified: true }); run = exited; }
      await commit({ kind: 'run', value: { ...run, phase: 'FINALIZED', outcome: next }, expectedPhase: 'EXIT_OBSERVED', exitVerified: true });
    }
    if (['RUNNING', 'UPDATING', 'CANCELLING', 'RECONCILING'].includes(d.state)) await commit({ kind: 'state', discoveryId, expectedRevision: d.stateRevision, next, exitVerified: true });
    return true;
  }
  async function completeCancellations(discoveryId: string) {
    for (const op of await list('pendingOperations')) if (op.action === 'cancel' && op.discoveryId === discoveryId)
      await commit({ kind: 'operation', requestId: op.requestId, outcome: 'SUCCEEDED', completedAt: new Date().toISOString(), result: { discoveryId }, error: null });
  }
  return { meta, commit, list, finish, completeCancellations,
    async recover() {
      let safe = true;
      for (const d of await list('activeDiscoveries')) {
        const process = d.currentRunId ? await meta({ kind: 'process', id: d.currentRunId }) : null;
        const proof = process && process.releaseState !== 'RELEASED' ? await options.agent.reconcile(process) : null;
        const verified = await finish(d.discoveryId, proof?.ok ? proof.value : null); if (verified) await completeCancellations(d.discoveryId); safe = verified && safe;
      }
      for (const process of await list('processes')) if (process.releaseState !== 'RELEASED') safe = false;
      for (const op of await list('pendingOperations')) {
        const d = op.discoveryId ? await meta({ kind: 'discovery', id: op.discoveryId }) : null;
        if (d?.state === 'RECONCILING') { await commit({ kind: 'operation-uncertain', requestId: op.requestId, error: 'RESOURCE_IDENTITY_UNKNOWN' }); continue; }
        await commit({ kind: 'operation', requestId: op.requestId, outcome: 'INTERRUPTED', completedAt: new Date().toISOString(), result: null, error: 'INTERRUPTED' });
      }
      return safe;
    },
  };
}
