import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { CORE_ERRORS } from '../shared/core-errors.ts';
import { record, keys, text, uuid, revision } from '../shared/validation.ts';
import type { PublicResult, Params } from '../shared/bridge-contract.ts';
import type { CliCommand } from './ports.ts';
import type { Runtime } from './runtime.ts';
export type { CliCommand } from './ports.ts';
export function isMutation(c: CliCommand) { return c.namespace === 'daemon' ? ['start', 'stop', 'restart'].includes(c.action) : ['register', 'verify', 'update', 'remove'].includes(c.action); }
export function buildCliArgs(c: CliCommand): string[] {
  if (!isAbsolute(c.archive) || c.archive.includes('\0')) throw new Error('INVALID_INPUT');
  const allowed = c.namespace === 'daemon' ? ['start', 'stop', 'restart', 'status', 'diagnostics', 'events', 'operation'] : c.namespace === 'project' ? ['register', 'list', 'get', 'verify', 'update', 'remove', 'operation'] : [];
  if (!allowed.includes(c.action)) throw new Error('INVALID_INPUT');
  const p = c.params ?? {}, args = [c.namespace, c.action === 'register' ? 'add' : c.action === 'get' ? 'show' : c.action, `--state-dir=${c.archive}`, '--json'];
  const positional: string[] = [];
  if (isMutation(c)) args.push(`--request-id=${uuid(c.requestId)}`); else if (c.requestId !== undefined) throw new Error('INVALID_INPUT');
  const val = (k: string) => text(p[k], 2048);
  if (c.namespace === 'project') {
    if (c.action === 'register') { keys(p, ['path', 'name', 'baseBranch']); const path = val('path'); if (!isAbsolute(path)) throw new Error('INVALID_INPUT'); positional.push(path); }
    else if (c.action === 'list') { keys(p, ['cursor', 'limit']); args.push('--limit=25'); if (p.cursor !== undefined) args.push(`--cursor=${val('cursor')}`); }
    else if (c.action === 'operation') { keys(p, ['requestId']); positional.push(uuid(p.requestId)); }
    else { keys(p, c.action === 'update' ? ['projectId', 'expectedRevision', 'patch'] : c.action === 'remove' ? ['projectId', 'expectedRevision'] : ['projectId']); positional.push(uuid(p.projectId)); }
    if (['remove', 'update'].includes(c.action)) args.push(`--expected-revision=${revision(p.expectedRevision)}`);
    const patch = c.action === 'update' ? record(p.patch) : c.action === 'register' ? p : {};
    if (c.action === 'update') { keys(patch, ['name', 'baseBranch']); if (!Object.keys(patch).length) throw new Error('INVALID_INPUT'); }
    if (patch.name !== undefined) args.push(`--name=${text(patch.name, 256)}`);
    if (patch.baseBranch === null) args.push('--clear-base-branch'); else if (patch.baseBranch !== undefined) args.push(`--base-branch=${text(patch.baseBranch)}`);
  } else if (c.action === 'operation') { keys(p, ['requestId']); positional.push(uuid(p.requestId)); }
  else if (c.action === 'events') {
    keys(p, ['limit', 'after', 'follow']);
    if (p.follow === true) args.push('--follow'); else { const limit = p.limit ?? 100; if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100) throw new Error('INVALID_INPUT'); args.push(`--limit=${limit}`); }
    if (p.after !== undefined) args.push(`--after=${val('after')}`);
  } else keys(p, []);
  if (positional.length) args.push('--', ...positional);
  return args;
}
const safeFields = new Set(('protocolVersion scope from to generation correlationId redactedFields resourceIssues resourceIssuesTruncated referencePath checkoutAvailability repositoryIdentityStatus hasCommits headKind currentBranch headOid objectFormat baseOid fileStatusScope limitations freshness observedInstanceId startedAt identityState checkoutState referenceState status lifecycle ready observedAt requestedAt completedAt accepted effect action requestId storeId instanceId operationId projectId displayName referenceCheckout baseBranch baseState configRevision expectedRevision observedConfigRevision observationRevision registryRevision createdAt updatedAt removedAt observation availability identity trackedChanges untrackedChanges conflicts error code category cause message nextAction retryable persisted operation result outcome phase projects project tombstone count nextCursor cursor versions package node protocol schema platform os arch health observability resources resourcesTruncated resourceId kind releaseState projectRegistry activeProjects tombstones operations queue active pending capacity oldestWaitMs maxQueueWaitMs fenced total busy blocked failures limits highWater firstAvailable nextAfter records truncated events eventId seq occurredAt type payload pendingBytes degraded errorCode usage journalBytes logBytes walBytes shmBytes outboxMetadataBytes totalBytes temporaryBytes logLimitBytes journalLimitBytes').split(' '));
export function projectSafe(value: unknown, depth = 0): unknown {
  if (depth > 12) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') { if (value.length > 16_384) throw new Error('CLIENT_PROTOCOL_ERROR'); return value; }
  if (Array.isArray(value)) { if (value.length > 1000) throw new Error('CLIENT_PROTOCOL_ERROR'); return value.map(v => projectSafe(v, depth + 1)); }
  const object = record(value), output: Params = {};
  for (const [k, v] of Object.entries(object)) if (safeFields.has(k)) {
    if (k === 'error' && v !== null) { const code = record(v).code; if (typeof code !== 'string' || !Object.hasOwn(CORE_ERRORS, code)) throw new Error('CLIENT_PROTOCOL_ERROR'); output[k] = CORE_ERRORS[code as keyof typeof CORE_ERRORS]; }
    else output[k] = projectSafe(v, depth + 1);
  }
  return output;
}
export function decodeResult(json: string, c: CliCommand): PublicResult {
  try {
    if (Buffer.byteLength(json) > 262_144) throw new Error();
    const p = record(JSON.parse(json));
    if (p.protocolVersion !== 1 || !['OK', 'BUSY', 'BLOCKED', 'ERROR', 'UNKNOWN_OUTCOME'].includes(String(p.result))
      || !['LIVE', 'LAST_KNOWN', 'VOLATILE'].includes(String(p.freshness)) || !['LIVE_VERIFIED', 'ABSENT_VERIFIED', 'UNKNOWN'].includes(String(p.liveness))
      || (p.outcome !== null && !['IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(String(p.outcome)))) throw new Error();
    for (const k of ['requestId', 'storeId', 'instanceId']) if (p[k] !== null) uuid(p[k]);
    if (c.requestId && p.requestId !== c.requestId) throw new Error();
    const data = projectSafe(record(p.data)) as Params;
    let error = null;
    if (p.error !== null) { const code = record(p.error).code; if (typeof code !== 'string' || !Object.hasOwn(CORE_ERRORS, code)) throw new Error(); error = CORE_ERRORS[code as keyof typeof CORE_ERRORS]; }
    if (c.namespace === 'project' && c.action === 'list' && p.result === 'OK' && !Array.isArray(data.projects)) throw new Error();
    if (c.namespace === 'project' && c.action === 'get' && p.result === 'OK') record(data.project);
    return { protocolVersion: 1, requestId: p.requestId as string | null, storeId: p.storeId as string | null, instanceId: p.instanceId as string | null,
      result: p.result as PublicResult['result'], outcome: p.outcome as PublicResult['outcome'], freshness: p.freshness as PublicResult['freshness'], liveness: p.liveness as PublicResult['liveness'], data, error };
  } catch { throw new Error('CLIENT_PROTOCOL_ERROR'); }
}
export function unknownResult(requestId: string): PublicResult {
  return { protocolVersion: 1, requestId, storeId: null, instanceId: null, result: 'UNKNOWN_OUTCOME', outcome: null, freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {}, error: CORE_ERRORS.UNKNOWN_OUTCOME };
}
export class CoreCli {
  readonly runtime: Runtime;
  readonly children = new Set<ChildProcess>();
  private reads = 0; private mutations = 0; private closed = false;
  constructor(runtime: Runtime) { this.runtime = runtime; }
  async call(command: CliCommand): Promise<PublicResult> {
    const args = buildCliArgs(command), mutation = isMutation(command);
    if (this.closed || (mutation ? this.mutations >= 1 : this.reads >= 2)) throw new Error('LOCAL_BUSY');
    if (mutation) this.mutations++; else this.reads++;
    const timeout = mutation ? command.action === 'stop' ? 12_000 : 32_000 : 3_000;
    try {
      const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn(this.runtime.node, [this.runtime.cli, ...args], { env: this.runtime.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
        this.children.add(child);
        const chunks: Buffer[] = []; let bytes = 0, stderr = 0, failed = false;
        const fail = (code: string) => { if (!failed) { failed = true; child.kill('SIGTERM'); reject(new Error(code)); } };
        const timer = setTimeout(() => fail('CLIENT_PROTOCOL_ERROR'), timeout);
        child.stdout.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 262_144) fail('CLIENT_OUTPUT_LIMIT'); else chunks.push(b); });
        child.stderr.on('data', (b: Buffer) => { stderr += b.length; if (stderr > 16_384) fail('CLIENT_OUTPUT_LIMIT'); });
        child.on('error', () => fail('CLIENT_PROTOCOL_ERROR'));
        child.on('close', (_code, signal) => { clearTimeout(timer); this.children.delete(child); if (!failed) { if (signal) reject(new Error('CLIENT_PROTOCOL_ERROR')); else { try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { reject(new Error('CLIENT_PROTOCOL_ERROR')); } } } });
      });
      return decodeResult(stdout, command);
    } catch (error) { if (mutation) return unknownResult(command.requestId!); throw error; }
    finally { if (mutation) this.mutations--; else this.reads--; }
  }
  close() { if (this.closed) return; this.closed = true; for (const child of this.children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
}
