import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArchivePaths, BootstrapIntent, LeaseHandle } from '../ports/platform.js';
import type { ControllerAttemptRecord, OperationRecord, StoragePort } from '../ports/storage.js';
import { createPlatformPaths } from '../platform/macos/paths.js';
import { createOwnershipLease } from '../platform/macos/lease.js';
import { createDaemonLauncher } from '../platform/macos/launcher.js';
import { createProcessIdentity } from '../platform/macos/process-identity.js';
import { createLocalTransport } from '../platform/macos/transport.js';
import { openStorage } from '../storage/worker.js';
import { createOperations } from './operations.js';
import { foundationError, type ErrorCode } from '../domain/errors.js';
import { requireUuid } from '../domain/identifiers.js';
import { isEntrypoint, readBootstrap, reportBootstrap } from './entrypoint.js';
import { executeStop } from './lifecycle.js';

export function classifyError(error: unknown): ErrorCode {
  if (error instanceof Error) {
    try { foundationError(error.message as ErrorCode); return error.message as ErrorCode; }
    catch { return 'INTERNAL_ERROR'; }
  }
  return 'INTERNAL_ERROR';
}

export interface ControlContext {
  readonly paths: ArchivePaths;
  readonly store: StoragePort;
  readonly operation: OperationRecord;
  readonly attempt: ControllerAttemptRecord;
  readonly controlKey: string;
}

async function executeStart(context: ControlContext): Promise<void> {
  const { paths, store, operation, controlKey } = context;
  const snapshot = await store.readSnapshot();
  if (!snapshot) throw new Error('STATE_CORRUPT');
  const transport = createLocalTransport();
  if (snapshot.instance && snapshot.instance.lifecycle !== 'STOPPED') {
    try {
      const clientKey = await createPlatformPaths().readCredential(paths.clientKeyFile);
      const response = await transport.call(paths.daemonEndpoint, clientKey, {
        protocolVersion: 1, correlationId: randomUUID(), method: 'status.get', params: {},
      }, 1_000);
      const data = response.data as Record<string, unknown> | null;
      if (response.result === 'OK' && data?.ready === true && data.instanceId === snapshot.instance.instanceId) return;
    } catch { /* An unreachable endpoint is not proof that its process stopped. */ }
    throw new Error('BLOCKED');
  }
  const probe = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
  if (probe.status !== 'HELD') throw new Error('BLOCKED');
  probe.handle.release();
  await store.setOperationPhase(operation.requestId, 'SPAWN_INTENT');
  const operations = createOperations(store, paths.ownerUid);
  const ticket = await operations.issueLaunch(operation.requestId, randomUUID());
  const observed = await createDaemonLauncher().spawnDaemon({ ticketId: ticket.ticketId,
    generation: ticket.generation, instanceId: ticket.instanceId, canonicalStateDir: paths.directory });
  let exited: {code: number | null} | null = null;
  void observed.exit.then(value => { exited = value; });
  await store.setOperationPhase(operation.requestId, 'WAIT_READY');
  const deadline = performance.now() + 29_000;
  while (performance.now() < deadline) {
    try {
      const response = await transport.call(paths.daemonEndpoint, controlKey, {
        protocolVersion: 1, correlationId: randomUUID(), method: 'internal.readiness',
        params: { expectedInstanceId: ticket.instanceId, launchGeneration: ticket.generation },
      }, 500);
      const data = response.data as Record<string, unknown> | null;
      if (response.result === 'OK' && data?.ready === true && data.identity === ticket.instanceId
        && data.generation === ticket.generation) return;
    } catch { /* Readiness is explicitly verified on a subsequent attempt. */ }
    if (exited !== null) throw new Error('CORE_EXITED_BEFORE_ACCEPTANCE');
    await new Promise<void>(resolve => setTimeout(resolve, 25));
  }
  throw new Error('DEADLINE_EXCEEDED');
}

export async function runControl(intent: BootstrapIntent): Promise<number> {
  let lease: LeaseHandle | undefined;
  let store: StoragePort | undefined;
  let operation: OperationRecord | undefined;
  let attempt: ControllerAttemptRecord | undefined;
  try {
    if (intent.protocolVersion !== 1 || !['start', 'stop', 'restart'].includes(intent.action)
      || typeof intent.canonicalStateDir !== 'string') throw new Error('INVALID_REQUEST');
    requireUuid(intent.requestId);
    const adapter = createPlatformPaths();
    const paths = (await adapter.resolveArchive(intent.canonicalStateDir, 'write'))!;
    const lock = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
    if (lock.status !== 'HELD') { reportBootstrap(false, lock.status === 'BUSY' ? 'BUSY' : 'BLOCKED'); return lock.status === 'BUSY' ? 3 : 4; }
    lease = lock.handle;
    const fresh = !existsSync(paths.stateFile);
    store = await openStorage({ path: paths.stateFile, ...(fresh ? { identity: {
      storeId: randomUUID(), schemaVersion: 1, ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0',
    } } : {}) });
    const snapshot = (await store.readSnapshot())!;
    const existing = await store.getOperation(intent.requestId);
    const accepted = await createOperations(store, paths.ownerUid).accept({ requestId: intent.requestId,
      action: intent.action, canonicalStateDir: paths.directory,
      targetInstanceId: existing ? existing.targetInstanceId : snapshot.instance?.instanceId ?? null });
    operation = accepted.operation;
    if (!accepted.accepted) {
      reportBootstrap(true);
      return operation.outcome === 'SUCCEEDED' ? 0 : operation.outcome === 'BLOCKED' ? 4
        : operation.outcome === 'IN_PROGRESS' ? 3 : 7;
    }
    attempt = { attemptId: randomUUID(), requestId: intent.requestId, pid: process.pid,
      generation: randomUUID(), startedAt: new Date().toISOString(), endedAt: null, result: null };
    await store.recordControllerAttempt(attempt);
    await adapter.createCredential(paths.clientKeyFile);
    const controlKey = await adapter.createCredential(join(paths.credentialsDirectory, `controller-${attempt.attemptId}.key`));
    reportBootstrap(true);
    const context = { paths, store, operation, attempt, controlKey };
    if (intent.action === 'start') await executeStart(context);
    else if (intent.action === 'stop') await executeStop(context, { leases: createOwnershipLease(), identity: createProcessIdentity(), transport: createLocalTransport() });
    else throw new Error('INVALID_REQUEST');
    await store.completeOperation(intent.requestId, 'SUCCEEDED', new Date().toISOString(), null);
    await store.finishControllerAttempt(attempt.attemptId, new Date().toISOString(), 'SUCCEEDED');
    return 0;
  } catch (error) {
    const code = classifyError(error);
    reportBootstrap(false, code);
    if (store && operation?.outcome === 'IN_PROGRESS') {
      const outcome = ['BLOCKED', 'RESOURCE_IDENTITY_UNKNOWN', 'DEADLINE_EXCEEDED'].includes(code) ? 'BLOCKED' : 'FAILED';
      await store.completeOperation(operation.requestId, outcome, new Date().toISOString(), foundationError(code)).catch(() => {});
      if (attempt) await store.finishControllerAttempt(attempt.attemptId, new Date().toISOString(), outcome).catch(() => {});
    }
    return code === 'BUSY' ? 3 : code === 'BLOCKED' ? 4 : code === 'UNAUTHORIZED' ? 6 : 7;
  } finally {
    try { await store?.close(); }
    finally { lease?.release(); }
  }
}

if (isEntrypoint(import.meta.url)) {
  try { process.exitCode = await runControl(await readBootstrap() as unknown as BootstrapIntent); }
  catch (error) { reportBootstrap(false, classifyError(error)); process.exitCode = 7; }
}
