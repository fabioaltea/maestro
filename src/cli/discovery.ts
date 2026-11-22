import { parseArgs } from 'node:util';
import { isAbsolute } from 'node:path';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { requireUuid } from '../domain/identifiers.js';
import { canonicalDiscoveryIntent } from '../domain/discovery/intent.js';
import { LocalClient } from '../client/local-client.js';
import { createClientBackend, failureResult } from '../bootstrap.js';
import { classifyError } from '../core/control-main.js';
import { projectExitCode } from './projects.js';
import type { PublicResult } from '../protocol/messages.js';
const HELP = `maestro discovery provider get
maestro discovery provider configure --binary ABS --model ID --grant UUID
maestro discovery provider check --expected-provider-revision REV
maestro discovery preview PROJECT --expected-revision REV --scope-file FILE
maestro discovery preview show SNAPSHOT [--sources --limit N --cursor C]
maestro discovery preview discard SNAPSHOT
maestro discovery prepare --intent-file FILE
maestro discovery start PROJECT --grant UUID
maestro discovery list PROJECT [--limit N --cursor C]
maestro discovery show DISCOVERY
maestro discovery revisions DISCOVERY [--limit N --cursor C]
maestro discovery questions DISCOVERY [--limit N --cursor C]
maestro discovery answer QUESTION --answer-file FILE --grant UUID
maestro discovery cancel DISCOVERY --grant UUID
maestro discovery correct DISCOVERY --review-file FILE --grant UUID
maestro discovery approve DISCOVERY --review-file FILE --grant UUID
maestro discovery eligibility PROJECT [--check-id UUID]
maestro discovery output RUN [--limit N --after C]
maestro discovery document REVISION [--metadata | --after C]
maestro discovery operation REQUEST
--state-dir ABS --json --timeout-ms MS
Mutazioni: --request-id UUID; la risposta attesta admission, non fine del modello.
scope-file: array JSON di selettori relativi; intent-file: intent canonico chiuso.
Per pipe JSON: --scope-stdin, --intent-stdin, --answer-stdin o --review-stdin, alternativi al file.
Risposta incerta: interrogare operation con lo stesso UUID, senza un nuovo start.
`;
async function jsonFile(path: string | undefined): Promise<unknown> {
  if (!path) throw new Error('INVALID_REQUEST');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > 32768n) throw new Error('INVALID_REQUEST');
    const bytes = Buffer.alloc(32769); let offset = 0;
    while (offset < bytes.length) { const result = await file.read(bytes, offset, bytes.length - offset, null); if (!result.bytesRead) break; offset += result.bytesRead; }
    const after = await file.stat({ bigint: true });
    if (offset > 32768 || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('INVALID_REQUEST');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)));
  } finally { await file.close(); }
}
async function jsonStdin(): Promise<unknown> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const timer = setTimeout(() => finish(new Error('DEADLINE_EXCEEDED')), 2000);
    const data = (raw: Buffer) => { size += raw.length; if (size > 32768) finish(new Error('INVALID_REQUEST')); else chunks.push(raw); };
    const end = () => finish(); const error = () => finish(new Error('INVALID_REQUEST'));
    function finish(problem?: Error) {
      if (done) return; done = true; clearTimeout(timer);
      process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', error);
      if (problem) { process.stdin.destroy(); reject(problem); } else resolve(Buffer.concat(chunks));
    }
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', error);
  });
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
export async function runDiscoveryCli(args: readonly string[]): Promise<number> {
  let json = args.includes('--json'); let result: PublicResult; let requestId: string | null = null;
  try {
    const { values, positionals } = parseArgs({ args: [...args], strict: true, allowPositionals: true, options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, 'state-dir': { type: 'string' }, 'timeout-ms': { type: 'string' }, limit: { type: 'string' }, cursor: { type: 'string' }, after: { type: 'string' }, sources: { type: 'boolean' }, metadata: { type: 'boolean' }, 'check-id': { type: 'string' },
      'request-id': { type: 'string' }, grant: { type: 'string' }, 'scope-file': { type: 'string' }, 'intent-file': { type: 'string' }, 'answer-file': { type: 'string' }, 'review-file': { type: 'string' }, 'review-stdin': { type: 'boolean' }, 'scope-stdin': { type: 'boolean' }, 'intent-stdin': { type: 'boolean' }, 'answer-stdin': { type: 'boolean' },
      'expected-revision': { type: 'string' }, 'expected-provider-revision': { type: 'string' }, binary: { type: 'string' }, model: { type: 'string' } } });
    json = values.json ?? false;
    if (values.help) { process.stdout.write(HELP); return 0; }
    if (values['state-dir'] !== undefined && !isAbsolute(values['state-dir'])) throw new Error('INVALID_REQUEST');
    if (values.cursor !== undefined && values.after !== undefined) throw new Error('INVALID_REQUEST');
    for (const option of ['limit', 'timeout-ms'] as const) if (values[option] !== undefined && !/^[1-9][0-9]*$/.test(values[option])) throw new Error('INVALID_REQUEST');
    const command = positionals[0]; let method: string, params: Record<string, unknown>;
    const allowed = new Set(['json', 'help', 'state-dir', 'timeout-ms']);
    if (command === 'provider' && positionals[1] === 'get' && positionals.length === 2) { method = 'discovery.provider.get'; params = {}; }
    else if (command === 'provider' && positionals[1] === 'configure' && positionals.length === 2) { method = 'discovery.provider.configure'; params = { grantId: values.grant, binaryRealpath: values.binary, modelId: values.model }; for (const key of ['grant', 'binary', 'model', 'request-id']) allowed.add(key); }
    else if (command === 'provider' && positionals[1] === 'check' && positionals.length === 2) { method = 'discovery.provider.check'; params = { expectedProviderRevision: values['expected-provider-revision'] }; allowed.add('expected-provider-revision'); allowed.add('request-id'); }
    else if (command === 'preview' && positionals[1] === 'show' && positionals.length === 3) { method = 'discovery.preview.get'; params = { snapshotId: positionals[2], ...(values.sources ? { sources: true } : {}) }; for (const key of ['sources', 'limit', 'cursor']) allowed.add(key); }
    else if (command === 'preview' && positionals[1] === 'discard' && positionals.length === 3) { method = 'discovery.preview.discard'; params = { snapshotId: positionals[2] }; allowed.add('request-id'); }
    else if (command === 'preview' && positionals.length === 2) { method = 'discovery.preview'; params = { projectId: positionals[1], expectedConfigRevision: values['expected-revision'] }; for (const key of ['scope-file', 'scope-stdin', 'expected-revision', 'request-id']) allowed.add(key); }
    else if (command === 'prepare' && positionals.length === 1) { method = 'discovery.prepare'; params = {}; allowed.add('intent-file'); allowed.add('intent-stdin'); }
    else if (command === 'start' && positionals.length === 2) { method = 'discovery.start'; params = { projectId: positionals[1], grantId: values.grant }; allowed.add('grant'); allowed.add('request-id'); }
    else if (command === 'answer' && positionals.length === 2) { method = 'discovery.answer'; params = { questionId: positionals[1], grantId: values.grant }; for (const key of ['grant', 'request-id', 'answer-file', 'answer-stdin']) allowed.add(key); }
    else if ((command === 'correct' || command === 'approve') && positionals.length === 2) { method = `discovery.${command}`; params = { discoveryId: positionals[1], grantId: values.grant }; for (const key of ['grant', 'request-id', 'review-file', 'review-stdin']) allowed.add(key); }
    else if (command === 'cancel' && positionals.length === 2) { method = 'discovery.cancel'; params = { discoveryId: positionals[1], grantId: values.grant }; allowed.add('grant'); allowed.add('request-id'); }
    else {
      if (positionals.length !== 2) throw new Error('INVALID_REQUEST');
      const methods: Record<string, [string, string]> = { list: ['discovery.list', 'projectId'], show: ['discovery.get', 'discoveryId'], questions: ['discovery.questions.list', 'discoveryId'], revisions: ['discovery.revisions.list', 'discoveryId'], output: ['discovery.output.list', 'runId'], document: ['discovery.document.get', 'revisionId'], operation: ['discovery.operation.get', 'requestId'], eligibility: ['discovery.eligibility.get', 'projectId'] };
      if (!command || !Object.hasOwn(methods, command)) throw new Error('INVALID_REQUEST');
      const [name, key] = methods[command]!; method = name; params = { [key]: positionals[1] };
      if (['list', 'questions', 'revisions', 'output', 'document'].includes(command)) for (const key of ['limit', 'cursor', 'after']) allowed.add(key);
      if (command === 'document') allowed.add('metadata'); if (command === 'eligibility') allowed.add('check-id');
      if (command === 'document' && !values.metadata) params.content = true;
    }
    for (const [key, value] of Object.entries(values)) if (value !== undefined && !allowed.has(key)) throw new Error('INVALID_REQUEST');
    if (allowed.has('request-id')) requestId = requireUuid(values['request-id'] ?? randomUUID());
    if (method === 'discovery.preview') { if (!!values['scope-file'] === !!values['scope-stdin']) throw new Error('INVALID_REQUEST'); params.selectors = values['scope-stdin'] ? await jsonStdin() : await jsonFile(values['scope-file']); }
    if (method === 'discovery.prepare') { if (!!values['intent-file'] === !!values['intent-stdin']) throw new Error('INVALID_REQUEST'); params.intent = JSON.parse(canonicalDiscoveryIntent(values['intent-stdin'] ? await jsonStdin() : await jsonFile(values['intent-file']))); }
    if (method === 'discovery.correct' || method === 'discovery.approve') {
      if (!!values['review-file'] === !!values['review-stdin']) throw new Error('INVALID_REQUEST');
      const body = values['review-stdin'] ? await jsonStdin() : await jsonFile(values['review-file']);
      const expected = method === 'discovery.correct' ? 'correction' : 'acceptedUnknownIds,bundleDigest,revisionId';
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== expected) throw new Error('INVALID_REQUEST'); Object.assign(params, body);
    }
    if (method === 'discovery.answer') {
      if (!!values['answer-file'] === !!values['answer-stdin']) throw new Error('INVALID_REQUEST');
      const body = values['answer-stdin'] ? await jsonStdin() : await jsonFile(values['answer-file']);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'kind,text') throw new Error('INVALID_REQUEST');
      Object.assign(params, body);
    }
    if (values.limit !== undefined) params.limit = Number(values.limit);
    if (values.cursor !== undefined || values.after !== undefined) params.cursor = values.cursor ?? values.after;
    if (values['check-id'] !== undefined) params.checkId = values['check-id'];
    result = await new LocalClient(createClientBackend()).runDiscovery(method, params, { ...(values['state-dir'] ? { stateDirectory: values['state-dir'] } : {}), ...(values['timeout-ms'] ? { timeoutMs: Number(values['timeout-ms']) } : {}), ...(requestId ? { requestId } : {}) });
  } catch (error) { result = failureResult(classifyError(error), requestId); }
  await new Promise<void>((resolve, reject) => process.stdout.write((json ? JSON.stringify(result) : (result.requestId ? `requestId: ${result.requestId}\n` : '') + (result.error ? `${result.error.code}: ${result.error.message}\n${result.error.nextAction}` : JSON.stringify(result.data, null, 2))) + '\n', error => error ? reject(error) : resolve()));
  return projectExitCode(result);
}
