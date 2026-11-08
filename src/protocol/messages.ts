export const MAX_FRAME_BYTES = 64 * 1024;
export const HANDSHAKE_TIMEOUT_MS = 1_000;
export const MAX_CLIENT_BUFFER_BYTES = 1024 * 1024;
export const METHODS = ['status.get', 'diagnostics.get', 'operation.get', 'events.list',
  'events.subscribe', 'subscription.close', 'internal.prepareStop', 'internal.readiness'] as const;

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
export const EVENT_TYPES = ['lifecycle.changed', 'operation.accepted', 'operation.completed', 'operation.failed',
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
