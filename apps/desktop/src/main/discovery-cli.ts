import { isAbsolute } from 'node:path';
import { keys, record, text, uuid, revision } from '../shared/validation.ts';
import { DISCOVERY_MUTATIONS, validateDiscoveryAction } from '../shared/discovery-contract.ts';
import type { CliCommand } from './ports.ts';
export function buildDiscoveryCliArgs(c: CliCommand): string[] {
  const p = c.params ?? {}, args = ['discovery'], positional: string[] = [];
  if ((DISCOVERY_MUTATIONS as readonly string[]).includes(c.action)) uuid(c.requestId); else if (c.requestId !== undefined) throw new Error('INVALID_INPUT');
  const add = (key: string, flag: string) => { if (p[key] !== undefined) args.push(`--${flag}=${text(p[key], 4096)}`); };
  if (c.action === 'provider.get') { keys(p, []); args.push('provider', 'get'); }
  else if (c.action === 'provider.check') { keys(p, ['expectedProviderRevision']); revision(p.expectedProviderRevision); args.push('provider', 'check', `--expected-provider-revision=${p.expectedProviderRevision}`); }
  else if (c.action === 'provider.configure') {
    keys(p, ['grantId', 'binaryRealpath', 'modelId']); uuid(p.grantId);
    const path = text(p.binaryRealpath, 4096); if (!isAbsolute(path) || /[\x00-\x1f\x7f]/.test(path) || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(text(p.modelId, 128))) throw new Error('INVALID_INPUT');
    args.push('provider', 'configure', `--grant=${p.grantId}`, `--binary=${path}`, `--model=${p.modelId}`);
  } else if (c.action === 'prepare') {
    keys(p, ['intent']); const intent = record(p.intent);
    keys(intent, ['ownerUid', 'storeId', 'action', 'targetId', 'configRevision', 'stateRevision', 'snapshotId', 'contextDigest', 'providerRevision', 'providerProfileDigest', 'modelId', 'payload']);
    if (!['configure', 'start', 'answer', 'cancel', 'correct', 'approve'].includes(String(intent.action)) || !Number.isSafeInteger(intent.ownerUid) || Number(intent.ownerUid) < 0) throw new Error('INVALID_INPUT');
    uuid(intent.storeId); uuid(intent.targetId);
    keys(record(intent.payload), intent.action === 'correct' ? ['revisionId', 'correctionId', 'correction'] : intent.action === 'approve' ? ['revisionId', 'bundleDigest', 'acceptedUnknownIds'] : intent.action === 'cancel' ? [] : intent.action === 'answer' ? ['questionId', 'questionRevision', 'answerId', 'answerRevision', 'kind', 'text'] : intent.action === 'start' ? ['snapshotId'] : ['binaryRealpath', 'binarySha256', 'binaryVersion', 'modelId', 'expectedProviderRevision', 'providerProfileDigest']);
    args.push('prepare', '--intent-stdin');
  } else if (c.action === 'preview') {
    validateDiscoveryAction('discovery.preview', p); args.push('preview', `--expected-revision=${p.expectedConfigRevision}`, '--scope-stdin'); positional.push(uuid(p.projectId));
  } else if (c.action === 'preview.get') {
    keys(p, ['snapshotId', 'sources', 'limit', 'cursor']); args.push('preview', 'show'); positional.push(uuid(p.snapshotId)); if (p.sources === true) args.push('--sources'); else if (p.sources !== undefined) throw new Error('INVALID_INPUT');
  } else if (c.action === 'preview.discard') { keys(p, ['snapshotId']); args.push('preview', 'discard'); positional.push(uuid(p.snapshotId)); }
  else if (c.action === 'start') { keys(p, ['projectId', 'grantId']); args.push('start', `--grant=${uuid(p.grantId)}`); positional.push(uuid(p.projectId)); }
  else if (c.action === 'answer') { keys(p, ['questionId', 'grantId', 'kind', 'text']); uuid(p.questionId); uuid(p.grantId);
    if (typeof p.text !== 'string' || !p.text.isWellFormed() || p.text.includes('\0') || Buffer.byteLength(p.text) > 4096 || p.kind === 'ANSWER' && !p.text.trim()) throw new Error('INVALID_INPUT');
    if (!['ANSWER', 'UNKNOWN'].includes(String(p.kind))) throw new Error('INVALID_INPUT'); args.push('answer', `--grant=${p.grantId}`, '--answer-stdin'); positional.push(uuid(p.questionId)); }
  else if (c.action === 'correct' || c.action === 'approve') {
    keys(p, ['discoveryId', 'grantId', ...(c.action === 'correct' ? ['correction'] : ['revisionId', 'bundleDigest', 'acceptedUnknownIds'])]);
    uuid(p.discoveryId); uuid(p.grantId); if (c.action === 'correct') text(p.correction, 4096); else { uuid(p.revisionId); text(p.bundleDigest, 64); if (!Array.isArray(p.acceptedUnknownIds)) throw new Error('INVALID_INPUT'); }
    args.push(c.action, `--grant=${p.grantId}`, '--review-stdin'); positional.push(uuid(p.discoveryId));
  } else if (c.action === 'cancel') { keys(p, ['discoveryId', 'grantId']); args.push('cancel', `--grant=${uuid(p.grantId)}`); positional.push(uuid(p.discoveryId)); }
  else {
    const targets: Record<string, string> = { list: 'projectId', get: 'discoveryId', questions: 'discoveryId', revisions: 'discoveryId', output: 'runId', document: 'revisionId', eligibility: 'projectId', operation: 'requestId' };
    const key = targets[c.action]; if (!key) throw new Error('INVALID_INPUT');
    keys(p, [key, ...(['list', 'questions', 'revisions', 'output'].includes(c.action) ? ['cursor', 'limit'] : c.action === 'document' ? ['content', 'cursor'] : c.action === 'eligibility' ? ['checkId'] : [])]);
    args.push(c.action === 'get' ? 'show' : c.action); positional.push(uuid(p[key]));
    if (c.action === 'document' && p.content !== true) { if (p.content !== undefined) throw new Error('INVALID_INPUT'); args.push('--metadata'); }
    if (p.checkId !== undefined) args.push(`--check-id=${uuid(p.checkId)}`);
  }
  if (p.limit !== undefined) { if (!Number.isInteger(p.limit) || Number(p.limit) < 1 || Number(p.limit) > 20) throw new Error('INVALID_INPUT'); args.push(`--limit=${p.limit}`); }
  add('cursor', c.action === 'output' || c.action === 'document' ? 'after' : 'cursor');
  args.push(`--state-dir=${c.archive}`, '--json'); if (c.requestId) args.push(`--request-id=${c.requestId}`);
  if (positional.length) args.push('--', ...positional); return args;
}
export function discoveryCliInput(c: CliCommand): string | null {
  if (c.namespace !== 'discovery' || !['prepare', 'preview', 'answer', 'correct', 'approve'].includes(c.action)) return null;
  const value = c.action === 'correct' ? { correction: c.params?.correction } : c.action === 'approve' ? { revisionId: c.params?.revisionId, bundleDigest: c.params?.bundleDigest, acceptedUnknownIds: c.params?.acceptedUnknownIds } : c.action === 'answer' ? { kind: c.params?.kind, text: c.params?.text } : c.action === 'prepare' ? c.params?.intent : c.params?.selectors, json = JSON.stringify(value);
  if (typeof json !== 'string' || Buffer.byteLength(json) > 32768) throw new Error('INVALID_INPUT'); return json;
}
