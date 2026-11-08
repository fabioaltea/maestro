export const LIFECYCLES = ['STOPPED', 'STARTING', 'RECOVERING', 'RUNNING', 'STOPPING', 'BLOCKED'] as const;
export type Lifecycle = typeof LIFECYCLES[number];
export type Outcome = 'IN_PROGRESS' | 'SUCCEEDED' | 'INTERRUPTED' | 'FAILED' | 'BLOCKED';
export type Liveness = 'LIVE_VERIFIED' | 'ABSENT_VERIFIED' | 'UNKNOWN';
export type Freshness = 'LIVE' | 'LAST_KNOWN' | 'VOLATILE';

const exits: Readonly<Record<Lifecycle, readonly Lifecycle[]>> = {
  STOPPED: ['STARTING'],
  STARTING: ['RECOVERING', 'RUNNING', 'STOPPING', 'BLOCKED'],
  RECOVERING: ['RUNNING', 'STOPPING', 'BLOCKED'],
  RUNNING: ['STOPPING', 'BLOCKED'],
  STOPPING: ['STOPPED', 'BLOCKED'],
  BLOCKED: ['RECOVERING', 'STOPPING', 'STARTING'],
};

export function isLifecycle(value: unknown): value is Lifecycle {
  return typeof value === 'string' && LIFECYCLES.includes(value as Lifecycle);
}

export function transition(from: Lifecycle, to: Lifecycle): Lifecycle {
  if (!isLifecycle(from) || !isLifecycle(to) || !exits[from].includes(to)) {
    throw new Error('INVALID_TRANSITION');
  }
  return to;
}

export interface LifecycleSnapshot { readonly lifecycle: Lifecycle; readonly revision: string }
export interface StateObservation extends LifecycleSnapshot {
  readonly ready: boolean;
  readonly liveness: Liveness;
  readonly freshness: Freshness;
}

export function observeState(snapshot: LifecycleSnapshot, liveness: Liveness, volatile = false): StateObservation {
  return {
    ...snapshot,
    ready: !volatile && liveness === 'LIVE_VERIFIED' && snapshot.lifecycle === 'RUNNING',
    liveness,
    freshness: volatile ? 'VOLATILE' : liveness === 'LIVE_VERIFIED' ? 'LIVE' : 'LAST_KNOWN',
  };
}

export function isTerminalOutcome(outcome: Outcome): boolean {
  return outcome === 'SUCCEEDED' || outcome === 'FAILED' || outcome === 'INTERRUPTED';
}
