import { join } from 'node:path';
import type { DaemonIntent, LeaseHandle, LocalRole, LocalServer } from '../ports/platform.js';
import type { StoragePort } from '../ports/storage.js';
import { createPlatformPaths } from '../platform/macos/paths.js';
import { createOwnershipLease } from '../platform/macos/lease.js';
import { createLocalTransport } from '../platform/macos/transport.js';
import { openStorage } from '../storage/worker.js';
import { createOperations } from './operations.js';
import { requireUuid } from '../domain/identifiers.js';
import { isEntrypoint, readBootstrap, reportBootstrap } from './entrypoint.js';
import { classifyError } from './control-main.js';

export async function runDaemon(intent: DaemonIntent): Promise<void> {
  let lease: LeaseHandle | undefined;
  let store: StoragePort | undefined;
  let server: LocalServer | undefined;
  try {
    requireUuid(intent.instanceId); requireUuid(intent.ticketId);
    if (typeof intent.canonicalStateDir !== 'string' || !/^[0-9]{1,19}$/.test(intent.generation)) throw new Error('INVALID_REQUEST');
    const adapter = createPlatformPaths();
    const paths = await adapter.resolveArchive(intent.canonicalStateDir, 'read');
    if (!paths) throw new Error('STATE_CORRUPT');
    const lock = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
    if (lock.status !== 'HELD') throw new Error('BLOCKED');
    lease = lock.handle;
    const storage = await openStorage({ path: paths.stateFile });
    store = storage;
    const ticket = await storage.getTicket(intent.ticketId);
    if (!ticket || ticket.instanceId !== intent.instanceId || ticket.generation !== intent.generation
      || !await createOperations(storage, paths.ownerUid).claimLaunch(intent.ticketId, intent.generation, process.pid)) {
      throw new Error('STALE_TARGET');
    }
    await storage.recordInstance({ instanceId: intent.instanceId, pid: process.pid, generation: intent.generation,
      lifecycle: 'STARTING', startedAt: new Date().toISOString(), shutdownPrepared: false, lastError: null });
    const clientKey = await adapter.readCredential(paths.clientKeyFile);
    server = await createLocalTransport().listen(paths.daemonEndpoint, intent.instanceId, async () => {
      const keys = new Map<string, LocalRole>([[clientKey, 'client']]);
      const snapshot = await storage.readSnapshot();
      const pending = snapshot?.pendingOperation;
      if (pending && (pending.successorInstanceId === intent.instanceId || pending.targetInstanceId === intent.instanceId)) {
        const attempt = await storage.getControllerAttempt(pending.requestId);
        if (attempt && attempt.endedAt === null) {
          const key = await adapter.readCredential(join(paths.credentialsDirectory, `controller-${attempt.attemptId}.key`));
          keys.set(key, 'controller');
        }
      }
      return keys;
    }, async (request, peer) => {
      const snapshot = await storage.readSnapshot();
      const instance = snapshot?.instance;
      if (!snapshot || !instance || instance.instanceId !== intent.instanceId) throw new Error('STATE_CORRUPT');
      const base = { protocolVersion: 1 as const, correlationId: request.correlationId };
      if (request.method === 'status.get') return { ...base, result: 'OK' as const, data: {
        storeId: snapshot.store.storeId, instanceId: instance.instanceId, pid: instance.pid,
        generation: instance.generation, lifecycle: instance.lifecycle, ready: instance.lifecycle === 'RUNNING',
        revision: snapshot.store.revision, currentOperation: snapshot.pendingOperation,
        lastError: instance.lastError, pendingFinalization: false,
      } };
      if (request.method === 'internal.readiness') {
        if (peer.role !== 'controller') return { ...base, result: 'ERROR', data: { code: 'UNAUTHORIZED' } };
        if (request.params.expectedInstanceId !== intent.instanceId || request.params.launchGeneration !== intent.generation) {
          return { ...base, result: 'ERROR', data: { code: 'STALE_TARGET' } };
        }
        return { ...base, result: 'OK', data: { identity: intent.instanceId, generation: intent.generation,
          ready: instance.lifecycle === 'RUNNING' } };
      }
      if (request.method === 'internal.prepareStop') {
        const pending = snapshot.pendingOperation;
        if (peer.role !== 'controller' || !pending || pending.outcome !== 'IN_PROGRESS'
          || !['stop', 'restart'].includes(pending.action) || pending.requestId !== request.params.requestId
          || pending.targetInstanceId !== intent.instanceId || request.params.targetInstanceId !== intent.instanceId) {
          return { ...base, result: 'ERROR', data: { code: 'UNAUTHORIZED' } };
        }
        const controlLease = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
        if (controlLease.status !== 'BUSY') {
          if (controlLease.status === 'HELD') controlLease.handle.release();
          return { ...base, result: 'ERROR', data: { code: 'UNAUTHORIZED' } };
        }
        if ((await storage.listResources(intent.instanceId)).some(resource => resource.releaseState !== 'RELEASED')) {
          return { ...base, result: 'BLOCKED', data: { code: 'RESOURCE_IDENTITY_UNKNOWN' } };
        }
        await storage.transitionInstance(intent.instanceId, 'STOPPING');
        setImmediate(() => {
          void (async () => {
            await server!.close();
            await storage.close();
            // Keep the main ownership lease until the actual process terminates.
            process.exit(0);
          })().catch(() => { reportBootstrap(false, 'PERSISTENCE_UNAVAILABLE'); });
        });
        return { ...base, result: 'OK', data: { preparingStop: true } };
      }
      return { ...base, result: 'ERROR', data: { code: 'INVALID_REQUEST' } };
    });
    await storage.transitionInstance(intent.instanceId, 'RUNNING');
    reportBootstrap(true);
    // The listening server keeps the process alive; the ownership connection remains held.
  } catch (error) {
    await server?.close();
    try { await store?.close(); } finally { lease?.release(); }
    throw error;
  }
}

if (isEntrypoint(import.meta.url)) {
  try { await runDaemon(await readBootstrap() as unknown as DaemonIntent); }
  catch (error) { reportBootstrap(false, classifyError(error)); process.exitCode = 7; }
}
