import type { TestContext } from 'node:test';
import { launchFixture } from './discovery-launch.js';
import { value } from './discovery-artifacts.js';
import { loadContract } from './load-contract.js';
import type { AgentProcessIdentity } from '../../src/ports/agent-runtime.js';
import type { ProviderEvent } from '../../src/ports/provider.js';
export interface OutputPublisher { publish(identity: AgentProcessIdentity, event: ProviderEvent): Promise<void> }
export async function outputFixture(t: TestContext) {
  const f = await launchFixture(t), grant = await f.prepare(); value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle();
  let run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.launches[0]!.runId })).data!;
  for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING'] as const) {
    const next = { ...run, phase }; value(f.store.commitDiscoveryMetadata({ kind: 'run', value: next, expectedPhase: run.phase, exitVerified: false })); run = next;
  }
  const identity: AgentProcessIdentity = { runId: run.runId, generation: run.generation, owningInstanceId: f.instanceId, hostPid: null, providerPid: null,
    hostEndpoint: '/synthetic/host', credentialRef: '/synthetic/key', observation: 'VERIFIED', releaseState: 'OWNED', policy: 'cancel-on-owner-loss-v1' };
  const module = await loadContract<{ createDiscoveryOutput(options: object): OutputPublisher }>('core/discovery/output.js', ['createDiscoveryOutput']);
  return { ...f, run, identity, createPublisher: module.createDiscoveryOutput, publisher: module.createDiscoveryOutput({ storage: f.store, artifacts: f.artifacts }) };
}
