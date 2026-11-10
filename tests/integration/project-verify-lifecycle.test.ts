import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProjectHarness } from '../fixtures/project-client.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';

async function terminal(a: Awaited<ReturnType<typeof createProjectHarness>>, requestId: string) {
  const until = performance.now() + 5_000;
  for (;;) {
    const result = await a.other.runProject('operation', { requestId }, { stateDirectory: a.h.archive });
    const operation = decodeProjectOperationView(result.data.operation);
    if (operation.outcome !== 'IN_PROGRESS') return operation;
    assert.ok(performance.now() < until); await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('a client deadline/disconnection does not cancel an admitted verify', async t => {
  const a = await createProjectHarness(t), added = await a.register(await a.f.createRepository('disconnect'));
  const requestId = randomUUID();
  await a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId, timeoutMs: 100 });
  const operation = await terminal(a, requestId);
  assert.equal(operation.outcome, 'SUCCEEDED'); assert.equal(operation.result!.effect, 'OBSERVED');
  assert.equal((await a.get(added.projectId!)).observation.requestId, requestId);
});

test('stop interrupts queued/probing verifies without occupying status RPC or publishing an observation', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('blocked-verify'), added = await a.register(repo);
  const before = await a.get(added.projectId!);
  await rename(join(repo, '.git/index'), join(repo, '.git/index.saved'));
  await promisify(execFile)('/usr/bin/mkfifo', [join(repo, '.git/index')]);
  const ids = Array.from({ length: 6 }, () => randomUUID());
  await Promise.all(ids.map(requestId => a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId, timeoutMs: 200 })));
  for (const requestId of ids) {
    const pending = await a.other.runProject('operation', { requestId }, { stateDirectory: a.h.archive });
    assert.equal(pending.outcome, 'IN_PROGRESS', JSON.stringify(pending));
  }
  const started = performance.now(); assert.equal((await a.h.call('status')).code, 0); assert.ok(performance.now() - started < 2_000);
  const stopStarted = performance.now(); assert.equal((await a.h.call('stop')).code, 0); assert.ok(performance.now() - stopStarted < 10_000);
  for (const requestId of ids) assert.equal((await terminal(a, requestId)).outcome, 'INTERRUPTED');
  assert.deepEqual(await a.get(added.projectId!), before);
});

test('a failed journal drain preserves the committed observation/result, blocks new admissions and replays once', async t => {
  const { observationStore } = await import('../fixtures/project-observation.js');
  let fault = false;
  const f = await observationStore(t, point => { if (fault && point === 'journal.allocated') throw new Error('controlled journal failure'); });
  const intent = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId }; f.store.acceptProjectOperation(intent);
  fault = true;
  const result = f.store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
    expectedConfigRevision: '1', expectedObservationRevision: '1', observation: f.evidence.observation, completedAt: f.evidence.observation.completedAt });
  assert.equal(result.outcome, 'SUCCEEDED'); assert.equal(f.store.getProjectOperation(intent.requestId)!.outcome, 'SUCCEEDED');
  assert.equal(f.store.getProject(f.projectId)!.observation!.observationRevision, '2'); assert.equal(f.store.getEventState().degraded, true);
  const rejected = { ...f.intent('VERIFY', { projectId: f.projectId }), projectId: f.projectId };
  assert.throws(() => f.store.acceptProjectOperation(rejected), /EVENT_BACKPRESSURE/);
  assert.equal(f.store.getProjectOperation(rejected.requestId), null);
  fault = false; f.store.drainEvents();
  const events = f.store.listEvents({ limit: 100 }).records.filter(event => event.operationId === intent.requestId && event.type === 'operation.completed');
  assert.equal(events.length, 1); assert.equal(events[0]!.payload.action, 'VERIFY');
});

test('actual daemon storage worker failure fences verify without inventing a durable success or releasing daemon ownership', async t => {
  const { createPlatformPaths } = await import('../../src/platform/macos/paths.js');
  const { openStorage } = await import('../../src/storage/worker.js');
  const { createOperations } = await import('../../src/core/operations.js');
  const { createProcessSandbox } = await import('../fixtures/process-sandbox.js');
  const { writeFile } = await import('node:fs/promises');
  const { createOwnershipLease } = await import('../../src/platform/macos/lease.js');
  const a = await createProjectHarness(t), added = await a.register(await a.f.createRepository('worker-failure'));
  const before = await a.get(added.projectId!); assert.equal((await a.h.call('stop')).code, 0);
  const paths = (await createPlatformPaths().resolveArchive(a.h.archive, 'read'))!;
  const seed = await openStorage({ path: paths.stateFile }), lifecycleId = randomUUID();
  let intent;
  try {
    const snapshot = (await seed.readSnapshot())!, ops = createOperations(seed, paths.ownerUid);
    await ops.accept({ requestId: lifecycleId, action: 'start', canonicalStateDir: paths.directory, targetInstanceId: snapshot.instance!.instanceId });
    const ticket = await ops.issueLaunch(lifecycleId, randomUUID());
    intent = { ticketId: ticket.ticketId, instanceId: ticket.instanceId, generation: ticket.generation, canonicalStateDir: paths.directory };
  } finally { await seed.close(); }
  const sandbox = await createProcessSandbox(t), file = join(a.h.directory, 'verify-worker-intent.json');
  await writeFile(file, JSON.stringify(intent), { mode: 0o600 });
  const actor = sandbox.spawnFixture('recovery-actor.js', [file, 'project.probing']);
  const exited = new Promise<void>(resolve => actor.once('exit', () => resolve()));
  let submitted: ReturnType<typeof a.client.runProject> | undefined;
  try {
    await sandbox.waitForMessage(actor, 'accepted', 5_000);
    const finalize = await openStorage({ path: paths.stateFile });
    try { await finalize.completeOperation(lifecycleId, 'SUCCEEDED', new Date().toISOString(), null); } finally { await finalize.close(); }
    const paused = sandbox.waitForMessage(actor, 'paused', 5_000), requestId = randomUUID();
    submitted = a.client.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId, timeoutMs: 200 });
    await paused;
    const failed = sandbox.waitForMessage(actor, 'worker-exited'); actor.send({ type: 'worker-exit' }); await failed;
    const status = JSON.parse((await a.h.call('status')).stdout);
    assert.equal(status.freshness, 'VOLATILE'); assert.equal(status.data.ready, false); assert.equal(status.data.lastError.cause, 'WORKER_EXIT');
    assert.equal(createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon').status, 'BUSY');
    assert.equal((await submitted).result, 'UNKNOWN_OUTCOME');
    actor.kill('SIGKILL'); await exited;
    assert.equal((await a.h.call('start')).code, 0);
    assert.equal((await terminal(a, requestId)).outcome, 'INTERRUPTED');
    assert.deepEqual(await a.get(added.projectId!), before);
  } finally {
    if (actor.exitCode === null && actor.signalCode === null) actor.kill('SIGKILL');
    await exited; if (submitted) await submitted;
  }
});
