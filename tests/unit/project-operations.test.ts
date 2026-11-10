import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadContract } from '../fixtures/load-contract.js';
import { foundationError } from '../../src/domain/errors.js';
import type { ProjectAction, ProjectOperation, ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { RegistryOperationsPort } from '../../src/ports/registry.js';
import type { StoreSnapshot } from '../../src/ports/storage.js';
import type { Clock, Deadline } from '../../src/ports/clock.js';
import type { IdentityProof } from '../../src/ports/platform.js';
import type { InspectionResult, ProbeRequest, ProbeSupervisor } from '../../src/ports/repository.js';

interface Peer { readonly role: string }
interface Execution {
  readonly operation: ProjectOperation;
  readonly deadline: Deadline;
  readonly signal: AbortSignal;
  probe(request: ProbeRequest): Promise<InspectionResult>;
}
type Storage = RegistryOperationsPort & { readSnapshot(): Promise<StoreSnapshot | null> };
interface Coordinator {
  admit(peer: Peer, action: ProjectAction, requestId: string, params: unknown): Promise<
    { accepted: true; operation: ProjectOperation } | { accepted: false; error: ReturnType<typeof foundationError> }>;
  get(peer: Peer, requestId: string): Promise<ProjectOperation | null>;
  shutdown(): Promise<IdentityProof>;
  counts(): { activeProbes: number; pending: number; queued: number; fenced: boolean };
}
interface Options {
  storage: Storage; ownerUid: number; instanceId: string; clock: Clock; supervisor: ProbeSupervisor;
  wakeAfter(ms: number, callback: () => void): () => void;
  execute(context: Execution): Promise<ProjectOperationResult>;
}
const coordinator = () => loadContract<{ createProjectOperations(options: Options): Coordinator }>('core/projects/operations.js', ['createProjectOperations']);
const recover = () => loadContract<{ interruptProjectOperations(storage: Storage, completedAt: string): Promise<void> }>('core/projects/recovery.js', ['interruptProjectOperations']);
const flush = async () => { await new Promise<void>(resolve => setImmediate(resolve)); await new Promise<void>(resolve => setImmediate(resolve)); };

async function fixture() {
  const { createProjectOperations } = await coordinator();
  let mono = 0;
  const timers = new Set<{ due: number; callback: () => void }>();
  const clock: Clock = { monotonicNow: () => mono, wallUtc: () => new Date(Date.parse('2026-11-10T12:00:00.000Z') + mono).toISOString() };
  const instanceId = randomUUID(), storeId = randomUUID();
  const records = new Map<string, ProjectOperation>();
  let writes = 0;
  const storage: Storage = {
    getRequestReservation: async id => { const record = records.get(id); return record
      ? { scope: 'PROJECT', action: record.action, payloadHash: record.payloadHash } : null; },
    readSnapshot: async () => ({ store: { storeId, schemaVersion: 3, revision: '0', ownerUid: 501, canonicalPath: '/owned/archive' },
      instance: { instanceId, pid: 1, generation: '1', lifecycle: 'RUNNING', startedAt: clock.wallUtc(), shutdownPrepared: false, lastError: null }, pendingOperation: null }),
    getProjectOperation: async id => records.get(id) ?? null,
    listPendingProjectOperations: async () => [...records.values()].filter(record => record.outcome === 'IN_PROGRESS'),
    acceptProjectOperation: async intent => {
      const old = records.get(intent.requestId);
      if (old) {
        if (old.payloadHash !== intent.payloadHash) throw new Error('IDEMPOTENCY_CONFLICT');
        return { accepted: false, operation: old };
      }
      const operation: ProjectOperation = { ...intent, phase: 'ACCEPTED', outcome: 'IN_PROGRESS', completedAt: null, result: null };
      writes++; records.set(intent.requestId, operation);
      return { accepted: true, operation };
    },
    setProjectOperationPhase: async (id, phase) => {
      const old = records.get(id)!; assert.equal(old.outcome, 'IN_PROGRESS');
      writes++; records.set(id, { ...old, phase });
    },
    completeProjectOperation: async (id, result) => {
      const old = records.get(id)!; assert.equal(old.outcome, 'IN_PROGRESS', 'terminal outcomes cannot be overwritten');
      writes++; records.set(id, { ...old, phase: 'FINALIZED', outcome: result.outcome, completedAt: result.completedAt, result });
    },
  };
  const invocations: Array<{ deadline: Deadline; finish(result: InspectionResult): void; cancellations: number }> = [];
  let cancellationProof: IdentityProof = 'ABSENT';
  let holdResultsOnCancel = false;
  const supervisor: ProbeSupervisor = {
    start: async (_request, ownership, options) => {
      let finish!: (result: InspectionResult) => void;
      const result = new Promise<InspectionResult>(resolve => { finish = resolve; });
      const invocation = { deadline: options.deadline, finish, cancellations: 0 };
      invocations.push(invocation);
      return { ownership, result, cancel: async () => {
        invocation.cancellations++;
        if (!holdResultsOnCancel) finish({ ok: false, error: { code: 'INTERRUPTED', retryable: false, nextAction: 'retry-inspection' } });
        return cancellationProof;
      } };
    },
  };
  const starts: Execution[] = [];
  const api = createProjectOperations({ storage, ownerUid: 501, instanceId, clock, supervisor,
    wakeAfter: (ms, callback) => { const timer = { due: mono + ms, callback }; timers.add(timer); return () => { timers.delete(timer); }; },
    execute: async context => {
      starts.push(context);
      assert.ok(records.has(context.operation.requestId), 'durable admission must precede any probe');
      assert.ok(context.deadline.remainingMs() <= 28_000);
      await context.probe({ kind: 'CANDIDATE', path: '/not-present' });
      return { requestId: context.operation.requestId, action: context.operation.action, projectId: null,
        outcome: 'BLOCKED', effect: 'NONE', configRevision: null, observationRevision: null,
        completedAt: clock.wallUtc(), error: foundationError('INSPECTION_UNSAFE', { persisted: true }) };
    } });
  return { api, storage, records, invocations, starts, writes: () => writes, setCancellationProof: (proof: IdentityProof) => { cancellationProof = proof; },
    setHoldResultsOnCancel: () => { holdResultsOnCancel = true; },
    advance: async (ms: number) => { mono += ms; for (const timer of [...timers].sort((a, b) => a.due - b.due)) {
      if (timer.due <= mono && timers.delete(timer)) timer.callback();
    } await flush(); }, clock };
}
const client = { role: 'client' };
const params = { path: '/unavailable/original', name: ' Maestro ' };

test('bounded admission persists 32 intents, runs at most four probes and refuses the 33rd before acceptance', async () => {
  const f = await fixture();
  const ids = Array.from({ length: 32 }, () => randomUUID());
  for (const id of ids) assert.equal((await f.api.admit(client, 'REGISTER', id, params)).accepted, true);
  await flush();
  assert.equal(f.invocations.length, 4);
  assert.deepEqual(f.api.counts(), { activeProbes: 4, pending: 32, queued: 28, fenced: false });
  const overflowId = randomUUID();
  const overflow = await f.api.admit(client, 'REGISTER', overflowId, params);
  assert.equal(overflow.accepted, false);
  if (!overflow.accepted) assert.equal(overflow.error.code, 'BUSY');
  assert.equal(f.records.has(overflowId), false);
  const writes = f.writes();
  assert.equal((await f.api.admit(client, 'REGISTER', ids[0]!, params)).accepted, true);
  assert.equal(f.writes(), writes);
  await assert.rejects(f.api.admit(client, 'REGISTER', ids[0]!, { path: '/different' }), /IDEMPOTENCY_CONFLICT/);
  await f.api.shutdown();
});

test('concurrent admissions cannot race capacity, duplicate execution or authorization', async () => {
  const f = await fixture();
  const same = randomUUID();
  await Promise.all(Array.from({ length: 20 }, () => f.api.admit(client, 'REGISTER', same, params)));
  await flush(); assert.equal(f.invocations.length, 1); assert.equal(f.records.size, 1);
  const attempts = await Promise.all(Array.from({ length: 40 }, () => f.api.admit(client, 'REGISTER', randomUUID(), params)));
  assert.equal(attempts.filter(value => value.accepted).length, 31);
  assert.equal(f.records.size, 32);
  const before = f.writes();
  await assert.rejects(f.api.admit({ role: 'controller' }, 'REGISTER', same, params), /UNAUTHORIZED/);
  await assert.rejects(f.api.get({ role: 'controller' }, same), /UNAUTHORIZED/);
  assert.equal(f.writes(), before);
  await f.api.shutdown();
});

test('deadline includes queue time; Git budget is 26s and the server finishes within 28s without starting expired work', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i++) await f.api.admit(client, 'REGISTER', randomUUID(), params);
  await flush();
  for (const invocation of f.invocations) assert.ok(invocation.deadline.remainingMs() <= 26_000);
  await f.advance(28_000);
  assert.equal(f.invocations.length, 4, 'expired queued operations never start a new probe');
  assert.equal(f.api.counts().pending, 0);
  for (const record of f.records.values()) {
    assert.equal(record.outcome, 'FAILED'); assert.equal(record.result?.error?.code, 'DEADLINE_EXCEEDED');
  }
});

test('accepted work survives the client session; identical retry returns its terminal result without execution', async () => {
  const f = await fixture();
  const id = randomUUID(), session = { role: 'client' };
  const admitted = await f.api.admit(session, 'REGISTER', id, params);
  assert.equal(admitted.accepted, true);
  await flush();
  session.role = 'disconnected';
  f.invocations[0]!.finish({ ok: false, error: { code: 'INSPECTION_UNSAFE', retryable: false, nextAction: 'check-inspection-capability' } });
  await flush();
  const result = await f.api.get(client, id);
  assert.equal(result?.outcome, 'BLOCKED');
  const writes = f.writes();
  const retried = await f.api.admit(client, 'REGISTER', id, params);
  assert.equal(retried.accepted, true);
  if (retried.accepted) assert.deepEqual(retried.operation, result);
  assert.equal(f.writes(), writes); assert.equal(f.invocations.length, 1);
});

test('shutdown fences immediately, interrupts queued/owned work and uncertainty stays BLOCKED', async () => {
  const f = await fixture();
  for (let i = 0; i < 8; i++) await f.api.admit(client, 'REGISTER', randomUUID(), params);
  await flush();
  const stopping = f.api.shutdown();
  const rejectedId = randomUUID();
  const rejected = await f.api.admit(client, 'REGISTER', rejectedId, params);
  assert.equal(rejected.accepted, false); assert.equal(f.records.has(rejectedId), false);
  assert.equal(await stopping, 'ABSENT');
  assert.equal(f.api.counts().pending, 0); assert.equal(f.invocations.length, 4);
  for (const record of f.records.values()) assert.equal(record.outcome, 'INTERRUPTED');
  const uncertain = await fixture();
  await uncertain.api.admit(client, 'REGISTER', randomUUID(), params); await flush();
  uncertain.setCancellationProof('UNKNOWN');
  assert.equal(await uncertain.api.shutdown(), 'UNKNOWN');
  assert.equal([...uncertain.records.values()][0]?.outcome, 'BLOCKED');
});

test('startup recovery terminalizes old pending once and never reruns it; identical retry stays INTERRUPTED', async () => {
  const f = await fixture();
  const id = randomUUID(); await f.api.admit(client, 'REGISTER', id, params); await flush();
  // Model a crashed runtime by retaining only its durable ledger for a fresh coordinator.
  const before = f.invocations.length;
  const { interruptProjectOperations } = await recover();
  await interruptProjectOperations(f.storage, f.clock.wallUtc());
  const interrupted = await f.storage.getProjectOperation(id);
  assert.equal(interrupted?.outcome, 'INTERRUPTED');
  assert.equal(interrupted?.result?.error?.nextAction, 'read-project-then-new-request');
  await interruptProjectOperations(f.storage, f.clock.wallUtc());
  assert.equal(f.invocations.length, before);
  // The abandoned execution is never completed in this in-memory crash model.
});

test('shutdown retains storage until resource bookkeeping settles even after physical process exit is verified', async () => {
  const f = await fixture();
  await f.api.admit(client, 'REGISTER', randomUUID(), params); await flush();
  f.setHoldResultsOnCancel();
  let settled = false;
  const stopping = f.api.shutdown().then(proof => { settled = true; return proof; });
  await flush();
  assert.equal(f.invocations[0]?.cancellations, 1);
  assert.equal(settled, false);
  assert.equal(f.api.counts().pending, 1);
  f.invocations[0]!.finish({ ok: false, error: { code: 'INTERRUPTED', retryable: false, nextAction: 'retry-inspection' } });
  assert.equal(await stopping, 'ABSENT');
  assert.equal([...f.records.values()][0]?.outcome, 'INTERRUPTED');
});
