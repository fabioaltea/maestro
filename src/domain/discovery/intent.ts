import { DISCOVERY_LIMITS, type DiscoveryAction, type DiscoveryGrant } from './model.js';

export interface DiscoveryIntent {
  readonly ownerUid: number; readonly storeId: string; readonly action: DiscoveryAction; readonly targetId: string;
  readonly configRevision: string | null; readonly stateRevision: string | null; readonly snapshotId: string | null;
  readonly contextDigest: string | null; readonly providerRevision: string | null;
  readonly providerProfileDigest: string | null; readonly modelId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}
const topKeys = ['ownerUid', 'storeId', 'action', 'targetId', 'configRevision', 'stateRevision', 'snapshotId',
  'contextDigest', 'providerRevision', 'providerProfileDigest', 'modelId', 'payload'];
const payloadKeys: Readonly<Record<DiscoveryAction, readonly string[]>> = {
  configure: ['binaryRealpath', 'binarySha256', 'binaryVersion', 'modelId', 'expectedProviderRevision', 'providerProfileDigest'],
  start: ['snapshotId'], answer: ['questionId', 'questionRevision', 'answerId', 'answerRevision', 'kind', 'text'],
  correct: ['revisionId', 'correctionId', 'correction'], approve: ['revisionId', 'bundleDigest', 'acceptedUnknownIds'],
  cancel: [], preview: ['selectors'], check: [], discard: ['snapshotId'],
};
function invalid(): never { throw new Error('INVALID_REQUEST'); }
function object(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}
export function validateDiscoveryText(value: string, limit: number): void {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') || !Number.isSafeInteger(limit)
    || limit < 0 || new TextEncoder().encode(value).byteLength > limit) invalid();
}
function sorted(value: unknown, depth = 0): unknown {
  if (depth > 5) return invalid();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') { validateDiscoveryText(value, DISCOVERY_LIMITS.envelopeBytes); return value; }
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : invalid();
  if (Array.isArray(value)) {
    if (value.length > DISCOVERY_LIMITS.files) return invalid();
    return value.map(item => sorted(item, depth + 1));
  }
  if (!object(value) || Object.keys(value).length > 32) return invalid();
  return Object.fromEntries(Object.keys(value).sort().map(key => {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) return invalid();
    return [key, sorted(value[key], depth + 1)];
  }));
}
function revision(value: unknown, allowZero = false) {
  if (value === null) return;
  if (typeof value !== 'string' || !(allowZero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(value)
    || BigInt(value) > 9223372036854775807n) invalid();
}
export function canonicalDiscoveryIntent(value: unknown): string {
  if (!object(value) || topKeys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !topKeys.includes(key))) return invalid();
  if (!Number.isSafeInteger(value.ownerUid) || (value.ownerUid as number) < 0
    || typeof value.action !== 'string' || !Object.hasOwn(payloadKeys, value.action) || !object(value.payload)) return invalid();
  for (const key of ['storeId', 'targetId']) {
    if (typeof value[key] !== 'string' || !(value[key] as string).length) return invalid();
    validateDiscoveryText(value[key] as string, 128);
  }
  revision(value.configRevision); revision(value.stateRevision); revision(value.providerRevision, true);
  for (const key of ['contextDigest', 'providerProfileDigest']) {
    if (value[key] !== null && (typeof value[key] !== 'string' || !/^[a-f0-9]{64}$/.test(value[key] as string))) return invalid();
  }
  for (const key of ['snapshotId', 'modelId']) {
    if (value[key] !== null && (typeof value[key] !== 'string' || !(value[key] as string).length)) return invalid();
  }
  if (Object.keys(value.payload).some(key => !payloadKeys[value.action as DiscoveryAction].includes(key))) return invalid();
  const result = JSON.stringify(sorted(value));
  validateDiscoveryText(result, DISCOVERY_LIMITS.envelopeBytes);
  return result;
}
export function validateDiscoveryGrant(grant: Pick<DiscoveryGrant, 'canonicalIntent' | 'expiresAtMs' | 'consumedByRequestId'>,
  intent: string, requestId: string, nowMs: number): 'CONSUME' | 'REPLAY' {
  if (!requestId || intent !== grant.canonicalIntent) throw new Error('APPROVAL_REQUIRED');
  if (grant.consumedByRequestId !== null) {
    if (grant.consumedByRequestId === requestId) return 'REPLAY';
    throw new Error('IDEMPOTENCY_CONFLICT');
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(grant.expiresAtMs) || nowMs >= grant.expiresAtMs
    || grant.expiresAtMs - nowMs > DISCOVERY_LIMITS.grantMs) throw new Error('APPROVAL_REQUIRED');
  return 'CONSUME';
}
