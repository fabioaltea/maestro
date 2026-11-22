import {REVIEW_MUTATIONS,reviewBridgeAction,validateReviewData} from '../shared/review-contract.ts';
import {validateSchedulerQueue} from '../shared/scheduler-contract.ts';
import {EXECUTION_MUTATIONS,validateExecutionData} from '../shared/execution-contract.ts';
import {buildExecutionCliArgs,executionCliInput} from './execution-cli.ts';
import {PROFILE_MUTATIONS,validateProfileData} from '../shared/profile-contract.ts';
import {buildProfileCliArgs,profileCliInput} from './profile-cli.ts';
import {ENVIRONMENT_MUTATIONS,validateEnvironmentData} from '../shared/environment-contract.ts';
import {buildEnvironmentCliArgs,environmentCliInput} from './environment-cli.ts';
import {buildFeatureCliArgs,featureCliInput} from './feature-cli.ts';
import {FEATURE_MUTATIONS,validateFeatureData} from '../shared/feature-contract.ts';
import {WORKSPACE_MUTATIONS,validateWorkspaceData} from '../shared/workspace-contract.ts';
import {buildWorkspaceCliArgs,workspaceCliInput} from './workspace-cli.ts';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { CORE_ERRORS } from '../shared/core-errors.ts';
import { record, keys, text, uuid, revision } from '../shared/validation.ts';
import type { PublicResult, Params } from '../shared/bridge-contract.ts';
import type { CliCommand } from './ports.ts';
import type { Runtime } from './runtime.ts';
import { buildDiscoveryCliArgs, discoveryCliInput } from './discovery-cli.ts';
import { DISCOVERY_MUTATIONS, validateDiscoveryData } from '../shared/discovery-contract.ts';
import { validateRepositoryDocuments } from '../shared/repository-documents.ts';
import { validateHistoryData } from '../shared/repository-history-contract.ts';
import { validateCodeData } from '../shared/repository-code-contract.ts';
export type { CliCommand } from './ports.ts';
export function isMutation(c: CliCommand) { return c.namespace==='review'?(REVIEW_MUTATIONS as readonly string[]).includes(c.action):c.namespace==='execution'?(EXECUTION_MUTATIONS as readonly string[]).includes(c.action):c.namespace==='profile'?(PROFILE_MUTATIONS as readonly string[]).includes(c.action):c.namespace==='environment'?(ENVIRONMENT_MUTATIONS as readonly string[]).includes(c.action):c.namespace==='workspace'?(WORKSPACE_MUTATIONS as readonly string[]).includes(c.action):c.namespace === 'feature' ? (FEATURE_MUTATIONS as readonly string[]).includes(c.action) : c.namespace === 'discovery' ? (DISCOVERY_MUTATIONS as readonly string[]).includes(c.action) : c.namespace === 'daemon' ? ['start', 'stop', 'restart'].includes(c.action) : ['register', 'open', 'create', 'verify', 'update', 'remove'].includes(c.action); }
export function reviewCliInput(c:CliCommand){
  if(c.namespace!=='review'||c.action!=='prepare')return null;
  const {action,input:{projectId:_project,stateRevision,...intent}}=reviewBridgeAction(c.params);
  if(action==='integrate')delete intent.reviewId;
  if(action==='candidate.prepare')intent.expectedStateRevision=stateRevision;
  return JSON.stringify({action,intent,expectedRevisions:stateRevision===undefined?{}:{stateRevision}});
}
export function buildCliArgs(c: CliCommand): string[] {
  if (!isAbsolute(c.archive) || c.archive.includes('\0')) throw new Error('INVALID_INPUT');
  if (c.namespace === 'project' && (c.action === 'history' || c.action === 'code')) {
    const p = c.params ?? {};
    keys(p, ['projectId', 'query', 'configRevision']);
    const query = JSON.stringify(record(p.query));
    if (Buffer.byteLength(query) > 12 * 1024) throw new Error('INVALID_INPUT');
    return ['project', c.action, `--state-dir=${c.archive}`, '--json', `--request-id=${uuid(c.requestId)}`,
      `--read-query=${query}`, ...(p.configRevision === undefined ? [] : [`--expected-revision=${revision(p.configRevision)}`]), '--', uuid(p.projectId)];
  }
  if (c.namespace === 'feature') return buildFeatureCliArgs(c);
  if(c.namespace==='review'){
    const args=['review',c.action,`--state-dir=${c.archive}`,'--json'];
    const p=c.params??{},selectors:Record<string,string>={list:'projectId',get:'reviewId',artifact:'artifactId',operation:'requestId',receipt:'integrationId'};
    if(c.action==='complete'){
      keys(p,['integrationId','expectedStateRevision']);return [...args,`--request-id=${uuid(c.requestId)}`,
        `--expected-state-revision=${revision(p.expectedStateRevision)}`,'--',uuid(p.integrationId)];
    }
    if(c.action==='cleanup.preview'&&c.requestId===undefined){
      keys(p,['integrationId','workspaceId']);return [...args,'--',uuid(p.integrationId),uuid(p.workspaceId)];
    }
    if(isMutation(c)){
      keys(p,['grantId']);return [...args,`--request-id=${uuid(c.requestId)}`,`--grant=${uuid(p.grantId)}`];
    }
    if(c.action==='prepare'&&c.requestId===undefined){reviewBridgeAction(p);return [...args,'--input-stdin'];}
    if(!Object.hasOwn(selectors,c.action)||c.requestId!==undefined)throw new Error('INVALID_INPUT');
    const field=selectors[c.action]!;
    keys(p,['operation','receipt'].includes(c.action)?[field]:[field,'cursor']);
    return [...args,...(p.cursor===undefined?[]:[`--cursor=${text(p.cursor,1024)}`]),'--',uuid(p[field])];
  }
  if(c.namespace==='scheduler'){
    const p=c.params??{};
    if(c.action!=='queue.list'||c.requestId!==undefined)throw new Error('INVALID_INPUT');
    keys(p,['projectId','cursor']);
    return ['scheduler','queue.list',`--state-dir=${c.archive}`,'--json',...(p.cursor===undefined?[]:[`--cursor=${text(p.cursor,1024)}`]),
      ...(p.projectId===undefined?[]:['--',uuid(p.projectId)])];
  }
  if(c.namespace==='execution')return buildExecutionCliArgs(c);
  if(c.namespace==='profile')return buildProfileCliArgs(c);
  if(c.namespace==='environment')return buildEnvironmentCliArgs(c);
  if (c.namespace === 'workspace') return buildWorkspaceCliArgs(c);
  if (c.namespace === 'discovery') return buildDiscoveryCliArgs(c);
  const allowed = c.namespace === 'daemon' ? ['start', 'stop', 'restart', 'status', 'diagnostics', 'events', 'operation'] : c.namespace === 'project' ? ['register', 'open', 'create', 'list', 'get', 'documents', 'verify', 'update', 'remove', 'operation'] : [];
  if (!allowed.includes(c.action)) throw new Error('INVALID_INPUT');
  const p = c.params ?? {}, args = [c.namespace, c.action === 'register' ? 'add' : c.action === 'get' ? 'show' : c.action, `--state-dir=${c.archive}`, '--json'];
  const positional: string[] = [];
  if (isMutation(c)) args.push(`--request-id=${uuid(c.requestId)}`); else if (c.requestId !== undefined) throw new Error('INVALID_INPUT');
  const val = (k: string) => text(p[k], 2048);
  if (c.namespace === 'project') {
    if (['register', 'open', 'create'].includes(c.action)) { keys(p, c.action === 'register' ? ['path', 'name', 'baseBranch'] : ['path']); const path = val('path'); if (!isAbsolute(path)) throw new Error('INVALID_INPUT'); positional.push(path); }
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
const safeFields = new Set(('protocolVersion capabilities reviewVersion reviewMethods schedulerVersion schedulerMethods executionVersion executionMethods profileVersion profileMethods entityId reviewId jobId sessionId runId state stateRevision watermark environmentVersion environmentMethods workspaceVersion workspaceMethods featureVersion featureMethods discoveryVersion discoveryMethods projectRegistryVersion scope from to generation correlationId redactedFields resourceIssues resourceIssuesTruncated referencePath checkoutAvailability repositoryIdentityStatus hasCommits headKind currentBranch headOid objectFormat baseOid fileStatusScope limitations freshness observedInstanceId startedAt identityState checkoutState referenceState status lifecycle ready observedAt requestedAt completedAt accepted effect action requestId storeId instanceId operationId projectId displayName referenceCheckout baseBranch baseState configRevision expectedRevision observedConfigRevision observationRevision registryRevision createdAt updatedAt removedAt observation availability identity trackedChanges untrackedChanges conflicts error code category cause message nextAction retryable persisted operation result outcome phase projects project tombstone count nextCursor cursor versions package node protocol schema platform os arch health observability resources resourcesTruncated resourceId kind releaseState projectRegistry activeProjects tombstones operations queue active pending capacity oldestWaitMs maxQueueWaitMs fenced total busy blocked failures limits highWater firstAvailable nextAfter records truncated events eventId seq occurredAt type payload pendingBytes degraded errorCode usage journalBytes logBytes walBytes shmBytes outboxMetadataBytes totalBytes temporaryBytes logLimitBytes journalLimitBytes').split(' '));
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
    const reviewResult=c.namespace==='review'&&(p.result==='OK'||c.action==='operation'||isMutation(c));
    const data: Params = c.namespace === 'project' && c.action === 'history'
      ? p.result === 'OK' ? validateHistoryData(p.data, c.params?.projectId, record(c.params?.query), c.params?.configRevision) : {}
      : c.namespace === 'project' && c.action === 'code'
      ? p.result === 'OK' ? validateCodeData(p.data, c.params?.projectId, record(c.params?.query), c.params?.configRevision) : {}
      : c.namespace === 'project' && c.action === 'documents' && p.result === 'OK'
      ? validateRepositoryDocuments(p.data, c.params?.projectId)
      : c.namespace==='review'?(reviewResult?validateReviewData(c.action,p.data,{...c.params,...(c.requestId?{requestId:c.requestId}:{})}):{}):c.namespace==='scheduler'?(p.result==='OK'?validateSchedulerQueue(p.data,c.params?.projectId):{}):c.namespace==='execution'?validateExecutionData(c.action,p.data):c.namespace==='profile'?validateProfileData(c.action,p.data):c.namespace==='environment'?validateEnvironmentData(c.action,p.data):c.namespace==='workspace'?validateWorkspaceData(c.action,p.data):c.namespace === 'feature' ? validateFeatureData(c.action,p.data) : c.namespace === 'discovery' ? validateDiscoveryData(c.action, p.data) : projectSafe(record(p.data)) as Params;
    if(c.namespace==='review'&&c.action==='operation'&&p.requestId!==c.params?.requestId)throw new Error();
    if(c.namespace==='review'&&c.action==='cleanup.preview'&&data.eligible===true&&(p.freshness!=='LIVE'||p.liveness!=='LIVE_VERIFIED'))throw new Error();
    if(c.namespace==='execution'){
      if(c.action==='operation'&&p.requestId!==c.params?.requestId)throw new Error();
      if(c.action==='get'&&p.result==='OK'&&record(data.session).sessionId!==c.params?.sessionId)throw new Error();
      if(c.action==='provider.get'&&p.result==='OK'&&record(data.provider).providerId!==c.params?.providerId)throw new Error();
      if(c.action==='list'&&Array.isArray(data.items)&&data.items.some(item=>record(item).projectId!==c.params?.projectId))throw new Error();
      if(c.action==='output.list'&&p.result==='OK'&&data.runId!==c.params?.runId)throw new Error();
      if(c.action==='artifact'&&p.result==='OK'&&data.artifactId!==c.params?.artifactId)throw new Error();
      if(data.operation!==undefined){
        const operation=record(data.operation);
        if(operation.requestId!==p.requestId||operation.outcome!=='UNKNOWN'&&operation.outcome!==p.outcome||
           c.action!=='operation'&&operation.action!==c.action)throw new Error();
      }
    }
    if(c.namespace==='profile'){
      if(c.action==='operation'&&p.requestId!==c.params?.requestId)throw new Error();
      if(c.action==='get'&&p.result==='OK'&&record(data.record).entityId!==c.params?.entityId)throw new Error();
      if(c.action==='resolution'&&p.result==='OK'&&record(data.resolution).resolutionId!==c.params?.resolutionId)throw new Error();
      if(c.action==='artifact'&&p.result==='OK'&&data.artifactId!==c.params?.artifactId)throw new Error();
    }
    if(c.namespace==='environment'){
      if(data.accepted===true&&c.workspaceId&&data.workspaceId!==c.workspaceId)throw new Error();
      if(data.accepted===true&&c.jobId&&data.jobId!==c.jobId)throw new Error();
      if(c.action==='operation'&&p.requestId!==c.params?.requestId)throw new Error();
      if(c.action==='get'&&p.result==='OK'&&record(data.environment).workspaceId!==c.params?.workspaceId)throw new Error();
      if(c.action==='job'&&p.result==='OK'&&record(data.job).jobId!==c.params?.jobId)throw new Error();
      if(c.action==='output'&&p.result==='OK'&&data.jobId!==c.params?.jobId)throw new Error();
      if(c.action==='artifact'&&p.result==='OK'&&data.artifactId!==c.params?.artifactId)throw new Error();
      if(c.action==='get'&&p.freshness==='LAST_KNOWN'&&data.currentness!=='UNKNOWN'&&p.result==='OK')throw new Error();
    }
    if(c.namespace==='workspace'){
      if(c.action==='operation'&&p.requestId!==c.params?.requestId)throw new Error();
      if(c.action==='get'&&p.result==='OK'&&record(data.workspace).workspaceId!==c.params?.workspaceId)throw new Error();
      if(c.action==='list'&&p.result==='OK'&&(!Array.isArray(data.items)||data.items.some(item=>record(item).projectId!==c.params?.projectId)))throw new Error();
      if(c.action==='cleanup.get'&&p.result==='OK'&&(data.workspaceId!==c.params?.workspaceId||data.eligible===true&&p.liveness!=='LIVE_VERIFIED'))throw new Error();
    }
    if (c.namespace === 'discovery' && c.action === 'operation' && p.requestId !== c.params?.requestId) throw new Error();
    if (c.namespace === 'discovery' && c.action === 'eligibility' && (p.freshness !== 'LIVE' || p.liveness !== 'LIVE_VERIFIED') && data.eligible === true) throw new Error();
    if (c.namespace === 'feature' && p.result === 'OK') {
      if (c.action === 'approval' && record(data.approval).revisionId !== c.params?.revisionId) throw new Error();
      if (c.action === 'envelope' && record(data.envelope).envelopeId !== c.params?.envelopeId) throw new Error();
      if (c.action === 'planning' && record(data.turn).turnId !== c.params?.turnId) throw new Error();
      if (c.action === 'output' && data.turnId !== c.params?.turnId) throw new Error();
      if (c.action === 'eligibility' && (data.featureId !== c.params?.featureId || typeof data.eligible !== 'boolean'
        || data.eligible && (p.liveness !== 'LIVE_VERIFIED' || data.freshness !== 'CURRENT' || data.reason !== null || typeof data.checkedAt !== 'string')
        || c.params?.checkId !== undefined && p.freshness !== 'LAST_KNOWN' && data.checkId !== c.params.checkId)) throw new Error();
    }
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
  private viewChildren = new Set<ChildProcess>();
  private canceled = new WeakSet<ChildProcess>();
  private readTail:Promise<void>=Promise.resolve(); private viewGeneration=0;
  private reads = 0; private mutations = 0; private closed = false;
  constructor(runtime: Runtime) { this.runtime = runtime; }
  async call(command: CliCommand): Promise<PublicResult> {
    const args = buildCliArgs(command), mutation = isMutation(command);
    if (this.closed || (mutation ? this.mutations >= 1 : this.reads >= 2)) throw new Error('LOCAL_BUSY');
    if (mutation) this.mutations++; else this.reads++;
    const generation=this.viewGeneration,previous=this.readTail;let releaseRead:(()=>void)|undefined;
    if(!mutation)this.readTail=new Promise<void>(resolve=>{releaseRead=resolve;});
    const timeout = command.namespace === 'project' && ['open', 'create'].includes(command.action) ? 64_000 : ['feature','profile'].includes(command.namespace) ? (command.action.startsWith('artifact.import')?30_000:3_000) : ['discovery','workspace','environment','execution','review'].includes(command.namespace) ? 3_000 : mutation ? command.action === 'stop' ? 12_000 : 32_000 : 3_000;
    try {
      if(!mutation){await previous;if(this.closed)throw new Error('CLIENT_READ_CANCELLED');if(command.scope==='view'&&generation!==this.viewGeneration)throw new Error('CLIENT_READ_CANCELLED');}
      const stdout = await new Promise<string>((resolve, reject) => {
        const input = featureCliInput(command) ?? discoveryCliInput(command) ?? workspaceCliInput(command) ?? environmentCliInput(command) ?? profileCliInput(command) ?? executionCliInput(command) ?? reviewCliInput(command);
        const child = spawn(this.runtime.node, [this.runtime.cli, ...args], { env: this.runtime.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        this.children.add(child); if (!mutation && command.scope === 'view') this.viewChildren.add(child);
        const chunks: Buffer[] = []; let bytes = 0, stderr = 0, failed = false;
        const fail = (code: string) => { if (!failed) { failed = true; child.kill('SIGTERM'); reject(new Error(code)); } };
        const timer = setTimeout(() => fail('CLIENT_PROTOCOL_ERROR'), timeout);
        child.stdin.on('error', () => fail('CLIENT_PROTOCOL_ERROR')); child.stdin.end(input ?? undefined);
        child.stdout.on('data', (b: Buffer) => { bytes += b.length; if (bytes > 262_144) fail('CLIENT_OUTPUT_LIMIT'); else chunks.push(b); });
        child.stderr.on('data', (b: Buffer) => { stderr += b.length; if (stderr > 16_384) fail('CLIENT_OUTPUT_LIMIT'); });
        child.on('error', () => fail('CLIENT_PROTOCOL_ERROR'));
        child.on('close', (_code, signal) => { clearTimeout(timer); this.children.delete(child); this.viewChildren.delete(child); if (!failed) { if (this.canceled.has(child)) reject(new Error('CLIENT_READ_CANCELLED')); else if (signal) reject(new Error('CLIENT_PROTOCOL_ERROR')); else { try { resolve(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { reject(new Error('CLIENT_PROTOCOL_ERROR')); } } } });
      });
      return decodeResult(stdout, command);
    } catch (error) { if (mutation) return unknownResult(command.requestId!); throw error; }
    finally { releaseRead?.(); if (mutation) this.mutations--; else this.reads--; }
  }
  async cancelViewReads() {
    this.viewGeneration++;
    await Promise.all([...this.viewChildren].map(async child => {
      if (!this.viewChildren.has(child)) return;
      this.canceled.add(child);
      const exited = once(child, 'close', { signal: AbortSignal.timeout(2000) });
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 250);
      try { await exited; } finally { clearTimeout(timer); }
    }));
  }
  close() { if (this.closed) return; this.closed = true; for (const child of this.children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
}
