import { record, keys, uuid, text } from './validation.ts';
import { CORE_ERRORS } from './core-errors.ts';
import type { Params } from './bridge-contract.ts';
export interface UiEvent { protocolVersion: 1; storeId: string; eventId: string; seq: string; occurredAt: string; instanceId: string | null; operationId: string | null; type: string; payload: Params }
export interface HistoryPage { records: UiEvent[]; firstAvailable: string; highWater: string; nextAfter: string; truncated: boolean; cursor: string }
export const EVENT_TYPES = ['workspace.changed','feature.changed','feature.output.available','feature.revision.changed','feature.approval.changed','artifact.changed', 'discovery.changed', 'discovery.output.available', 'discovery.question.available', 'discovery.document.changed', 'discovery.approval.changed', 'lifecycle.changed', 'operation.accepted', 'operation.completed', 'operation.failed', 'operation.blocked', 'recovery.started', 'recovery.completed', 'resource.blocked', 'authorization.denied', 'diagnostics.degraded'];
export function sequence(value: unknown): string {
  const v = text(value, 19); if (!/^(0|[1-9][0-9]*)$/.test(v) || BigInt(v) > 9223372036854775807n) throw new Error('CLIENT_PROTOCOL_ERROR'); return v;
}
export function encodeActivityCursor(storeId: string, seq: string) { return btoa(JSON.stringify({ storeId: uuid(storeId), seq: sequence(seq) })).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
export function decodeActivityCursor(value: unknown) {
  const input = text(value, 256);
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error('CLIENT_PROTOCOL_ERROR');
  const decoded = record(JSON.parse(atob(input.replaceAll('-', '+').replaceAll('_', '/')))); keys(decoded, ['storeId', 'seq']);
  const storeId = uuid(decoded.storeId), seq = sequence(decoded.seq);
  if (encodeActivityCursor(storeId, seq) !== input) throw new Error('CLIENT_PROTOCOL_ERROR'); return { storeId, seq };
}
export function decodeUiEvent(value: unknown, expectedStoreId: string): UiEvent {
  const p = record(value); keys(p, ['protocolVersion', 'storeId', 'eventId', 'seq', 'occurredAt', 'instanceId', 'operationId', 'type', 'payload']);
  if (p.protocolVersion !== 1 || uuid(p.storeId) !== expectedStoreId || !EVENT_TYPES.includes(String(p.type)) || new TextEncoder().encode(JSON.stringify(p)).byteLength > 16384) throw new Error('CLIENT_PROTOCOL_ERROR');
  uuid(p.eventId); sequence(p.seq); if (p.seq === '0') throw new Error('CLIENT_PROTOCOL_ERROR');
  if (!Number.isFinite(Date.parse(text(p.occurredAt, 64)))) throw new Error('CLIENT_PROTOCOL_ERROR');
  for (const k of ['instanceId', 'operationId']) if (p[k] !== null) uuid(p[k]);
  const payload = record(p.payload);
  keys(payload, ['action', 'outcome', 'from', 'to', 'phase', 'code', 'resourceId', 'correlationId', 'generation', 'scope', 'projectId', 'configRevision', 'observationRevision', 'effect', 'pid', 'count', 'truncated', 'redactedFields', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'state', 'stateRevision', 'watermark', 'workspaceId','featureId','artifactId','approvalId','envelopeId','turnId']);
  const discovery = payload.scope === 'discovery';
  const workspace=payload.scope==='workspace';
  const feature = payload.scope === 'feature', artifact = payload.scope === 'artifact', workflow = feature || artifact || workspace;
  if (String(p.type).startsWith('workspace.')&&!workspace || String(p.type).startsWith('feature.') && !feature || String(p.type).startsWith('artifact.') && !artifact) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (String(p.type).startsWith('discovery.') && !discovery) throw new Error('CLIENT_PROTOCOL_ERROR');
  const enums: Record<string, readonly string[]> = {
    state: workspace ? ['REQUESTED','CREATING','READY','IN_USE','BLOCKED','RECONCILING','REMOVING','REMOVED'] : feature ? ['DRAFT','PLANNING','WAITING_USER','READY_FOR_APPROVAL','APPROVED','NEEDS_REVIEW','ARCHIVED','INTERRUPTED','RECONCILING'] : artifact ? ['RESERVED','SEALED','REFERENCED','ORPHAN','CORRUPT','DISCARDED'] : discovery ? ['PREPARING', 'READY_TO_START', 'RUNNING', 'WAITING_USER', 'READY_FOR_REVIEW', 'UPDATING', 'APPROVED', 'STALE', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'CANCELLING', 'RECONCILING'] : [],
    action: workspace ? ['create','refresh','remove'] : feature ? ['create','revise','archive','approve','handoff','generate','answer','cancel'] : artifact ? ['reserve','append','seal','discard'] : discovery ? ['configure', 'start', 'answer', 'correct', 'approve', 'cancel', 'preview', 'check', 'discard'] : payload.scope === 'project' ? ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE'] : ['start', 'stop', 'restart'], outcome: workflow || discovery ? ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN'] : ['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'],
    from: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'], to: ['STARTING', 'RUNNING', 'RECOVERING', 'STOPPING', 'STOPPED', 'BLOCKED'],
    phase: [...(workflow ? ['WORKING'] : []), 'ACCEPTED', 'PRECHECK', 'SPAWN_INTENT', 'WAIT_READY', 'STOP_REQUESTED', 'DRAINING', 'WAIT_EXIT', 'FINALIZED'], effect: ['CREATED', 'EXISTING', 'UPDATED', 'OBSERVED', 'REMOVED', 'NONE'], scope: ['project', 'discovery','feature','artifact','workspace'],
  };
  for (const [key, value] of Object.entries(payload)) {
    if (enums[key]) { if (!enums[key]!.includes(String(value))) throw new Error('CLIENT_PROTOCOL_ERROR'); }
    else if (['projectId', 'resourceId', 'correlationId', ...(workflow ? ['workspaceId','featureId','artifactId','revisionId','approvalId','envelopeId','turnId','runId'] : []), ...(discovery ? ['discoveryId', 'sessionId', 'runId', 'revisionId'] : [])].includes(key)) uuid(value);
    else if (['generation', 'configRevision', 'observationRevision', ...(discovery || workflow ? ['stateRevision', 'watermark'] : [])].includes(key)) sequence(value);
    else if (key === 'code') { if (!Object.hasOwn(CORE_ERRORS, String(value))) throw new Error('CLIENT_PROTOCOL_ERROR'); }
    else if (key === 'truncated') { if (typeof value !== 'boolean') throw new Error('CLIENT_PROTOCOL_ERROR'); }
    else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new Error('CLIENT_PROTOCOL_ERROR');
  }
  const required: Record<string, string[]> = { 'workspace.changed':['workspaceId'], 'feature.changed':['featureId'], 'feature.output.available':['featureId','turnId','watermark'], 'feature.revision.changed':['featureId','revisionId'], 'feature.approval.changed':['featureId','revisionId'], 'artifact.changed':['artifactId'], 'discovery.output.available': ['discoveryId', 'runId', 'watermark'], 'discovery.question.available': ['discoveryId', 'runId'], 'discovery.document.changed': ['discoveryId', 'revisionId'], 'discovery.approval.changed': ['discoveryId', 'revisionId'] };
  if (required[String(p.type)]?.some(key => !Object.hasOwn(payload, key))) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (['project', 'discovery','feature','artifact','workspace'].includes(String(payload.scope)) && p.operationId === null&&p.type!=='workspace.changed') throw new Error('CLIENT_PROTOCOL_ERROR');
  return p as unknown as UiEvent;
}
export function decodeHistoryPage(value: unknown, storeId: string): HistoryPage {
  const p = record(value); uuid(storeId);
  const firstAvailable = sequence(p.firstAvailable), highWater = sequence(p.highWater), nextAfter = sequence(p.nextAfter);
  if (!Array.isArray(p.records) || p.records.length > 100 || typeof p.truncated !== 'boolean' || new TextEncoder().encode(JSON.stringify(p.records)).byteLength > 61440 || BigInt(firstAvailable) < 1n || BigInt(firstAvailable) > BigInt(highWater) + 1n || BigInt(nextAfter) > BigInt(highWater)) throw new Error('CLIENT_PROTOCOL_ERROR');
  const records = p.records.map(event => decodeUiEvent(event, storeId));
  for (let i = 1; i < records.length; i++) if (BigInt(records[i]!.seq) !== BigInt(records[i - 1]!.seq) + 1n) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (records.length && records.at(-1)!.seq !== nextAfter) throw new Error('CLIENT_PROTOCOL_ERROR');
  const cursor = text(p.cursor, 256), decoded = decodeActivityCursor(cursor);
  if (decoded.storeId !== storeId || decoded.seq !== nextAfter) throw new Error('CLIENT_PROTOCOL_ERROR');
  return { records, firstAvailable, highWater, nextAfter, cursor, truncated: p.truncated };
}
