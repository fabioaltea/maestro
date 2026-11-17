import { requireUuid, requireDecimal } from '../domain/identifiers.js';
import { foundationError, type ErrorCode } from '../domain/errors.js';
import { DISCOVERY_LIMITS, isDiscoveryFailure } from '../domain/discovery/model.js';
import { canonicalDiscoveryIntent, validateDiscoveryText } from '../domain/discovery/intent.js';
export const DISCOVERY_READ_METHODS = ['discovery.provider.get', 'discovery.preview.get', 'discovery.list', 'discovery.get', 'discovery.questions.list', 'discovery.output.list', 'discovery.document.get', 'discovery.operation.get'] as const;
export const DISCOVERY_ADMISSION_METHODS = ['discovery.provider.configure', 'discovery.provider.check', 'discovery.preview', 'discovery.preview.discard', 'discovery.start', 'discovery.answer', 'discovery.cancel'] as const;
export function discoveryObject(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST'); return value as Record<string, unknown>; }
export function discoveryFields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) throw new Error('INVALID_REQUEST');
}
function uuid(value: unknown) { try { return requireUuid(value); } catch { throw new Error('INVALID_REQUEST'); } }
function revision(value: unknown) { try { if (requireDecimal(value) === '0') throw new Error(); } catch { throw new Error('INVALID_REQUEST'); } }
export function requireDiscoveryCapability(value: unknown) { if (!value || typeof value !== 'object' || (value as { discoveryVersion?: unknown }).discoveryVersion !== 1) throw new Error('UNSUPPORTED_VERSION'); }
export function requireDiscoveryEnvelope(value: unknown) { if (Buffer.byteLength(JSON.stringify(value)) > DISCOVERY_LIMITS.envelopeBytes) throw new Error('CONTEXT_LIMIT'); }
export function validateDiscoveryParams(method: string, input: unknown): void {
  const p = discoveryObject(input); requireDiscoveryEnvelope(p);
  if (method === 'discovery.prepare') { discoveryFields(p, ['intent']); canonicalDiscoveryIntent(p.intent); return; }
  if ((DISCOVERY_ADMISSION_METHODS as readonly string[]).includes(method)) {
    uuid(p.requestId);
    if (method === 'discovery.start') { discoveryFields(p, ['requestId', 'grantId', 'projectId']); uuid(p.grantId); uuid(p.projectId); }
    else if (method === 'discovery.answer') {
      discoveryFields(p, ['requestId', 'grantId', 'questionId', 'kind', 'text']); uuid(p.grantId); uuid(p.questionId);
      if (!['ANSWER', 'UNKNOWN'].includes(String(p.kind)) || typeof p.text !== 'string' || p.kind === 'ANSWER' && !p.text.trim()) throw new Error('INVALID_REQUEST'); validateDiscoveryText(p.text, DISCOVERY_LIMITS.answerBytes);
    } else if (method === 'discovery.cancel') { discoveryFields(p, ['requestId', 'grantId', 'discoveryId']); uuid(p.grantId); uuid(p.discoveryId); }
    else if (method === 'discovery.provider.configure') {
      discoveryFields(p, ['requestId', 'grantId', 'binaryRealpath', 'modelId']); uuid(p.grantId);
      if (typeof p.binaryRealpath !== 'string' || !p.binaryRealpath.startsWith('/') || /[\x00-\x1f\x7f]/.test(p.binaryRealpath)) throw new Error('INVALID_REQUEST');
      validateDiscoveryText(p.binaryRealpath, 4096);
      if (typeof p.modelId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(p.modelId)) throw new Error('INVALID_REQUEST');
    } else if (method === 'discovery.provider.check') { discoveryFields(p, ['requestId', 'expectedProviderRevision']); revision(p.expectedProviderRevision); }
    else if (method === 'discovery.preview.discard') { discoveryFields(p, ['requestId', 'snapshotId']); uuid(p.snapshotId); }
    else {
      discoveryFields(p, ['requestId', 'projectId', 'expectedConfigRevision', 'selectors']); uuid(p.projectId); revision(p.expectedConfigRevision);
      if (!Array.isArray(p.selectors) || !p.selectors.length || p.selectors.length > DISCOVERY_LIMITS.selectors || new Set(p.selectors).size !== p.selectors.length) throw new Error('INVALID_REQUEST');
      for (const selector of p.selectors) {
        if (typeof selector !== 'string' || selector.normalize('NFC') !== selector || (selector !== '.' && (!selector.length || /[\x00-\x1f\x7f\\]/.test(selector) || selector.startsWith('/') || selector.split('/').some(s => !s || s === '..' || s === '.')))) throw new Error('INVALID_REQUEST');
        validateDiscoveryText(selector, 4096);
      }
    }
    return;
  }
  const singles: Record<string, string> = { 'discovery.get': 'discoveryId', 'discovery.operation.get': 'requestId', 'discovery.preview.get': 'snapshotId', 'discovery.document.get': 'revisionId' };
  if (method === 'discovery.provider.get') { discoveryFields(p, []); return; }
  if (Object.hasOwn(singles, method)) {
    const key = singles[method]!; discoveryFields(p, [key], method === 'discovery.document.get' ? ['content', 'cursor'] : method === 'discovery.preview.get' ? ['sources', 'cursor', 'limit'] : []); uuid(p[key]);
    if (Object.hasOwn(p, 'content') && p.content !== true) throw new Error('INVALID_REQUEST');
    if (Object.hasOwn(p, 'sources') && p.sources !== true) throw new Error('INVALID_REQUEST');
    if (p.cursor !== undefined && p.content !== true && p.sources !== true) throw new Error('INVALID_REQUEST');
  } else {
    const lists: Record<string, string> = { 'discovery.list': 'projectId', 'discovery.questions.list': 'discoveryId', 'discovery.output.list': 'runId', 'discovery.eligibility.get': 'projectId' };
    if (!Object.hasOwn(lists, method)) throw new Error('UNSUPPORTED_VERSION');
    discoveryFields(p, [lists[method]!], method === 'discovery.eligibility.get' ? ['checkId'] : ['cursor', 'limit']); uuid(p[lists[method]!]); if (p.checkId !== undefined) uuid(p.checkId);
  }
  if (p.limit !== undefined && (typeof p.limit !== 'number' || !Number.isInteger(p.limit) || p.limit < 1 || p.limit > 20)) throw new Error('INVALID_REQUEST');
  if (p.cursor !== undefined && (typeof p.cursor !== 'string' || !p.cursor.isWellFormed() || !p.cursor.length || Buffer.byteLength(p.cursor) > 4096)) throw new Error('INVALID_REQUEST');
}
export function validateDiscoveryAdmission(value: unknown) {
  const p = discoveryObject(value);
  discoveryFields(p, ['accepted', 'requestId'], p.accepted === true ? ['discoveryId', 'sessionId', 'runId', 'stateRevision', 'snapshotId'] : ['code']);
  if (typeof p.accepted !== 'boolean') throw new Error('INVALID_REQUEST'); uuid(p.requestId);
  for (const key of ['discoveryId', 'sessionId', 'runId', 'snapshotId']) if (p[key] !== undefined) uuid(p[key]);
  if (p.stateRevision !== undefined) revision(p.stateRevision);
  if (p.code !== undefined && !isDiscoveryFailure(p.code)) throw new Error('INVALID_REQUEST');
  requireDiscoveryEnvelope(p);
}
export function publicDiscoveryOperation(input: import('../ports/discovery.js').DiscoveryOperationView) {
  const { requestId, action, phase, outcome, acceptedAt, completedAt, result, error } = input;
  const visible = result === null ? null : Object.fromEntries(Object.entries(result).filter(([key]) =>
    ['snapshotId', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'approvalId', 'providerRevision', 'stateRevision'].includes(key)));
  return { requestId, action, phase, outcome, acceptedAt, completedAt, result: visible, error: error === null ? null : foundationError(error as ErrorCode, { persisted: true, operationId: requestId }) };
}
export function decodeDiscoveryOperationView(value: unknown) {
  const p = discoveryObject(value); discoveryFields(p, ['requestId', 'action', 'phase', 'outcome', 'acceptedAt', 'completedAt', 'result', 'error']); uuid(p.requestId);
  if (!['configure', 'start', 'answer', 'correct', 'approve', 'cancel', 'preview', 'check', 'discard'].includes(String(p.action)) || !['ACCEPTED', 'WORKING', 'FINALIZED'].includes(String(p.phase)) || !['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN'].includes(String(p.outcome))) throw new Error('INVALID_REQUEST');
  for (const key of ['acceptedAt', ...(p.completedAt === null ? [] : ['completedAt'])]) if (typeof p[key] !== 'string' || !Number.isFinite(Date.parse(p[key] as string))) throw new Error('INVALID_REQUEST');
  if ((p.phase === 'FINALIZED') !== (p.completedAt !== null) || (p.outcome === 'IN_PROGRESS' && p.phase === 'FINALIZED') || (p.phase !== 'FINALIZED' && !['IN_PROGRESS', 'UNKNOWN'].includes(String(p.outcome)))) throw new Error('INVALID_REQUEST');
  if (p.result !== null) {
    const result = discoveryObject(p.result); discoveryFields(result, [], ['snapshotId', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'approvalId', 'providerRevision', 'stateRevision']);
    for (const [key, field] of Object.entries(result)) if (key.endsWith('Revision')) revision(field); else uuid(field);
  }
  if (p.error !== null) {
    const error = discoveryObject(p.error);
    if (!isDiscoveryFailure(error.code)) throw new Error('INVALID_REQUEST');
    let expected; try { expected = foundationError(error.code as ErrorCode, { persisted: error.persisted === true, operationId: p.requestId as string }); } catch { throw new Error('INVALID_REQUEST'); }
    if (Object.keys(error).length !== Object.keys(expected).length || Object.entries(expected).some(([key, field]) => error[key] !== field)) throw new Error('INVALID_REQUEST');
  }
  validateDiscoveryText(String(p.action), 32); requireDiscoveryEnvelope(p); return p;
}
