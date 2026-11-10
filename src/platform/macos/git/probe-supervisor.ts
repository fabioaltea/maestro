import { fork } from 'node:child_process';
import { lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { requireUuid } from '../../../domain/identifiers.js';
import type { ArchivePaths, ProcessIdentity } from '../../../ports/platform.js';
import type { ManagedResource } from '../../../ports/storage.js';
import type { InspectionResult, ProbeOwnership, ProbeRequest, ProbeSupervisor } from '../../../ports/repository.js';
import { createPlatformPaths } from '../paths.js';
import { createLocalTransport } from '../transport.js';
import { createProcessIdentity } from '../process-identity.js';
import { inspectionFailure } from './runner.js';

export interface ProbeBootstrap {
  readonly kind: 'probe.start'; readonly ownership: ProbeOwnership; readonly request: ProbeRequest;
  readonly endpoint: string; readonly credentialFile: string; readonly timeoutMs: number;
}
interface Options {
  readonly paths: ArchivePaths;
  /** Composition seam for controlled process tests; never accepted on the wire. */
  readonly workerUrl?: URL;
  readonly lifeline?: Readable;
  readonly identity?: ProcessIdentity;
  readonly onResource?: (resource: ManagedResource) => Promise<void>;
}

const interrupted = (): InspectionResult => ({ ok: false, error: inspectionFailure('INTERRUPTED') });
function sameOwner(value: unknown, expected: ProbeOwnership): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.resourceId === expected.resourceId && candidate.generation === expected.generation
    && candidate.owningInstanceId === expected.owningInstanceId && candidate.policyScope === 'foundation';
}

export function createProbeSupervisor(options: Options): ProbeSupervisor {
  const platform = createPlatformPaths();
  const transport = createLocalTransport();
  const identity = options.identity ?? createProcessIdentity({ transport });
  const active = new Map<string, () => Promise<'ABSENT' | 'UNKNOWN'>>();
  let blocked = false;
  let ownerEnded = options.lifeline?.readableEnded ?? false;
  const persist = options.onResource ?? (async () => {});
  options.lifeline?.once('end', () => { ownerEnded = true; for (const cancel of active.values()) void cancel(); });
  options.lifeline?.resume();

  return {
    async start(request, ownership, inspectionOptions) {
      if (ownership.policyScope !== 'foundation') throw new Error('INVALID_REQUEST');
      try { requireUuid(ownership.resourceId); requireUuid(ownership.generation); requireUuid(ownership.owningInstanceId); }
      catch { throw new Error('INVALID_REQUEST'); }
      if (blocked || active.has(ownership.resourceId)) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      if (ownerEnded) throw new Error('INTERRUPTED');
      if (inspectionOptions.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
      if (inspectionOptions.signal?.aborted) throw new Error('INTERRUPTED');
      const own: ProbeOwnership = Object.freeze({ ...ownership });
      const paths = await platform.resolveArchive(options.paths.directory, 'read');
      if (!paths || paths.runtimeDirectory !== options.paths.runtimeDirectory) throw new Error('UNAUTHORIZED');
      const endpoint = join(paths.runtimeDirectory, `p-${own.resourceId}.sock`);
      const credentialFile = join(paths.credentialsDirectory, `p-${own.resourceId}.key`);
      const key = await platform.createCredential(credentialFile);
      const credentialIdentity = await lstat(credentialFile);
      const cleanupCredential = async () => {
        await platform.validateOwnerAndLinks(paths.credentialsDirectory, 'directory');
        const current = await lstat(credentialFile);
        if (!current.isFile() || current.isSymbolicLink() || current.uid !== credentialIdentity.uid
          || current.ino !== credentialIdentity.ino || current.nlink !== 1) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
        await unlink(credentialFile);
      };
      let resource: ManagedResource = { resourceId: own.resourceId, owningInstanceId: own.owningInstanceId,
        kind: 'auxiliary', policyScope: 'foundation', generation: own.generation, pid: null,
        endpoint, credentialRef: credentialFile, observation: 'UNKNOWN', releaseState: 'OWNED' };
      await persist(resource); // Durable resource intent before launch when composed with the core.
      if (ownerEnded || inspectionOptions.signal?.aborted || inspectionOptions.deadline.expired()) {
        await cleanupCredential();
        await persist({ ...resource, observation: 'ABSENT', releaseState: 'RELEASED' });
        throw new Error(inspectionOptions.deadline.expired() ? 'DEADLINE_EXCEEDED' : 'INTERRUPTED');
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
        !/^(GIT_|DYLD_|LD_)/.test(name) && !['NODE_OPTIONS', 'NODE_PATH', 'SSH_ASKPASS'].includes(name)));
      const child = fork(fileURLToPath(options.workerUrl ?? new URL('./probe-main.js', import.meta.url)), [], {
        cwd: paths.directory, execArgv: [], env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      let readyResolve!: () => void, readyReject!: (error: Error) => void;
      const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      void ready.catch(() => {});
      let resultResolve!: (result: InspectionResult) => void;
      const result = new Promise<InspectionResult>(resolve => { resultResolve = resolve; });
      let closeResolve!: () => void;
      const closed = new Promise<void>(resolve => { closeResolve = resolve; });
      let exitResolve!: () => void;
      const exitObserved = new Promise<void>(resolve => { exitResolve = resolve; });
      let exitProof: 'ABSENT' | 'UNKNOWN' = 'UNKNOWN';
      let capturedResult: InspectionResult | undefined;
      let exited = false, executeSent = false;
      let cancellation: Promise<'ABSENT' | 'UNKNOWN'> | undefined;
      const markBlocked = async () => {
        blocked = true;
        resource = { ...resource, observation: 'UNKNOWN', releaseState: 'BLOCKED' };
        await persist(resource);
      };
      const abort = () => { void cancel(); };
      child.once('error', () => readyReject(new Error('INSPECTION_UNAVAILABLE')));
      child.on('message', (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const message = value as Record<string, unknown>;
        if (!sameOwner(message.ownership, own)) return;
        if (message.kind === 'probe.ready') readyResolve();
        if (message.kind === 'probe.result' && message.result && typeof message.result === 'object'
          && Buffer.byteLength(JSON.stringify(message.result)) <= 64 * 1024) {
          const data = message.result as InspectionResult;
          if (typeof data.ok === 'boolean') {
            capturedResult = data;
            if (child.connected) child.send({ kind: 'probe.resultAccepted', ownership: own }, () => {});
          }
        }
      });
      let finalizing = false;
      const finalize = () => {
        if (finalizing) return;
        if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) return;
        finalizing = true;
        void (async () => {
          exited = true;
          exitProof = !executeSent || capturedResult ? 'ABSENT' : 'UNKNOWN';
          exitResolve();
          active.delete(own.resourceId);
          inspectionOptions.signal?.removeEventListener('abort', abort);
          readyReject(new Error('CORE_EXITED_BEFORE_ACCEPTANCE'));
          try {
            // An unexpected worker death after execute is not proof that its Git child exited.
            if (executeSent && !capturedResult) {
              resource = { ...resource, pid: null };
              await markBlocked();
            } else {
              const socket = await platform.inspectStaleSocket(endpoint);
              if (socket) await platform.ownedCleanup(endpoint, socket);
              await cleanupCredential();
              resource = { ...resource, observation: 'ABSENT', releaseState: 'RELEASED' };
              await persist(resource);
            }
          } catch { await markBlocked().catch(() => {}); }
          resultResolve(capturedResult ?? interrupted());
          closeResolve();
        })();
      };
      // IPC result acknowledgement precedes worker exit. Node may omit `close`
      // after a parent-initiated IPC disconnect; `exit` is the process proof.
      child.once('exit', finalize);
      child.once('close', finalize); // Covers spawn errors with no process/exit.

      async function cancel(): Promise<'ABSENT' | 'UNKNOWN'> {
        if (exited) return exitProof;
        if (cancellation) return cancellation;
        cancellation = (async () => {
          try {
            if (await identity.challenge(endpoint, { identity: own.resourceId, generation: own.generation, key }, 300) !== 'VERIFIED') {
              void markBlocked().catch(() => {}); return 'UNKNOWN' as const;
            }
            const response = await transport.call(endpoint, key, { protocolVersion: 1, correlationId: randomUUID(),
              method: 'internal.prepareStop', params: { targetInstanceId: own.resourceId, generation: own.generation } }, 300);
            if (response.result !== 'OK') { void markBlocked().catch(() => {}); return 'UNKNOWN' as const; }
            let timer: ReturnType<typeof setTimeout> | undefined;
            const observed = await Promise.race([exitObserved.then(() => true), new Promise<false>(resolve => {
              timer = setTimeout(() => resolve(false), 750);
            })]);
            clearTimeout(timer);
            if (!observed || exitProof !== 'ABSENT') { void markBlocked().catch(() => {}); return 'UNKNOWN' as const; }
            return 'ABSENT' as const;
          } catch { void markBlocked().catch(() => {}); return 'UNKNOWN' as const; }
        })();
        return cancellation;
      }

      active.set(own.resourceId, cancel);
      let startupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!child.pid) throw new Error('INSPECTION_UNAVAILABLE');
        resource = { ...resource, pid: child.pid };
        await persist(resource);
        const bootstrap: ProbeBootstrap = { kind: 'probe.start', ownership: own, request, endpoint,
          credentialFile, timeoutMs: Math.min(28_000, inspectionOptions.deadline.remainingMs()) };
        child.send(bootstrap, error => { if (error) readyReject(new Error('INSPECTION_UNAVAILABLE')); });
        startupTimer = setTimeout(() => readyReject(new Error('DEADLINE_EXCEEDED')),
          Math.min(1_500, inspectionOptions.deadline.remainingMs()));
        await ready;
        if (await identity.challenge(endpoint, { identity: own.resourceId, generation: own.generation, key },
          Math.min(300, inspectionOptions.deadline.remainingMs())) !== 'VERIFIED') {
          await markBlocked(); throw new Error('RESOURCE_IDENTITY_UNKNOWN');
        }
        resource = { ...resource, observation: 'VERIFIED' };
        await persist(resource);
        clearTimeout(startupTimer);
        executeSent = true;
        child.send({ kind: 'probe.execute', ownership: own }, error => { if (error) void cancel(); });
        inspectionOptions.signal?.addEventListener('abort', abort, { once: true });
        if (inspectionOptions.signal?.aborted || options.lifeline?.readableEnded) abort();
        return Object.freeze({ ownership: own, result, cancel });
      } catch (error) {
        clearTimeout(startupTimer);
        // Closing our IPC lifeline asks the child to abort its own work; no signal or saved PID.
        if (child.connected) child.disconnect();
        await closed;
        throw error;
      }
    },
  };
}
