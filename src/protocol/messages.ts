import {REVIEW_METHODS} from './review.js';
import {SCHEDULER_METHODS} from './scheduler.js';
import {EXECUTION_METHODS} from './execution.js';
import {PROFILE_METHODS} from './profile.js';
import {ENVIRONMENT_METHODS} from './environment.js';
import {WORKSPACE_METHODS} from './workspace.js';
import { FEATURE_METHODS } from './feature.js';
import { DISCOVERY_READ_METHODS, DISCOVERY_ADMISSION_METHODS } from './discovery.js';
export const MAX_FRAME_BYTES = 64 * 1024;
export const HANDSHAKE_TIMEOUT_MS = 1_000;
export const MAX_CLIENT_BUFFER_BYTES = 1024 * 1024;
export const METHODS = [...REVIEW_METHODS,...SCHEDULER_METHODS,...EXECUTION_METHODS,...PROFILE_METHODS,...ENVIRONMENT_METHODS,...WORKSPACE_METHODS, ...FEATURE_METHODS, ...DISCOVERY_READ_METHODS, ...DISCOVERY_ADMISSION_METHODS, 'discovery.prepare', 'status.get', 'diagnostics.get', 'operation.get', 'events.list',
  'events.subscribe', 'subscription.close', 'internal.prepareStop', 'internal.readiness',
  'projects.register', 'projects.list', 'projects.get', 'projects.verify', 'projects.update', 'projects.remove', 'projects.operation.get'] as const;

export interface Hello {
  readonly protocolVersion: 1;
  readonly kind: 'hello';
  readonly token: string;
  readonly clientNonce: string;
}
export interface Welcome {
  readonly protocolVersion: 1;
  readonly kind: 'welcome';
  readonly identity: string;
  readonly role: string;
  readonly clientNonce: string;
  readonly serverNonce: string;
  readonly proof: string;
}
import type { Freshness, Liveness, Outcome } from '../domain/states.js';
import type { SafeError } from '../domain/errors.js';

export interface PublicResult {
  readonly protocolVersion: 1;
  readonly requestId: string | null;
  readonly storeId: string | null;
  readonly instanceId: string | null;
  readonly result: 'OK' | 'BUSY' | 'BLOCKED' | 'ERROR' | 'UNKNOWN_OUTCOME';
  readonly outcome: Outcome | null;
  readonly freshness: Freshness;
  readonly liveness: Liveness;
  readonly data: Readonly<Record<string, unknown>>;
  readonly error: SafeError | null;
}

export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_OUTBOX_BYTES = 64 * 1024;
export const MAX_EVENT_PAGE_BYTES = 60 * 1024;
export const EVENT_TYPES = ['review.changed','scheduler.changed','execution.changed','execution.output.available','profile.changed','environment.changed','environment.output.available','workspace.changed','feature.changed','feature.output.available','feature.revision.changed','feature.approval.changed','artifact.changed', 'discovery.changed', 'discovery.output.available', 'discovery.question.available', 'discovery.document.changed', 'discovery.approval.changed', 'lifecycle.changed', 'operation.accepted', 'operation.completed', 'operation.failed',
  'operation.blocked', 'recovery.started', 'recovery.completed', 'resource.blocked', 'authorization.denied', 'diagnostics.degraded'] as const;
export type EventType = typeof EVENT_TYPES[number];
export interface EventDraft {
  readonly type: EventType;
  readonly instanceId?: string | null;
  readonly operationId?: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}
export interface EventPage {
  readonly records: readonly import('../ports/storage.js').EventRecord[];
  readonly firstAvailable: string;
  readonly highWater: string;
  readonly truncated: boolean;
  readonly nextAfter: string;
}

export interface EventState {
  readonly highWater: string; readonly firstAvailable: string; readonly pendingBytes: number;
  readonly degraded: boolean; readonly errorCode: string | null;
  readonly usage?: {journalBytes: number; logBytes: number; walBytes: number; shmBytes: number; outboxMetadataBytes: number; totalBytes: number;
    limits: {journalBytes: number; logBytes: number; totalBytes: number; temporaryBytes: number; walBytes: number}};
}

export interface StreamEventFrame {
  readonly protocolVersion: 1; readonly kind: 'event'; readonly correlationId: string;
  readonly subscriptionId: string; readonly instanceId: string;
  readonly event: import('../ports/storage.js').EventRecord;
}
