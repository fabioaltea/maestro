import { requireDecimal, requireUuid } from '../identifiers.js';
import type { SafeError } from '../errors.js';
import type { ReferenceCheckout, RepositoryIdentity, RepositoryObservationEvidence } from '../../ports/repository.js';

export const PROJECT_ACTIONS = ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE'] as const;
export type ProjectAction = typeof PROJECT_ACTIONS[number];
export type ProjectPhase = 'ACCEPTED' | 'PROBING' | 'FINALIZED';
export type ProjectOutcome = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'INTERRUPTED';
export type ProjectEffect = 'CREATED' | 'EXISTING' | 'UPDATED' | 'OBSERVED' | 'REMOVED' | 'NONE';
export interface Project {
  readonly projectId: string;
  readonly displayName: string;
  readonly repositoryKey: string;
  readonly repositoryIdentity: RepositoryIdentity;
  readonly referenceCheckout: ReferenceCheckout;
  readonly baseBranch: string | null;
  readonly configRevision: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly removedAt: string | null;
}
export interface ProjectObservation extends Omit<RepositoryObservationEvidence, 'error'> {
  readonly projectId: string;
  readonly observationRevision: string;
  readonly observedConfigRevision: string;
  readonly requestId: string;
  readonly observedInstanceId: string;
  readonly error: SafeError | null;
}
export interface ProjectOperationResult {
  readonly action: ProjectAction;
  readonly requestId: string;
  readonly projectId: string | null;
  readonly outcome: Exclude<ProjectOutcome, 'IN_PROGRESS'>;
  readonly effect: ProjectEffect;
  readonly configRevision: string | null;
  readonly observationRevision: string | null;
  readonly completedAt: string;
  readonly error: SafeError | null;
}
export interface ProjectOperation {
  readonly requestId: string;
  readonly action: ProjectAction;
  readonly payloadHash: string;
  readonly canonicalIntent: string;
  readonly projectId: string | null;
  readonly expectedConfigRevision: string | null;
  readonly owningInstanceId: string;
  readonly ownerUid: number;
  readonly phase: ProjectPhase;
  readonly outcome: ProjectOutcome;
  readonly acceptedAt: string;
  readonly deadlineAt: string;
  readonly completedAt: string | null;
  readonly result: ProjectOperationResult | null;
}

export function normalizeProjectName(value: unknown): string {
  if (typeof value !== 'string' || !value.isWellFormed()) throw new Error('INVALID_NAME');
  const normalized = value.trim();
  if (!normalized || [...normalized].length > 120 || /\p{Cc}/u.test(normalized)) throw new Error('INVALID_NAME');
  return normalized;
}
export function requireProjectRevision(value: unknown): string {
  try {
    const decimal = requireDecimal(value);
    if (decimal === '0') throw new Error('INVALID_REQUEST');
    return decimal;
  } catch { throw new Error('INVALID_REQUEST'); }
}
export function nextProjectRevision(value: unknown): string {
  const current = requireProjectRevision(value);
  if (current === '9223372036854775807') throw new Error('INVALID_REVISION');
  return String(BigInt(current) + 1n);
}
export function isTerminalProjectOutcome(value: unknown): boolean {
  if (!['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(value as string)) throw new Error('INVALID_REQUEST');
  return value !== 'IN_PROGRESS';
}
export function transitionProjectOperation(from: ProjectPhase, to: ProjectPhase, outcome: ProjectOutcome): ProjectPhase {
  if ((from === 'ACCEPTED' && to === 'PROBING' && outcome === 'IN_PROGRESS')
    || ((from === 'ACCEPTED' || from === 'PROBING') && to === 'FINALIZED'
      && ['SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(outcome))) return to;
  throw new Error('INVALID_TRANSITION');
}
export function validateProjectOperationResult(result: ProjectOperationResult): void {
  try {
    requireUuid(result.requestId);
    if (!PROJECT_ACTIONS.includes(result.action) || !isTerminalProjectOutcome(result.outcome)
      || typeof result.completedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result.completedAt)
      || !Number.isFinite(Date.parse(result.completedAt))) throw new Error('INVALID_REQUEST');
    if (result.projectId !== null) requireUuid(result.projectId);
    if (result.configRevision !== null) requireProjectRevision(result.configRevision);
    if (result.observationRevision !== null) requireProjectRevision(result.observationRevision);
    if (result.outcome === 'SUCCEEDED') {
      const effects: Readonly<Record<ProjectAction, readonly ProjectEffect[]>> = {
        REGISTER: ['CREATED', 'EXISTING'], VERIFY: ['OBSERVED'], UPDATE: ['UPDATED', 'NONE'], REMOVE: ['REMOVED'],
      };
      if (!effects[result.action].includes(result.effect) || !result.projectId || !result.configRevision || result.error !== null
        || (['CREATED', 'EXISTING', 'OBSERVED'].includes(result.effect) && !result.observationRevision)) throw new Error('INVALID_REQUEST');
    } else if (result.effect !== 'NONE' || !result.error) throw new Error('INVALID_REQUEST');
  } catch { throw new Error('INVALID_REQUEST'); }
}
