import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, realpath, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRuntimePort, AgentProcessIdentity, AgentExitProof } from '../../../ports/agent-runtime.js';
import { DISCOVERY_RUNTIME_POLICY } from '../../../ports/agent-runtime.js';
import type { ArchivePaths, ProcessIdentity } from '../../../ports/platform.js';
import type { StoragePort } from '../../../ports/storage.js';
import type { DiscoveryMetadataData, DiscoveryMetadataQuery, DiscoveryMetadataChange } from '../../../ports/discovery.js';
import { DISCOVERY_LIMITS as limits, isDiscoveryFailure, type DiscoveryResult } from '../../../domain/discovery/model.js';
import { requireUuid } from '../../../domain/identifiers.js';
import { createPlatformPaths } from '../paths.js';
import { createLocalTransport } from '../transport.js';
import { createProcessIdentity } from '../process-identity.js';
import { readHostProof, validateHostProof, type HostProof } from './agent-proof.js';
import type { AgentBootstrap } from './agent-host.js';

export interface AgentRuntimeOptions {
  readonly paths: ArchivePaths; readonly instanceId: string;
  readonly storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'readSnapshot' | 'getDiscoveryRunOwner'>;
  /** Trusted composition seam, absent from production and from every public DTO. */
  readonly providerModuleUrl?: string;
  readonly observeHost?: (child: ChildProcess) => void;
  readonly processIdentity?: Pick<ProcessIdentity, 'probeAbsent'>;
  readonly onStdout?: (identity: AgentProcessIdentity, bytes: Uint8Array) => Promise<void>;
  readonly onExit?: (identity: AgentProcessIdentity, proof: AgentExitProof) => Promise<void>;
}
interface OwnedHost {
  identity: AgentProcessIdentity; child: ChildProcess; key: string; fingerprint: string; closed: Promise<void>; queue: Promise<void>; exited: boolean; ready: Promise<void>; goSent: boolean;
}
function fail(code: string): never { throw new Error(code); }
const inside = (root: string, path: string) => { const suffix = relative(root, path); return suffix === '' || !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../'); };
function error(error: unknown): { readonly ok: false; readonly code: import('../../../domain/discovery/model.js').DiscoveryFailure } { return { ok: false, code: error instanceof Error && isDiscoveryFailure(error.message) ? error.message : 'RESOURCE_IDENTITY_UNKNOWN' }; }
export function createAgentRuntime(options: AgentRuntimeOptions): AgentRuntimePort {
  let draining = false;
  const settled = new Map<string, { identity: AgentProcessIdentity; proof: AgentExitProof; fingerprint: string }>();
  const owned = new Map<string, OwnedHost>(), paths = options.paths, storage = options.storage;
  const platform = createPlatformPaths(), transport = createLocalTransport(), processes = options.processIdentity ?? createProcessIdentity();
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    if (!storage.readDiscoveryMetadata) fail('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.readDiscoveryMetadata(query); if (!result.ok) fail(result.code); return result.value.data;
  }
  async function commit(change: DiscoveryMetadataChange) { if (!storage.commitDiscoveryMetadata) fail('DISCOVERY_NOT_INITIALIZED'); const result = await storage.commitDiscoveryMetadata(change); if (!result.ok) fail(result.code); }
  async function identityBinding(identity: AgentProcessIdentity, launch = false) {
    requireUuid(identity.runId); requireUuid(identity.generation); requireUuid(identity.owningInstanceId);
    if (identity.policy !== DISCOVERY_RUNTIME_POLICY || identity.hostEndpoint !== join(paths.runtimeDirectory, `a-${identity.runId}.sock`) || identity.credentialRef !== join(paths.credentialsDirectory, `agent-${identity.runId}.key`)) fail('RESOURCE_IDENTITY_UNKNOWN');
    const run = await meta({ kind: 'run', id: identity.runId }); if (!run || run.generation !== identity.generation) fail('STALE_TARGET');
    const discovery = await meta({ kind: 'discovery', id: run.discoveryId }); if (!discovery || discovery.currentRunId !== run.runId) fail('STALE_TARGET');
    const saved = await meta({ kind: 'process', id: identity.runId });
    if (saved && (saved.generation !== identity.generation || saved.owningInstanceId !== identity.owningInstanceId || saved.hostEndpoint !== identity.hostEndpoint || saved.credentialRef !== identity.credentialRef || identity.hostPid !== null && saved.hostPid !== identity.hostPid || identity.providerPid !== null && saved.providerPid !== identity.providerPid)) fail('RESOURCE_IDENTITY_UNKNOWN');
    if (!storage.getDiscoveryRunOwner || await storage.getDiscoveryRunOwner(identity.runId) !== identity.owningInstanceId) fail('STALE_TARGET');
    if (launch) {
      const snapshot = await storage.readSnapshot();
      if (!snapshot || snapshot.store.ownerUid !== process.getuid!() || snapshot.store.canonicalPath !== paths.directory || snapshot.instance?.lifecycle !== 'RUNNING' || snapshot.instance?.instanceId !== options.instanceId || identity.owningInstanceId !== options.instanceId) fail('STALE_TARGET');
    }
    return { run, saved };
  }
  async function request(identity: AgentProcessIdentity, action: 'OBSERVE' | 'GO' | 'CANCEL', timeout: number, grace?: number) {
    const key = owned.get(identity.runId)?.key ?? await platform.readCredential(identity.credentialRef);
    const response = await transport.call(identity.hostEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(), method: action === 'CANCEL' ? 'internal.prepareStop' : 'internal.readiness',
      params: { expectedInstanceId: identity.runId, launchGeneration: identity.generation, ...(action === 'CANCEL' ? { graceMs: grace } : { action }) } }, Math.max(1, timeout));
    if (response.result !== 'OK' || !response.data || typeof response.data !== 'object') fail('RESOURCE_IDENTITY_UNKNOWN'); return response.data as Record<string, unknown>;
  }
  function cached(identity: AgentProcessIdentity) {
    const own = owned.get(identity.runId); if (!own) return null;
    const expected = own.identity;
    if (identity.generation !== expected.generation || identity.owningInstanceId !== expected.owningInstanceId || identity.hostEndpoint !== expected.hostEndpoint || identity.credentialRef !== expected.credentialRef || identity.policy !== expected.policy || identity.hostPid !== null && identity.hostPid !== expected.hostPid || identity.providerPid !== null && identity.providerPid !== expected.providerPid) fail('RESOURCE_IDENTITY_UNKNOWN');
    return own;
  }
  async function proof(identity: AgentProcessIdentity): Promise<AgentExitProof | null> {
    const completed = settled.get(identity.runId);
    if (completed) {
      const expected = completed.identity;
      if (identity.generation !== expected.generation || identity.owningInstanceId !== expected.owningInstanceId || identity.credentialRef !== expected.credentialRef || identity.hostEndpoint !== expected.hostEndpoint || identity.policy !== expected.policy || identity.hostPid !== null && identity.hostPid !== expected.hostPid || identity.providerPid !== null && identity.providerPid !== expected.providerPid) fail('RESOURCE_IDENTITY_UNKNOWN');
      return completed.proof;
    }
    const current = cached(identity); if (!current) await identityBinding(identity);
    let raw: unknown; try { raw = await readHostProof(identity.credentialRef + '.proof'); } catch { return null; }
    let file: HostProof;
    try { file = validateHostProof(raw, current?.key ?? await platform.readCredential(identity.credentialRef), identity); } catch { return null; }
    const own = owned.get(identity.runId);
    const hostAbsent = own && own.child.pid === file.hostPid && own.exited || await processes.probeAbsent(file.hostPid) === 'ABSENT';
    if (!hostAbsent || identity.hostPid !== null && identity.hostPid !== file.hostPid || identity.providerPid !== null && identity.providerPid !== file.providerPid) return null;
    return { runId: identity.runId, generation: identity.generation, hostExited: true, providerExited: true, outcome: file.outcome, authentication: file.authentication,
      exitCode: file.exitCode, signal: file.signal, error: file.error };
  }
  const runtime: AgentRuntimePort = {
    async launch(input) {
      try {
        if (draining) fail('BLOCKED');
        if (input.deadline.expired()) fail('DEADLINE_EXCEEDED');
        if (typeof input.stdin !== 'string' || !input.stdin.isWellFormed() || Buffer.byteLength(input.stdin) > limits.inputBytes) fail('PROVIDER_CONTEXT_LIMIT');
        const { identity, invocation } = input, { run, saved } = await identityBinding(identity, true);
        if (run.inputDigest !== createHash('sha256').update(input.stdin).digest('hex')) fail('APPROVAL_STALE');
        const fingerprint = createHash('sha256').update(JSON.stringify({ invocation, stdin: input.stdin })).digest('hex');
        const completed = settled.get(identity.runId);
        if (completed) { if (completed.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT'); return { ok: true, value: { ...completed.identity, observation: 'ABSENT' } }; }
        if (settled.size >= limits.archiveDiscoveries * limits.turns) fail('DISCOVERY_LIMIT');
        const previous = owned.get(identity.runId);
        if (previous) { if (previous.fingerprint !== fingerprint || previous.identity.generation !== identity.generation) fail('IDEMPOTENCY_CONFLICT'); await previous.ready; return { ok: true, value: previous.identity }; }
        if (run.phase !== 'SPAWN_INTENT' || saved || run.outcome !== 'RUNNING' || identity.hostPid !== null || identity.providerPid !== null) fail('UNKNOWN_OUTCOME');
        await platform.validateOwnerAndLinks(paths.credentialsDirectory, 'directory'); await platform.validateOwnerAndLinks(paths.runtimeDirectory, 'directory');
        const cwd = await realpath(invocation.cwd), stat = await lstat(cwd);
        if (cwd !== invocation.cwd || !inside(paths.runtimeDirectory, cwd) || cwd === paths.runtimeDirectory || inside(cwd, identity.credentialRef) || inside(cwd, identity.hostEndpoint) || !stat.isDirectory() || stat.uid !== process.getuid!() || (stat.mode & 0o7777) !== 0o700) fail('PROVIDER_UNSAFE');
        const key = await platform.createCredential(identity.credentialRef);
        const credentials = await open(paths.credentialsDirectory, constants.O_RDONLY | constants.O_NOFOLLOW); try { await credentials.sync(); } finally { await credentials.close(); }
        await commit({ kind: 'process', value: identity });
        if (input.deadline.expired()) fail('DEADLINE_EXCEEDED');
        if (draining) fail('BLOCKED');
        const child = fork(fileURLToPath(new URL('./agent-host.js', import.meta.url)), [], { cwd: paths.runtimeDirectory, execArgv: [], env: { PATH: '/usr/bin:/bin', HOME: paths.runtimeDirectory, LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        options.observeHost?.(child);
        let readyResolve!: () => void, readyReject!: (error: Error) => void, closedResolve!: () => void;
        const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; }); void ready.catch(() => {});
        const closed = new Promise<void>(resolve => { closedResolve = resolve; });
        const own: OwnedHost = { identity: { ...identity, hostPid: child.pid ?? null }, child, key, fingerprint, ready, closed, queue: Promise.resolve(), exited: false, goSent: false };
        owned.set(identity.runId, own);
        child.once('exit', () => { own.exited = true; closedResolve(); });
        child.once('error', () => { readyReject(new Error('PROVIDER_UNAVAILABLE')); });
        child.on('message', (raw: unknown) => {
          own.queue = own.queue.then(async () => {
            const m = raw as Record<string, unknown>;
            if (!m || m.runId !== identity.runId || m.generation !== identity.generation) fail('STALE_TARGET');
            if (m.kind === 'agent.ready') {
              if (m.hostPid !== child.pid) fail('RESOURCE_IDENTITY_UNKNOWN');
              const observed = await request(own.identity, 'OBSERVE', Math.min(500, input.deadline.remainingMs())); if (observed.hostPid !== child.pid || observed.phase !== 'WAIT_GO' || observed.providerPid !== null) fail('RESOURCE_IDENTITY_UNKNOWN');
              own.identity = { ...own.identity, observation: 'VERIFIED' }; await commit({ kind: 'process', value: own.identity });
              await commit({ kind: 'run', value: { ...run, phase: 'HOST_READY' }, expectedPhase: 'SPAWN_INTENT', exitVerified: false }); readyResolve();
            } else if (m.kind === 'agent.provider.started') {
              if (!own.goSent || !Number.isSafeInteger(m.providerPid) || Number(m.providerPid) <= 0) fail('RESOURCE_IDENTITY_UNKNOWN');
              own.identity = { ...own.identity, providerPid: Number(m.providerPid) }; await commit({ kind: 'process', value: own.identity });
              const current = await meta({ kind: 'run', id: identity.runId }); if (!current || current.phase !== 'SPAWN_AUTHORIZED') fail('INVALID_TRANSITION');
              await commit({ kind: 'run', value: { ...current, phase: 'PROVIDER_RUNNING', startedAt: new Date().toISOString() }, expectedPhase: 'SPAWN_AUTHORIZED', exitVerified: false });
            } else if (m.kind === 'agent.stdout') {
              if (!own.goSent || typeof m.data !== 'string' || m.data.length > 10924) fail('PROVIDER_PROTOCOL_ERROR');
              const bytes = Buffer.from(m.data, 'base64'); if (bytes.length > limits.chunkBytes || bytes.toString('base64') !== m.data) fail('PROVIDER_PROTOCOL_ERROR');
              await options.onStdout?.(own.identity, bytes);
            } else if (m.kind !== 'agent.exit') fail('INVALID_REQUEST');
          }).catch(error => { readyReject(error instanceof Error ? error : new Error('RESOURCE_IDENTITY_UNKNOWN')); if (child.connected) child.disconnect(); });
        });
        let finalizing = false;
        const finalize = () => {
          if (finalizing || !own.exited) return; finalizing = true;
          void own.queue.then(async () => { const p = await proof(own.identity); if (p) { settled.set(own.identity.runId, { identity: own.identity, proof: p, fingerprint: own.fingerprint }); owned.delete(own.identity.runId); await options.onExit?.(own.identity, p); } }).catch(() => {});
        };
        // Node may omit close after an owner-initiated IPC disconnect. Exit of
        // the captured host plus authenticated provider proof is still required.
        child.once('exit', finalize); child.once('close', finalize);
        await commit({ kind: 'process', value: own.identity });
        const bootstrap: AgentBootstrap = { kind: 'agent.bootstrap', identity: own.identity, invocation, stdin: input.stdin, timeoutMs: limits.runMs, ...(options.providerModuleUrl ? { providerModuleUrl: options.providerModuleUrl } : {}) };
        child.send(bootstrap, error => { if (error) readyReject(new Error('PROVIDER_UNAVAILABLE')); });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await Promise.race([ready, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('DEADLINE_EXCEEDED')), Math.min(1500, input.deadline.remainingMs())); })]); }
        catch (error) { if (child.connected) child.disconnect(); throw error; } finally { clearTimeout(timer); }
        return { ok: true, value: own.identity };
      } catch (e) { return error(e); }
    },
    async authorizeStart(identity) {
      try {
        if (draining) fail('BLOCKED');
        const { run } = await identityBinding(identity, true), own = owned.get(identity.runId);
        if (!own || own.exited) fail('RESOURCE_IDENTITY_UNKNOWN');
        if (own.goSent && ['SPAWN_AUTHORIZED', 'PROVIDER_RUNNING'].includes(run.phase)) return { ok: true, value: undefined };
        if (run.phase !== 'SPAWN_AUTHORIZED') fail('APPROVAL_REQUIRED');
        own.goSent = true; await request(own.identity, 'GO', 1000); return { ok: true, value: undefined };
      } catch (e) { return error(e); }
    },
    async observe(identity) {
      try {
        const own = cached(identity), completed = settled.get(identity.runId);
        if (completed) { await proof(identity); return { ok: true, value: { ...completed.identity, observation: 'ABSENT' } }; }
        const saved = own?.identity ?? (await identityBinding(identity)).saved; if (!saved) fail('RESOURCE_IDENTITY_UNKNOWN');
        const p = await proof(identity); if (p) return { ok: true, value: { ...saved, observation: 'ABSENT' } };
        if (own?.exited) return { ok: true, value: { ...saved, observation: 'UNKNOWN' } };
        const observed = await request(identity, 'OBSERVE', 500);
        if (observed.identity !== identity.runId || observed.generation !== identity.generation || observed.hostPid !== saved.hostPid || observed.providerPid !== null && (!Number.isSafeInteger(observed.providerPid) || Number(observed.providerPid) <= 0) || saved.providerPid !== null && observed.providerPid !== saved.providerPid) fail('RESOURCE_IDENTITY_UNKNOWN');
        return { ok: true, value: { ...saved, providerPid: observed.providerPid === null ? null : Number(observed.providerPid), observation: 'VERIFIED' } };
      } catch (e) { return error(e); }
    },
    async cancel(identity, deadline) {
      if (deadline.expired()) return { ok: false, code: 'DEADLINE_EXCEEDED' };
      const budget = Math.min(limits.cancelMs, deadline.remainingMs());
      const endsAt = performance.now() + budget, remaining = () => Math.max(0, Math.min(deadline.remainingMs(), endsAt - performance.now()));
      if (budget <= 0) return { ok: false, code: 'DEADLINE_EXCEEDED' };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = async (): Promise<DiscoveryResult<AgentExitProof>> => {
        try {
          const own = cached(identity);
          if (own && !own.exited) {
            try { await request(identity, 'CANCEL', Math.min(500, remaining()), Math.min(limits.termGraceMs, Math.max(0, remaining() - 500))); }
            catch { if (own.child.connected) own.child.disconnect(); }
          } else {
            const existing = await proof(identity); if (existing) return { ok: true, value: existing };
            const { saved } = await identityBinding(identity); if (!saved) fail('RESOURCE_IDENTITY_UNKNOWN');
            if (remaining() <= 0) fail('DEADLINE_EXCEEDED');
            try { await request(identity, 'CANCEL', Math.min(500, remaining()), Math.min(limits.termGraceMs, Math.max(0, remaining() - 500))); } catch { /* Only authenticated proof can resolve a lost reply. */ }
          }
          while (remaining() > 0) {
            const p = await proof(identity); if (p) return { ok: true, value: p };
            await new Promise(resolve => setTimeout(resolve, Math.min(15, remaining())));
          }
          fail('RESOURCE_IDENTITY_UNKNOWN');
        } catch (e) { return error(e); }
      };
      try { return await Promise.race([work(), new Promise<DiscoveryResult<AgentExitProof>>(resolve => { timer = setTimeout(() => resolve({ ok: false, code: 'RESOURCE_IDENTITY_UNKNOWN' }), Math.max(0, budget)); })]); }
      finally { clearTimeout(timer); }
    },
    async reconcile(identity) { try { return { ok: true, value: await proof(identity) }; } catch (e) { return error(e); } },
    async stopWithin(deadline) {
      draining = true;
      for (const own of owned.values()) { const result = await runtime.cancel(own.identity, deadline); if (!result.ok) return result; }
      return { ok: true, value: undefined };
    },
  }; return runtime;
}
