import type { DiscoveryState, RunPhase } from './model.js';
const transitions: Readonly<Record<DiscoveryState, readonly DiscoveryState[]>> = Object.freeze({
  PREPARING: ['READY_TO_START', 'FAILED', 'CANCELLED'],
  READY_TO_START: ['RUNNING', 'FAILED', 'CANCELLED', 'STALE'],
  RUNNING: ['WAITING_USER', 'READY_FOR_REVIEW', 'FAILED', 'INTERRUPTED', 'CANCELLING', 'RECONCILING', 'STALE'],
  WAITING_USER: ['RUNNING', 'CANCELLED', 'STALE'],
  READY_FOR_REVIEW: ['APPROVED', 'UPDATING', 'CANCELLED', 'STALE'],
  UPDATING: ['RUNNING', 'FAILED', 'INTERRUPTED', 'CANCELLING', 'RECONCILING', 'STALE'],
  APPROVED: ['UPDATING', 'STALE'], STALE: [], FAILED: [], CANCELLED: [], INTERRUPTED: [],
  CANCELLING: ['CANCELLED', 'INTERRUPTED', 'RECONCILING'], RECONCILING: ['INTERRUPTED', 'CANCELLING'],
});
export const DISCOVERY_STATES = Object.freeze(Object.keys(transitions) as DiscoveryState[]);
const slotStates: ReadonlySet<DiscoveryState> = new Set(['RUNNING', 'WAITING_USER', 'UPDATING', 'CANCELLING', 'RECONCILING']);
const processStates: ReadonlySet<DiscoveryState> = new Set(['RUNNING', 'UPDATING', 'CANCELLING', 'RECONCILING']);
export function holdsDiscoverySlot(state: DiscoveryState): boolean { return slotStates.has(state); }
/** Pure policy only. The writer must CAS revision, slot, grant and evidence together. */
export function transitionDiscovery(state: DiscoveryState, next: DiscoveryState,
  evidence: { readonly exitVerified?: boolean; readonly approvalValidated?: boolean } = {}): DiscoveryState {
  if (!transitions[state]?.includes(next)) throw new Error('INVALID_TRANSITION');
  if (processStates.has(state) && !['RUNNING', 'CANCELLING', 'RECONCILING'].includes(next) && !evidence.exitVerified) throw new Error('INVALID_TRANSITION');
  if (next === 'APPROVED' && !evidence.approvalValidated) throw new Error('APPROVAL_REQUIRED');
  return next;
}
const phases: readonly RunPhase[] = ['SPAWN_INTENT', 'HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING', 'EXIT_OBSERVED', 'FINALIZED'];
export function transitionRunPhase(phase: RunPhase, next: RunPhase, evidence: { readonly exitVerified?: boolean } = {}): RunPhase {
  const index = phases.indexOf(phase);
  if (next === 'EXIT_OBSERVED') {
    if (index < 0 || index >= phases.indexOf('EXIT_OBSERVED') || !evidence.exitVerified) throw new Error('INVALID_TRANSITION');
    return next;
  }
  if (index < 0 || phases[index + 1] !== next) throw new Error('INVALID_TRANSITION');
  return next;
}
