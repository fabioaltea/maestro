import type { Deadline } from './clock.js';
import type { DiscoveryResult, RunOutcome } from '../domain/discovery/model.js';
import type { ProviderInvocation } from './provider.js';

export const DISCOVERY_RUNTIME_POLICY = 'cancel-on-owner-loss-v1' as const;
export interface AgentProcessIdentity {
  readonly runId: string; readonly generation: string; readonly owningInstanceId: string;
  readonly hostPid: number | null; readonly providerPid: number | null; readonly hostEndpoint: string;
  readonly credentialRef: string; readonly observation: 'VERIFIED' | 'ABSENT' | 'UNKNOWN';
  readonly releaseState: 'OWNED' | 'RELEASED' | 'BLOCKED'; readonly policy: string;
}
/** Authenticated local process exit only; a valid provider result is a separate core gate. */
export interface AgentExitProof {
  readonly runId: string; readonly generation: string; readonly hostExited: boolean; readonly providerExited: boolean;
  readonly outcome: RunOutcome; readonly authentication: string;
  readonly exitCode?: number | null; readonly signal?: string | null; readonly error?: import('../domain/discovery/model.js').DiscoveryFailure | null;
}
export interface AgentRuntimePort {
  launch(input: { readonly identity: AgentProcessIdentity; readonly invocation: ProviderInvocation;
    readonly stdin: string; readonly deadline: Deadline }): Promise<DiscoveryResult<AgentProcessIdentity>>;
  authorizeStart(identity: AgentProcessIdentity): Promise<DiscoveryResult<void>>;
  observe(identity: AgentProcessIdentity): Promise<DiscoveryResult<AgentProcessIdentity>>;
  cancel(identity: AgentProcessIdentity, deadline: Deadline): Promise<DiscoveryResult<AgentExitProof>>;
  reconcile(identity: AgentProcessIdentity): Promise<DiscoveryResult<AgentExitProof | null>>;
  stopWithin(deadline: Deadline): Promise<DiscoveryResult<void>>;
}
