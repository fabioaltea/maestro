import { drainFoundationAuxiliaries } from './foundation-auxiliary-policy.js';
import { makeDeadline, systemClock } from '../ports/clock.js';
import { randomUUID } from 'node:crypto';
import type { ArchivePaths, BootstrapIntent, LocalTransport, OwnershipLease, PlatformPaths, ProcessIdentity } from '../ports/platform.js';
import type { Deadline } from '../ports/clock.js';
import type { OperationRecord, StoragePort } from '../ports/storage.js';
import { foundationError } from '../domain/errors.js';

export interface RecoveryContext {
  readonly store: StoragePort; readonly paths: ArchivePaths; readonly identity: ProcessIdentity;
  readonly transport: LocalTransport; readonly leases: OwnershipLease; readonly platformPaths: PlatformPaths;
  readonly deadline: Deadline; readonly excludedPids: readonly number[];
  readonly checkpoint: (point: string) => Promise<void>; readonly sleep: (ms: number) => Promise<void>;
}
interface RecoveryInput {
  operation: OperationRecord; requested: { requestId: string; action: string };
  observation: 'READY' | 'ABSENT' | 'UNKNOWN'; ticketStatus: 'ISSUED' | 'CLAIMED' | null;
  currentInstanceId: string | null;
}
export function decideRecovery(input: RecoveryInput): 'COMPLETE' | 'RESUME' | 'INTERRUPT' | 'BLOCKED' | 'HISTORICAL' {
  const { operation: op, requested, observation } = input;
  if (op.requestId === requested.requestId && op.action !== requested.action) throw new Error('IDEMPOTENCY_CONFLICT');
  if (['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(op.outcome)) return 'HISTORICAL';
  if (observation === 'UNKNOWN') return 'BLOCKED';
  if (op.action === 'stop' && observation === 'ABSENT') return 'COMPLETE';
  if (observation === 'READY' && (input.currentInstanceId === op.successorInstanceId
    || (op.action === 'start' && op.successorInstanceId === null && input.currentInstanceId === op.targetInstanceId))) return 'COMPLETE';
  if (requested.requestId === op.requestId && requested.action === op.action) return 'RESUME';
  if (requested.action === 'stop' && op.action !== 'stop') return 'INTERRUPT';
  return 'BLOCKED';
}

async function observe(context: RecoveryContext) {
  const snapshot = await context.store.readSnapshot();
  const instance = snapshot?.instance;
  if (!instance || instance.lifecycle === 'STOPPED') return { observation: 'ABSENT' as const, verified: false };
  try {
    const key = await context.platformPaths.readCredential(context.paths.clientKeyFile);
    const response = await context.transport.call(context.paths.daemonEndpoint, key, { protocolVersion: 1,
      correlationId: randomUUID(), method: 'status.get', params: {} }, Math.min(500, context.deadline.remainingMs()));
    const data = response.data as Record<string, unknown> | null;
    if (response.result === 'OK' && data?.storeId === snapshot!.store.storeId && data.instanceId === instance.instanceId
      && data.generation === instance.generation && data.freshness !== 'VOLATILE') {
      return { observation: data.ready === true ? 'READY' as const : 'UNKNOWN' as const, verified: true };
    }
  } catch { /* Endpoint loss is never proof of process absence. */ }
  return { observation: await context.identity.probeAbsent(instance.pid) === 'ABSENT' ? 'ABSENT' as const : 'UNKNOWN' as const, verified: false };
}

/** Called under the control lease. The daemon lease additionally fences candidate claims. */
export async function recoverAbsentInstance(context: RecoveryContext): Promise<void> {
  const instance = (await context.store.readSnapshot())?.instance;
  if (!instance || instance.lifecycle === 'STOPPED') return;
  if (await context.identity.probeAbsent(instance.pid) !== 'ABSENT') throw new Error('RESOURCE_IDENTITY_UNKNOWN');
  const lease = context.leases.tryAcquire(context.paths.daemonLeaseFile, 'daemon');
  if (lease.status !== 'HELD') throw new Error('BLOCKED');
  try {
    await context.store.recordEvents([{type: 'recovery.started', instanceId: instance.instanceId, payload: {generation: instance.generation}}]);
    await context.checkpoint('recovery.beforeCleanup');
    await drainFoundationAuxiliaries({ ...context, instanceId: instance.instanceId,
      deadline: makeDeadline(systemClock, Math.min(8_000, context.deadline.remainingMs())) });
    const socket = await context.platformPaths.inspectStaleSocket(context.paths.daemonEndpoint);
    if (socket) await context.platformPaths.ownedCleanup(context.paths.daemonEndpoint, socket);
    await context.store.reconcileInstanceAbsent(instance.instanceId, instance.generation);
    await context.checkpoint('recovery.afterCleanup');
  } catch (error) {
    if (error instanceof Error && ['BLOCKED', 'RESOURCE_IDENTITY_UNKNOWN', 'ENDPOINT_COLLISION'].includes(error.message)) {
      await context.store.blockInstance(instance.instanceId, foundationError(error.message as 'BLOCKED', { persisted: true }));
    }
    throw error;
  } finally { lease.handle.release(); }
}

export async function reconcileControl(context: RecoveryContext, requested: BootstrapIntent): Promise<void> {
  const { store } = context;
  const snapshot = (await store.readSnapshot())!;
  const own = await store.getOperation(requested.requestId);
  if (own && own.action !== requested.action) throw new Error('IDEMPOTENCY_CONFLICT');
  if (own && ['SUCCEEDED', 'FAILED', 'INTERRUPTED'].includes(own.outcome)) return;
  const pending = snapshot.pendingOperation;
  if (pending) {
    const previous = await store.getControllerAttempt(pending.requestId);
    if (previous && previous.endedAt === null) await store.finishControllerAttempt(previous.attemptId, new Date().toISOString(), 'INTERRUPTED');
  }
  try {
    let observed = await observe(context);
    const grace = Math.min(performance.now() + 2_000, context.deadline.expiresAt);
    while (observed.observation === 'UNKNOWN' && ['STARTING', 'RECOVERING'].includes((await store.readSnapshot())?.instance?.lifecycle ?? '')
      && performance.now() < grace) { await context.sleep(25); observed = await observe(context); }
    let tickets = pending ? await store.listTickets(pending.requestId) : [];
    let active = tickets.find(t => t.status !== 'CANCELLED');
    const claimGrace = Math.min(performance.now() + 2_000, context.deadline.expiresAt);
    while (active?.status === 'CLAIMED' && active.instanceId !== (await store.readSnapshot())?.instance?.instanceId
      && await context.identity.probeAbsent(active.claimedPid!) !== 'ABSENT' && performance.now() < claimGrace) {
      await context.sleep(25); observed = await observe(context);
      tickets = pending ? await store.listTickets(pending.requestId) : [];
      active = tickets.find(t => t.status !== 'CANCELLED');
    }
    if (active?.status === 'CLAIMED' && active.instanceId !== (await store.readSnapshot())?.instance?.instanceId
      && await context.identity.probeAbsent(active.claimedPid!) !== 'ABSENT') throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    observed = await observe(context);
    if (observed.observation === 'ABSENT') await recoverAbsentInstance(context);
    const current = (await store.readSnapshot())?.instance;
    if (!pending) {
      if (observed.observation === 'UNKNOWN' && !observed.verified) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      return;
    }
    let decision = decideRecovery({ operation: pending, requested, observation: observed.observation,
      ticketStatus: active?.status === 'ISSUED' || active?.status === 'CLAIMED' ? active.status : null, currentInstanceId: current?.instanceId ?? null });
    if (decision === 'BLOCKED' && observed.verified && pending.requestId === requested.requestId
      && pending.targetInstanceId === current?.instanceId && ['stop', 'restart'].includes(pending.action)) decision = 'RESUME';
    if (decision === 'BLOCKED') throw new Error(pending.requestId !== requested.requestId
      && (observed.verified || observed.observation === 'ABSENT') ? 'BUSY' : 'BLOCKED');
    if (decision === 'COMPLETE') {
      if (pending.action === 'stop') await store.cancelIssuedTickets(pending.requestId);
      await store.completeOperation(pending.requestId, 'SUCCEEDED', new Date().toISOString(), null);
      return;
    }
    if (decision === 'HISTORICAL') return;
    await store.reopenOperation(pending.requestId);
    if (active?.status === 'ISSUED' && !await store.cancelTicket(active.ticketId)) throw new Error('BLOCKED');
    if (active?.status === 'CLAIMED') {
      if (observed.observation !== 'ABSENT' || await context.identity.probeAbsent(active.claimedPid!) !== 'ABSENT') throw new Error('BLOCKED');
      await store.retireTicket(active.ticketId, active.generation, active.claimedPid!);
    }
    if (decision === 'INTERRUPT') {
      await store.completeOperation(pending.requestId, 'INTERRUPTED', new Date().toISOString(), null);
      return;
    }
    if (pending.successorInstanceId !== null) {
      tickets = await store.listTickets(pending.requestId);
      const generation = String(tickets.reduce((max, ticket) => BigInt(ticket.generation) > max ? BigInt(ticket.generation) : max, 0n) + 1n);
      await store.issueTicket({ticketId: randomUUID(), requestId: pending.requestId, instanceId: pending.successorInstanceId, generation});
    }
  } catch (error) {
    if (pending && error instanceof Error && ['BLOCKED', 'RESOURCE_IDENTITY_UNKNOWN'].includes(error.message)) {
      await store.completeOperation(pending.requestId, 'BLOCKED', new Date().toISOString(), foundationError(error.message as 'BLOCKED' | 'RESOURCE_IDENTITY_UNKNOWN', { persisted: true, operationId: pending.requestId }));
    }
    throw error;
  }
}
