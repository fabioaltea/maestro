import type { Lifecycle, Outcome } from '../domain/states.js';
import type { SafeError } from '../domain/errors.js';
import type { RegistryOperationsPort, RegistryRegistrationPort, RegistryReadPort, RegistryObservationPort, RegistryUpdatePort, RegistryRemovalPort } from './registry.js';

export interface StoreIdentity {
  readonly storeId: string;
  readonly schemaVersion: number;
  readonly ownerUid: number;
  readonly canonicalPath: string;
  readonly revision: string;
}
export interface InstanceRecord {
  readonly instanceId: string;
  readonly pid: number;
  readonly generation: string;
  readonly lifecycle: Lifecycle;
  readonly startedAt: string;
  readonly shutdownPrepared: boolean;
  readonly lastError: SafeError | null;
}
export type ControlAction = 'start' | 'stop' | 'restart';
export type ControlPhase = 'ACCEPTED' | 'PRECHECK' | 'SPAWN_INTENT' | 'WAIT_READY'
  | 'STOP_REQUESTED' | 'DRAINING' | 'WAIT_EXIT' | 'FINALIZED';
export interface OperationRecord {
  readonly requestId: string;
  readonly action: ControlAction;
  readonly payloadHash: string;
  readonly ownerUid: number;
  readonly targetInstanceId: string | null;
  readonly successorInstanceId: string | null;
  readonly phase: ControlPhase;
  readonly outcome: Outcome;
  readonly acceptedAt: string;
  readonly completedAt: string | null;
  readonly error: SafeError | null;
}
export interface LaunchTicket {
  readonly ticketId: string;
  readonly requestId: string;
  readonly instanceId: string;
  readonly generation: string;
  readonly status: 'ISSUED' | 'CLAIMED' | 'CANCELLED';
  readonly claimedPid: number | null;
}
export interface ManagedResource {
  readonly resourceId: string;
  readonly owningInstanceId: string;
  readonly kind: 'auxiliary' | 'socket' | 'temp';
  readonly policyScope: 'foundation';
  readonly generation: string;
  readonly pid: number | null;
  readonly endpoint: string | null;
  readonly credentialRef: string | null;
  readonly observation: 'VERIFIED' | 'ABSENT' | 'UNKNOWN';
  readonly releaseState: 'OWNED' | 'RELEASED' | 'BLOCKED';
}
export interface StoreSnapshot {
  readonly store: StoreIdentity;
  readonly instance: InstanceRecord | null;
  readonly pendingOperation: OperationRecord | null;
}
export interface AcceptOperation {
  readonly requestId: string;
  readonly action: ControlAction;
  readonly payloadHash: string;
  readonly ownerUid: number;
  readonly targetInstanceId: string | null;
  readonly acceptedAt: string;
}
export interface EventRecord {
  readonly protocolVersion: 1;
  readonly storeId: string;
  readonly eventId: string;
  readonly seq: string;
  readonly occurredAt: string;
  readonly instanceId: string | null;
  readonly operationId: string | null;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}
export interface ControllerAttemptRecord {
  readonly attemptId: string;
  readonly requestId: string;
  readonly pid: number;
  readonly generation: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly result: string | null;
}
export interface StoragePort extends EventStoragePort, RegistryOperationsPort, RegistryRegistrationPort, RegistryReadPort, RegistryObservationPort, RegistryUpdatePort, RegistryRemovalPort {
  onFailure(callback: (error: SafeError) => void): () => void;
  listTickets(requestId: string): Promise<readonly LaunchTicket[]>;
  reopenOperation(requestId: string): Promise<OperationRecord>;
  retireTicket(ticketId: string, generation: string, claimedPid: number): Promise<void>;
  reconcileInstanceAbsent(instanceId: string, generation: string): Promise<void>;
  readSnapshot(): Promise<StoreSnapshot | null>;
  getOperation(requestId: string): Promise<OperationRecord | null>;
  acceptOperation(intent: AcceptOperation): Promise<{ operation: OperationRecord; accepted: boolean }>;
  resumeBlocked(requestId: string, targetInstanceId: string | null): Promise<OperationRecord>;
  cancelIssuedTickets(requestId: string): Promise<void>;
  prepareShutdown(instanceId: string, generation: string): Promise<void>;
  recordInstanceError(instanceId: string, error: SafeError): Promise<void>;
  blockInstance(instanceId: string, error: SafeError): Promise<void>;
  setOperationPhase(requestId: string, phase: ControlPhase): Promise<void>;
  completeOperation(requestId: string, outcome: Outcome, completedAt: string, error: SafeError | null): Promise<void>;
  issueTicket(ticket: Omit<LaunchTicket, 'status' | 'claimedPid'>): Promise<LaunchTicket>;
  claimTicket(ticketId: string, generation: string, pid: number): Promise<boolean>;
  cancelTicket(ticketId: string): Promise<boolean>;
  getTicket(ticketId: string): Promise<LaunchTicket | null>;
  recordInstance(instance: InstanceRecord): Promise<void>;
  transitionInstance(instanceId: string, next: Lifecycle): Promise<void>;
  saveResource(resource: ManagedResource): Promise<void>;
  listResources(instanceId: string): Promise<readonly ManagedResource[]>;
  recordControllerAttempt(attempt: ControllerAttemptRecord): Promise<void>;
  getControllerAttempt(requestId: string): Promise<ControllerAttemptRecord | null>;
  finishControllerAttempt(attemptId: string, endedAt: string, result: string): Promise<void>;
  close(): Promise<void>;
}

export interface EventStoragePort {
  recordEvents(drafts: readonly import('../protocol/messages.js').EventDraft[]): Promise<void>;
  drainEvents(): Promise<void>;
  captureEventState(): Promise<import('../protocol/messages.js').EventState>;
  getEventState(verify?: boolean): Promise<import('../protocol/messages.js').EventState>;
  listEvents(options?: {highWater?: string; after?: string; limit?: number; maxBytes?: number}): Promise<import('../protocol/messages.js').EventPage>;
}
