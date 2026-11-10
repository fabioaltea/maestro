import { createHash, randomUUID } from 'node:crypto';
import { foundationError, type ErrorCode, type SafeError } from '../../domain/errors.js';
import { requireUuid } from '../../domain/identifiers.js';
import { canonicalProjectIntent, normalizeProjectCommand } from '../../domain/projects/intent.js';
import type { ProjectAction, ProjectOperation, ProjectOperationResult } from '../../domain/projects/model.js';
import type { RegistryOperationsPort } from '../../ports/registry.js';
import type { StoreSnapshot } from '../../ports/storage.js';
import type { IdentityProof } from '../../ports/platform.js';
import type { InspectionResult, OwnedProbe, ProbeRequest, ProbeSupervisor } from '../../ports/repository.js';
import { makeDeadline, systemClock, type Clock, type Deadline } from '../../ports/clock.js';
import { requireProjectClient } from '../../protocol/validation.js';

export interface ProjectExecution {
  readonly operation: ProjectOperation;
  readonly deadline: Deadline;
  readonly signal: AbortSignal;
  probe(request: ProbeRequest): Promise<InspectionResult>;
}
export interface ProjectOperationsOptions {
  readonly storage: RegistryOperationsPort & { readSnapshot(): Promise<StoreSnapshot | null> };
  readonly ownerUid: number;
  readonly instanceId: string;
  readonly supervisor: ProbeSupervisor;
  readonly clock?: Clock;
  readonly wakeAfter?: (ms: number, callback: () => void) => () => void;
  readonly execute: (context: ProjectExecution) => Promise<ProjectOperationResult>;
  readonly onBlocked?: (error: SafeError) => void;
}
export type ProjectAdmission = { readonly accepted: true; readonly operation: ProjectOperation }
  | { readonly accepted: false; readonly error: SafeError };
interface Work {
  readonly operation: ProjectOperation;
  readonly deadline: Deadline;
  readonly probeDeadline: Deadline;
  readonly abort: AbortController;
  phase: 'QUEUED' | 'ACTIVE';
  probe?: OwnedProbe;
  starting?: Promise<OwnedProbe>;
  reason?: 'STOP' | 'DEADLINE';
  stopping?: Promise<IdentityProof>;
  finalizing?: Promise<void>;
  clearServerTimer: () => void;
  clearProbeTimer: () => void;
}

/** The registry's bounded admission/work queue. No client connection owns accepted work. */
export function createProjectOperations(options: ProjectOperationsOptions) {
  const { storage } = options;
  const clock = options.clock ?? systemClock;
  const wakeAfter = options.wakeAfter ?? ((ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); });
  const pending = new Map<string, Work>();
  const queue: Work[] = [];
  let active = 0, fenced = false, failure: SafeError | null = null;
  let admissions = Promise.resolve();
  let shutdown: Promise<IdentityProof> | undefined;
  function block(error: unknown) {
    fenced = true;
    let safe: SafeError;
    try { safe = foundationError(error instanceof Error ? error.message as ErrorCode : 'PERSISTENCE_UNAVAILABLE'); }
    catch { safe = foundationError('PERSISTENCE_UNAVAILABLE'); }
    failure = safe;
    options.onBlocked?.(safe);
  }
  async function authorize(peer: { readonly role: string }): Promise<StoreSnapshot> {
    requireProjectClient(peer.role);
    const snapshot = await storage.readSnapshot();
    if (!snapshot || snapshot.store.ownerUid !== options.ownerUid) throw new Error('UNAUTHORIZED');
    return snapshot;
  }
  function result(work: Work, outcome: 'FAILED' | 'BLOCKED' | 'INTERRUPTED', code: ErrorCode): ProjectOperationResult {
    return { action: work.operation.action, requestId: work.operation.requestId, projectId: work.operation.projectId,
      outcome, effect: 'NONE', configRevision: null, observationRevision: null, completedAt: clock.wallUtc(),
      error: foundationError(code, { persisted: true, operationId: work.operation.requestId }) };
  }
  function finalize(work: Work, terminal: ProjectOperationResult): Promise<void> {
    if (work.finalizing) return work.finalizing;
    work.finalizing = (async () => {
      const current = await storage.getProjectOperation(work.operation.requestId);
      // Successful story executors have already committed project/result/outbox atomically.
      if (current?.outcome === 'IN_PROGRESS') await storage.completeProjectOperation(work.operation.requestId, terminal);
      else if (!current) throw new Error('STATE_CORRUPT');
      pending.delete(work.operation.requestId);
      work.clearServerTimer(); work.clearProbeTimer();
    })().catch(error => { block(error); throw error; });
    return work.finalizing;
  }
  function stop(work: Work, reason: 'STOP' | 'DEADLINE'): Promise<IdentityProof> {
    if (work.stopping) return work.stopping;
    work.reason = reason;
    work.abort.abort();
    work.stopping = (async () => {
      let proof: IdentityProof = 'ABSENT';
      try {
        const owned = work.probe ?? await work.starting?.catch(() => undefined);
        if (owned) proof = await owned.cancel();
        if (proof !== 'ABSENT') {
          block(new Error('RESOURCE_IDENTITY_UNKNOWN'));
          await finalize(work, result(work, 'BLOCKED', 'RESOURCE_IDENTITY_UNKNOWN'));
        } else await finalize(work, result(work, reason === 'STOP' ? 'INTERRUPTED' : 'FAILED', reason === 'STOP' ? 'INTERRUPTED' : 'DEADLINE_EXCEEDED'));
      } catch (error) { block(error); proof = 'UNKNOWN'; }
      pump();
      return proof;
    })();
    return work.stopping;
  }
  async function probe(work: Work, request: ProbeRequest): Promise<InspectionResult> {
    if (work.reason || work.probeDeadline.expired()) throw new Error(work.reason === 'STOP' ? 'INTERRUPTED' : 'DEADLINE_EXCEEDED');
    if (work.probe || work.starting) throw new Error('INVALID_REQUEST');
    await storage.setProjectOperationPhase(work.operation.requestId, 'PROBING');
    if (work.reason) throw new Error('INTERRUPTED');
    work.starting = options.supervisor.start(request, { resourceId: randomUUID(), generation: randomUUID(),
      owningInstanceId: options.instanceId, policyScope: 'foundation' }, { deadline: work.probeDeadline, signal: work.abort.signal });
    try {
      work.probe = await work.starting;
      work.clearProbeTimer = wakeAfter(work.probeDeadline.remainingMs(), () => { void stop(work, 'DEADLINE'); });
      if (work.reason) throw new Error(work.reason === 'STOP' ? 'INTERRUPTED' : 'DEADLINE_EXCEEDED');
      return await work.probe.result;
    } finally { work.clearProbeTimer(); delete work.probe; delete work.starting; }
  }
  async function execute(work: Work): Promise<void> {
    try {
      const terminal = await options.execute({ operation: work.operation, deadline: work.deadline, signal: work.abort.signal,
        probe: request => probe(work, request) });
      if (!work.reason) await finalize(work, terminal);
    } catch (error) {
      if (!work.reason) {
        let code: ErrorCode;
        try { code = foundationError(error instanceof Error ? error.message as ErrorCode : 'INTERNAL_ERROR').code; }
        catch { code = 'INTERNAL_ERROR'; }
        if (['PERSISTENCE_UNAVAILABLE', 'STATE_CORRUPT', 'STATE_INCOMPATIBLE'].includes(code)) block(error);
        else {
          if (code === 'RESOURCE_IDENTITY_UNKNOWN') block(error);
          const category = foundationError(code).category;
          await finalize(work, result(work, ['SAFETY', 'AUTHORIZATION', 'OBSERVABILITY'].includes(category) ? 'BLOCKED' : 'FAILED', code));
        }
      }
    } finally { active--; pump(); }
  }
  function pump(): void {
    if (fenced) return;
    while (active < 4 && queue.length) {
      const work = queue.shift()!;
      if (!pending.has(work.operation.requestId) || work.reason) continue;
      if (work.deadline.expired() || work.probeDeadline.expired()) { void stop(work, 'DEADLINE'); continue; }
      work.phase = 'ACTIVE'; active++;
      void execute(work).catch(block);
    }
  }
  async function admitNow(peer: { readonly role: string }, action: ProjectAction, requestId: string, input: unknown): Promise<ProjectAdmission> {
    const snapshot = await authorize(peer);
    if (fenced || snapshot.instance?.instanceId !== options.instanceId || snapshot.instance.lifecycle !== 'RUNNING') {
      return { accepted: false, error: foundationError('BLOCKED') };
    }
    requestId = requireUuid(requestId);
    const command = normalizeProjectCommand(action, input);
    const canonicalIntent = canonicalProjectIntent(snapshot.store.storeId, action, command.params);
    const payloadHash = createHash('sha256').update(canonicalIntent).digest('hex');
    const reserved = await storage.getRequestReservation(requestId);
    if (reserved) {
      if (reserved.scope !== 'PROJECT' || reserved.action !== action || reserved.payloadHash !== payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
      const existing = await storage.getProjectOperation(requestId);
      if (!existing || existing.ownerUid !== options.ownerUid || existing.canonicalIntent !== canonicalIntent) throw new Error('IDEMPOTENCY_CONFLICT');
      return { accepted: true, operation: existing };
    }
    if (pending.size >= 32) return { accepted: false, error: foundationError('BUSY') };
    const acceptedAt = clock.wallUtc();
    const deadline = makeDeadline(clock, 28_000), probeDeadline = makeDeadline(clock, 26_000);
    const params = command.params as { projectId?: string; expectedRevision?: string };
    // Unknown IDs remain in the original intent; FK project_id is assigned only if known.
    let projectId: string | null = null;
    if (params.projectId) {
      const reader = storage as typeof storage & { getProject?: (id: string) => Promise<unknown> };
      if (reader.getProject && await reader.getProject(params.projectId)) projectId = params.projectId;
    }
    const admission = await storage.acceptProjectOperation({ requestId, action, payloadHash, canonicalIntent, projectId,
      expectedConfigRevision: params.expectedRevision ?? null, ownerUid: options.ownerUid, owningInstanceId: options.instanceId,
      acceptedAt, deadlineAt: new Date(Date.parse(acceptedAt) + 28_000).toISOString() });
    if (!admission.accepted) return { accepted: true, operation: admission.operation };
    const work: Work = { operation: admission.operation, deadline, probeDeadline, abort: new AbortController(), phase: 'QUEUED',
      clearServerTimer: () => {}, clearProbeTimer: () => {} };
    pending.set(requestId, work); queue.push(work);
    work.clearServerTimer = wakeAfter(deadline.remainingMs(), () => { void stop(work, 'DEADLINE'); });
    if (fenced) void stop(work, 'STOP'); else pump();
    return { accepted: true, operation: admission.operation };
  }
  return {
    admit(peer: { readonly role: string }, action: ProjectAction, requestId: string, params: unknown): Promise<ProjectAdmission> {
      const next = admissions.then(() => admitNow(peer, action, requestId, params));
      admissions = next.then(() => {}, () => {});
      return next;
    },
    async get(peer: { readonly role: string }, requestId: string): Promise<ProjectOperation | null> {
      await authorize(peer); return storage.getProjectOperation(requireUuid(requestId));
    },
    shutdown(): Promise<IdentityProof> {
      fenced = true;
      shutdown ??= (async () => {
        await admissions;
        const proofs = await Promise.all([...pending.values()].map(work => stop(work, 'STOP')));
        return failure || proofs.some(proof => proof !== 'ABSENT') ? 'UNKNOWN' : 'ABSENT';
      })();
      return shutdown;
    },
    counts() { return { activeProbes: [...pending.values()].filter(work => Boolean(work.probe || work.starting)).length,
      pending: pending.size, queued: queue.filter(work => pending.has(work.operation.requestId) && !work.reason).length, fenced }; },
  };
}
