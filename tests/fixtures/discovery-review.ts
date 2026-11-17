import { randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import { launchFixture } from './discovery-launch.js';
import { value } from './discovery-artifacts.js';
import type { AgentProcessIdentity } from '../../src/ports/agent-runtime.js';
import type { DiscoveryDocument } from '../../src/domain/discovery/documents.js';
import type { createDiscoveryOperations } from '../../src/core/discovery/operations.js';
export const reviewDraft = (): DiscoveryDocument => ({ kind: 'DOCUMENT', sections: ['purpose-and-features', 'architecture-and-dependencies', 'conventions-and-operations'].map(id => ({ id, title: id, claims: [{ kind: 'UNKNOWN', text: 'Informazione assente', sources: [], answers: [], reason: 'Non documentata' }] })) });
export async function reviewFixture(t: TestContext) {
  const f = await launchFixture(t), service = f.service as unknown as ReturnType<typeof createDiscoveryOperations>;
  value(await f.service.start(f.peer, f.startInput(await f.prepare()))); await f.service.idle();
  const discovery = () => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.launches[0]!.discoveryId })).data!;
  async function exit(discoveryId = discovery().discoveryId) {
    let run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: discoveryId })).data!.currentRunId! })).data!;
    for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING', 'EXIT_OBSERVED'] as const) {
      const next = { ...run, phase, outcome: phase === 'EXIT_OBSERVED' ? 'SUCCEEDED' as const : 'RUNNING' as const, endedAt: phase === 'EXIT_OBSERVED' ? new Date().toISOString() : null };
      value(f.store.commitDiscoveryMetadata({ kind: 'run', value: next, expectedPhase: run.phase, exitVerified: phase === 'EXIT_OBSERVED' })); run = next;
    }
    return { runId: run.runId, generation: run.generation, owningInstanceId: f.instanceId, hostPid: null, providerPid: null, hostEndpoint: '/synthetic/host', credentialRef: '/synthetic/key', observation: 'ABSENT', releaseState: 'RELEASED', policy: 'cancel-on-owner-loss-v1' } satisfies AgentProcessIdentity;
  }
  const intent = (action: 'approve' | 'correct', payload: Record<string, unknown>) => f.intent({ action, targetId: discovery().discoveryId, stateRevision: discovery().stateRevision, payload });
  const command = async (action: 'approve' | 'correct', payload: Record<string, unknown>) => { const g = value(await service.prepare(f.peer, intent(action, payload))); return { requestId: randomUUID(), grantId: g.grantId, canonicalIntent: g.canonicalIntent }; };
  return { ...f, startIntent: f.intent, service, discovery, exit, intent, command };
}
