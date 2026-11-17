import { CORE_ERRORS } from './core-errors.ts';
import type { Params } from './bridge-contract.ts';

export const DISCOVERY_ACTIONS = ['discovery.configure', 'discovery.check', 'discovery.preview', 'discovery.discard', 'discovery.start', 'discovery.answer', 'discovery.cancel', 'discovery.correct', 'discovery.approve'] as const;
export const DISCOVERY_BRIDGE_METHODS = ['chooseProviderBinary', 'getDiscoveryProvider', 'checkDiscoveryProvider', 'prepareDiscoveryAction', 'confirmDiscoveryAction', 'cancelDiscoveryAction',
  'listDiscoveries', 'getDiscovery', 'getDiscoveryPreview', 'getDiscoveryOutput', 'getDiscoveryQuestions', 'getDiscoveryDocument', 'getDiscoveryEligibility', 'getDiscoveryOperation'] as const;
export const DISCOVERY_MUTATIONS = ['provider.configure', 'provider.check', 'preview', 'preview.discard', 'start', 'answer', 'cancel', 'correct', 'approve'] as const;
export const DISCOVERY_QUERIES: Readonly<Record<string, { action: string; required: readonly string[]; optional?: readonly string[] }>> = {
  getDiscoveryProvider: { action: 'provider.get', required: [] }, listDiscoveries: { action: 'list', required: ['projectId'], optional: ['limit', 'cursor'] },
  getDiscovery: { action: 'get', required: ['discoveryId'] }, getDiscoveryPreview: { action: 'preview.get', required: ['snapshotId'], optional: ['sources', 'limit', 'cursor'] },
  getDiscoveryOutput: { action: 'output', required: ['runId'], optional: ['limit', 'cursor'] }, getDiscoveryQuestions: { action: 'questions', required: ['discoveryId'], optional: ['limit', 'cursor'] },
  getDiscoveryDocument: { action: 'document', required: ['revisionId'], optional: ['content', 'cursor'] }, getDiscoveryEligibility: { action: 'eligibility', required: ['projectId'], optional: ['checkId'] },
  getDiscoveryOperation: { action: 'operation', required: ['requestId'] },
};
function invalid(): never { throw new Error('INVALID_INPUT'); }
function record(value: unknown): Params { if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return invalid(); return value as Params; }
function fields(p: Params, required: readonly string[], optional: readonly string[] = []) {
  if (required.some(key => !Object.hasOwn(p, key)) || Object.keys(p).some(key => !required.includes(key) && !optional.includes(key))) return invalid();
}
function text(value: unknown, bytes: number, empty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') || !empty && !value.length || new TextEncoder().encode(value).byteLength > bytes) return invalid(); return value;
}
function uuid(value: unknown) { if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(text(value, 36))) return invalid(); }
function revision(value: unknown) { const s = text(value, 19); if (!/^[1-9][0-9]*$/.test(s) || BigInt(s) > 9223372036854775807n) return invalid(); }
function digest(value: unknown) { if (!/^[a-f0-9]{64}$/.test(text(value, 64))) return invalid(); }
function relative(value: unknown) {
  const s = text(value, 4096); if (s.normalize('NFC') !== s || s !== '.' && (s.startsWith('/') || /[\x00-\x1f\x7f\\]/.test(s) || s.split('/').some(part => !part || part === '.' || part === '..'))) return invalid();
}
export function validateDiscoveryAction(action: unknown, input: unknown): Params {
  if (!(DISCOVERY_ACTIONS as readonly unknown[]).includes(action)) return invalid(); const p = record(input);
  if (action === 'discovery.correct' || action === 'discovery.approve') {
    fields(p, ['projectId', 'discoveryId', 'expectedStateRevision', 'revisionId', 'bundleDigest', ...(action === 'discovery.correct' ? ['correction'] : ['acceptedUnknownIds'])]);
    uuid(p.projectId); uuid(p.discoveryId); revision(p.expectedStateRevision); uuid(p.revisionId); digest(p.bundleDigest);
    if (action === 'discovery.correct') { if (!text(p.correction, 4096).trim()) return invalid(); }
    else { if (!Array.isArray(p.acceptedUnknownIds) || p.acceptedUnknownIds.length > 220 || new Set(p.acceptedUnknownIds).size !== p.acceptedUnknownIds.length) return invalid(); p.acceptedUnknownIds.forEach(id => text(id, 256)); }
  } else if (action === 'discovery.answer') {
    fields(p, ['projectId', 'discoveryId', 'questionId', 'expectedStateRevision', 'expectedQuestionRevision', 'expectedAnswerRevision', 'kind', 'text']);
    uuid(p.projectId); uuid(p.discoveryId); uuid(p.questionId); revision(p.expectedStateRevision); revision(p.expectedQuestionRevision);
    const version = text(p.expectedAnswerRevision, 19); if (!/^(0|[1-9][0-9]*)$/.test(version) || BigInt(version) > 9223372036854775807n) return invalid();
    if (!['ANSWER', 'UNKNOWN'].includes(String(p.kind))) return invalid(); text(p.text, 4096, p.kind === 'UNKNOWN'); if (p.kind === 'ANSWER' && !(p.text as string).trim()) return invalid();
  } else if (action === 'discovery.cancel') {
    fields(p, ['projectId', 'discoveryId', 'expectedStateRevision']); uuid(p.projectId); uuid(p.discoveryId); revision(p.expectedStateRevision);
  } else if (action === 'discovery.configure') {
    fields(p, ['providerBinaryHandle', 'modelId', 'expectedProviderRevision']); uuid(p.providerBinaryHandle);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(text(p.modelId, 128))) return invalid(); if (p.expectedProviderRevision !== null) revision(p.expectedProviderRevision);
  } else if (action === 'discovery.check') { fields(p, ['expectedProviderRevision']); revision(p.expectedProviderRevision); }
  else if (action === 'discovery.preview') {
    fields(p, ['projectId', 'expectedConfigRevision', 'selectors']); uuid(p.projectId); revision(p.expectedConfigRevision);
    if (!Array.isArray(p.selectors) || !p.selectors.length || p.selectors.length > 16 || new Set(p.selectors).size !== p.selectors.length) return invalid(); p.selectors.forEach(relative);
  } else if (action === 'discovery.discard') { fields(p, ['projectId', 'snapshotId']); uuid(p.projectId); uuid(p.snapshotId); }
  else {
    fields(p, ['projectId', 'snapshotId', 'expectedConfigRevision', 'expectedProviderRevision', 'contextDigest']); uuid(p.projectId); uuid(p.snapshotId);
    revision(p.expectedConfigRevision); revision(p.expectedProviderRevision); digest(p.contextDigest);
  }
  if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 32000) return invalid(); return p;
}
export function validateDiscoveryBridge(method: string, input: Params): void {
  const base = ['bridgeVersion', 'callId', 'selectionEpoch'];
  if (method === 'prepareDiscoveryAction') { fields(input, [...base, 'action', 'params']); validateDiscoveryAction(input.action, input.params); }
  else if (method === 'confirmDiscoveryAction' || method === 'cancelDiscoveryAction') { fields(input, [...base, 'confirmationId']); uuid(input.confirmationId); }
  else if (method === 'checkDiscoveryProvider') { fields(input, [...base, 'expectedProviderRevision']); revision(input.expectedProviderRevision); }
  else if (method === 'chooseProviderBinary') fields(input, base);
  else {
    const query = DISCOVERY_QUERIES[method]; if (!query) return invalid(); fields(input, [...base, ...query.required], query.optional);
    for (const key of ['projectId', 'snapshotId', 'discoveryId', 'runId', 'revisionId', 'requestId', 'checkId']) if (input[key] !== undefined) uuid(input[key]);
    if (input.limit !== undefined && (!Number.isInteger(input.limit) || Number(input.limit) < 1 || Number(input.limit) > 20)) return invalid();
    if (input.cursor !== undefined) text(input.cursor, 4096);
    if (input.sources !== undefined && input.sources !== true || input.content !== undefined && input.content !== true) return invalid();
  }
}
export function discoveryReceiptAction(action: string): string { return action === 'provider.configure' ? 'configure' : action === 'provider.check' ? 'check' : action === 'preview.discard' ? 'discard' : action; }

const safeKeys = new Set(('answer answerId confirmedAt configuration check requirements providerId revision binaryVersion binarySha256 modelId policyVersion qualificationDigest state checkedAt capabilities code readOnlyAnalysis portableTurns nativeResume localCancellation verifiedRemoteCancellation quotaResetInfo snapshot snapshotId projectId configRevision selectors fileCount byteCount omissions createdAt expiresAtMs pinned items nextCursor sourceId relativePath sha256 byteLength lineCount discovery storeId discoveryId sessionId stateRevision contextDigest providerRevision currentRunId latestDocumentRevisionId updatedAt error operation requestId action phase outcome acceptedAt completedAt result runId revisionId approvalId questionId text reason section status originatingRunId questionRevision run generation seq kind data bytes truncated unavailable revisionNumber parentRevisionId bundleDigest provenanceValidated approval approvedAt acceptedUnknownIds ownerUid chunk offset totalBytes eligible freshness checkId observabilityDegraded').split(' '));
const idKeys = new Set(('answerId snapshotId projectId discoveryId sessionId currentRunId latestDocumentRevisionId storeId requestId runId revisionId approvalId questionId parentRevisionId checkId generation originatingRunId').split(' '));
const revisionKeys = new Set(['revision', 'configRevision', 'stateRevision', 'providerRevision', 'revisionNumber', 'questionRevision']);
function safe(value: unknown, depth = 0, key = ''): unknown {
  if (depth > 12) return invalid();
  if (key === 'error' && value !== null) {
    const code = typeof value === 'string' ? value : record(value).code;
    if (typeof code !== 'string' || !Object.hasOwn(CORE_ERRORS, code)) return invalid();
    return typeof value === 'string' ? code : CORE_ERRORS[code as keyof typeof CORE_ERRORS];
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value) || value < 0) return invalid(); return value; }
  if (typeof value === 'string') {
    text(value, key === 'text' || key === 'reason' ? 8192 : 16384, true);
    if (idKeys.has(key)) uuid(value); else if (revisionKeys.has(key)) revision(value); else if (['sha256', 'binarySha256', 'qualificationDigest', 'contextDigest', 'bundleDigest', 'sourceId'].includes(key)) digest(value);
    else if (key === 'relativePath') relative(value); else if ((key === 'code') && !Object.hasOwn(CORE_ERRORS, value)) return invalid();
    return value;
  }
  if (Array.isArray(value)) { if (value.length > (key === 'selectors' ? 16 : key === 'omissions' ? 32 : key === 'acceptedUnknownIds' ? 220 : 20)) return invalid(); if (key === 'selectors') value.forEach(relative); return value.map(v => safe(v, depth + 1)); }
  const p = record(value), result: Params = {};
  for (const [field, v] of Object.entries(p)) { if (!safeKeys.has(field)) return invalid(); result[field] = safe(v, depth + 1, field); }
  return result;
}
export function validateDiscoveryData(action: string, raw: unknown): Params {
  try {
    const p = record(raw), common = ['storeId', 'observabilityDegraded', 'code', 'error'];
    if (!['provider.get', 'prepare', ...DISCOVERY_MUTATIONS, ...Object.values(DISCOVERY_QUERIES).map(q => q.action)].includes(action)) return invalid();
    const expected = action === 'provider.get' ? ['configuration', 'check', 'requirements'] : action === 'prepare' ? ['grantId', 'canonicalIntent', 'expiresAtMs', 'summary']
      : (DISCOVERY_MUTATIONS as readonly string[]).includes(action) ? ['accepted', 'requestId', 'discoveryId', 'sessionId', 'runId', 'stateRevision', 'snapshotId']
      : action === 'preview.get' ? ['snapshot', 'items', 'nextCursor'] : action === 'get' ? ['discovery'] : action === 'operation' ? ['operation']
      : action === 'document' ? ['revision', 'approval', 'revisionId', 'chunk', 'nextCursor'] : action === 'eligibility' ? ['projectId', 'eligible', 'reason', 'revisionId', 'approvalId', 'contextDigest', 'freshness', 'checkId', 'checkedAt'] : ['items', 'nextCursor'];
    fields(p, [], [...common, ...expected]);
    if (new TextEncoder().encode(JSON.stringify(p)).byteLength > 32768) return invalid();
    if (action === 'prepare' && p.grantId !== undefined) {
      uuid(p.grantId); text(p.canonicalIntent, 32768); if (!Number.isSafeInteger(p.expiresAtMs) || Number(p.expiresAtMs) <= 0) return invalid();
      const summary = record(p.summary); fields(summary, ['action', 'sendsProjectData'], ['projectId', 'snapshotId', 'contextDigest', 'selectors', 'fileCount', 'byteCount', 'omissions', 'providerId', 'providerRevision', 'modelId', 'data', 'revisionId', 'bundleDigest']);
      if (typeof summary.sendsProjectData !== 'boolean') return invalid();
      const { grantId, canonicalIntent, expiresAtMs, summary: _summary, ...rest } = p;
      return { ...safe(rest) as Params, grantId, canonicalIntent, expiresAtMs, summary: { ...safe(Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'sendsProjectData'))) as Params, sendsProjectData: summary.sendsProjectData } };
    }
    if (p.accepted !== undefined) { if (typeof p.accepted !== 'boolean') return invalid(); uuid(p.requestId); }
    if (p.operation !== undefined) {
      const op = record(p.operation); fields(op, ['requestId', 'action', 'phase', 'outcome', 'acceptedAt', 'completedAt', 'result', 'error']); uuid(op.requestId);
      if (!['configure', 'check', 'preview', 'discard', 'start', 'answer', 'correct', 'approve', 'cancel'].includes(String(op.action)) || !['ACCEPTED', 'WORKING', 'FINALIZED'].includes(String(op.phase))
        || !['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED', 'UNKNOWN'].includes(String(op.outcome)) || (op.phase === 'FINALIZED') !== (op.completedAt !== null)
        || op.phase === 'FINALIZED' && op.outcome === 'IN_PROGRESS' || op.phase !== 'FINALIZED' && !['IN_PROGRESS', 'UNKNOWN'].includes(String(op.outcome))) return invalid();
      if (op.result !== null) fields(record(op.result), [], ['snapshotId', 'discoveryId', 'sessionId', 'runId', 'revisionId', 'approvalId', 'providerRevision', 'stateRevision']);
    }
    if (p.chunk !== undefined) {
      const chunk = record(p.chunk); fields(chunk, ['data', 'byteLength', 'offset', 'totalBytes', 'sha256']); digest(chunk.sha256);
      if (!Number.isInteger(chunk.byteLength) || Number(chunk.byteLength) < 0 || Number(chunk.byteLength) > 8192 || !Number.isInteger(chunk.offset) || Number(chunk.offset) < 0
        || !Number.isInteger(chunk.totalBytes) || Number(chunk.totalBytes) < 0 || Number(chunk.totalBytes) > 262144 || Number(chunk.offset) + Number(chunk.byteLength) > Number(chunk.totalBytes)) return invalid();
      const encoded = text(chunk.data, 10924, true), decoded = atob(encoded); if (decoded.length !== chunk.byteLength || btoa(decoded) !== encoded) return invalid();
    }
    const { accepted, ...rest } = p;
    return { ...safe(rest) as Params, ...(accepted === undefined ? {} : { accepted }) };
  } catch { throw new Error('CLIENT_PROTOCOL_ERROR'); }
}
