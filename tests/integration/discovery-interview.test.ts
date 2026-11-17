import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import type { DiscoveryCommand, DiscoveryAccepted } from '../../src/core/discovery/operations.js';
import type { DiscoveryQuestions } from '../../src/domain/discovery/documents.js';
import type { AgentProcessIdentity } from '../../src/ports/agent-runtime.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import type { AuthenticatedPeer } from '../../src/ports/platform.js';
import type { TestContext } from 'node:test';
import { inspectDiscovery } from '../../src/core/inspect-main.js';

interface InterviewOperations {
  publishQuestions(identity: AgentProcessIdentity, result: DiscoveryQuestions): Promise<void>;
  answer(peer: AuthenticatedPeer, command: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>>;
}
const result: DiscoveryQuestions = { kind: 'QUESTIONS', questions: [{ text: 'Chi usa il progetto?', reason: 'Destinatari assenti nelle fonti.', section: 'purpose-and-features' }] };
async function fixture(t: TestContext, checkpoint?: (point: string) => Promise<void>) {
  const f = await launchFixture(t, checkpoint ? { checkpoint } : {}), service = f.service as unknown as InterviewOperations;
  const grant = await f.prepare(); value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle();
  async function publish(runId = f.launches.at(-1)!.runId, data = result) {
    let run = value(f.store.readDiscoveryMetadata({ kind: 'run', id: runId })).data!;
    for (const phase of ['HOST_READY', 'SPAWN_AUTHORIZED', 'PROVIDER_RUNNING', 'EXIT_OBSERVED'] as const) {
      const next = { ...run, phase, outcome: phase === 'EXIT_OBSERVED' ? 'SUCCEEDED' as const : 'RUNNING' as const, endedAt: phase === 'EXIT_OBSERVED' ? new Date().toISOString() : null };
      value(f.store.commitDiscoveryMetadata({ kind: 'run', value: next, expectedPhase: run.phase, exitVerified: phase === 'EXIT_OBSERVED' })); run = next;
    }
    const identity: AgentProcessIdentity = { runId, generation: run.generation, owningInstanceId: f.instanceId, hostPid: null, providerPid: null, hostEndpoint: '/synthetic/host', credentialRef: '/synthetic/key', observation: 'ABSENT', releaseState: 'RELEASED', policy: 'cancel-on-owner-loss-v1' };
    await service.publishQuestions(identity, data); return identity;
  }
  await publish();
  const discovery = () => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.launches[0]!.discoveryId })).data!;
  const questions = () => value(f.store.readDiscoveryMetadata({ kind: 'questions', id: discovery().discoveryId })).data.items;
  const answers = () => value(f.store.readDiscoveryMetadata({ kind: 'answers', id: discovery().discoveryId })).data.items;
  function intent(kind: 'ANSWER' | 'UNKNOWN' = 'ANSWER', text = 'Sviluppatori locali', revision = '1', questionId = questions()[0]!.questionId) {
    return f.intent({ action: 'answer', targetId: questionId, stateRevision: discovery().stateRevision,
      payload: { questionId, questionRevision: '1', answerId: randomUUID(), answerRevision: revision, kind, text } });
  }
  async function answer(raw = intent(), requestId = randomUUID()) {
    const grant = value(await f.service.prepare(f.peer, raw));
    const command = { requestId, grantId: grant.grantId, canonicalIntent: grant.canonicalIntent };
    const accepted = await service.answer(f.peer, command); return { command, accepted };
  }
  return { ...f, interview: service, publish, discovery, questions, answers, intent, answer };
}
test('verified QUESTIONS become durable core IDs; WAITING_USER has no process and retains its unique slot', async t => {
  const f = await fixture(t); assert.equal(f.discovery().state, 'WAITING_USER'); assert.equal(f.questions().length, 1);
  assert.match(f.questions()[0]!.questionId, /^[a-f0-9-]{36}$/); assert.equal(f.questions()[0]!.text, result.questions[0]!.text);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'processes' })).data.items.length, 0);
  const offline = await inspectDiscovery(f.directory, 'discovery.questions.list', { discoveryId: f.discovery().discoveryId });
  assert.equal(offline.result, 'OK'); assert.equal((offline.data.items as unknown[]).length, 1);
  const fresh = await f.prepare(); assert.deepEqual(await f.service.start(f.peer, f.startInput(fresh)), { ok: false, code: 'DISCOVERY_BUSY' });
});
test('confirmed answer precedes continuation, preserves session/corpus and a duplicate UUID cannot relaunch', async t => {
  const f = await fixture(t), first = f.discovery(), submitted = await f.answer(); value(submitted.accepted); await f.service.idle();
  assert.equal(f.answers().length, 1); assert.equal(f.answers()[0]!.requestId, submitted.command.requestId); assert.equal(f.questions()[0]!.status, 'ANSWERED');
  assert.equal(f.launches.length, 2); assert.equal(f.discovery().sessionId, first.sessionId); assert.equal(f.discovery().snapshotId, first.snapshotId);
  value(await f.interview.answer(f.peer, submitted.command)); await f.service.idle(); assert.equal(f.launches.length, 2);
  const changed = JSON.parse(submitted.command.canonicalIntent); changed.payload.text = 'Payload differente';
  assert.deepEqual(await f.interview.answer(f.peer, { ...submitted.command, canonicalIntent: canonicalDiscoveryIntent(changed) }), { ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.answers().length, 1);
});
test('UNKNOWN and an intentional correction append answer revisions without rewriting the original', async t => {
  const f = await fixture(t); value((await f.answer(f.intent('UNKNOWN', ''))).accepted); await f.service.idle();
  assert.equal(f.questions()[0]!.status, 'UNKNOWN_ACCEPTED'); const original = f.answers()[0]!;
  await f.publish(); value((await f.answer(f.intent('ANSWER', 'Ora conosco i destinatari', '2', original.questionId))).accepted); await f.service.idle();
  assert.deepEqual(f.answers().map(a => [a.revision, a.kind]), [['1', 'UNKNOWN'], ['2', 'ANSWER']]); assert.deepEqual(f.answers()[0], original); assert.equal(f.launches.length, 3);
});
test('a saved answer survives context mismatch without another run or reuse of the grant', async t => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(t, async point => { if (point === 'discovery.answer.beforeRevalidation') await gate; });
  const submitted = await f.answer(); value(submitted.accepted);
  try { assert.equal(f.answers().length, 1); await writeFile(join(f.repo, 'tracked.txt'), 'changed after consent\n'); } finally { release(); }
  await f.service.idle(); assert.equal(f.answers().length, 1); assert.equal(f.launches.length, 1); assert.equal(f.discovery().state, 'STALE');
  assert.equal(f.store.getDiscoveryOperation(submitted.command.requestId)!.error, 'CONTEXT_CHANGED');
});
test('missing grant, stale revisions, oversized answers and max turns cannot consume another run', async t => {
  const f = await fixture(t), raw = f.intent();
  assert.deepEqual(await f.interview.answer(f.peer, { requestId: randomUUID(), grantId: null, canonicalIntent: canonicalDiscoveryIntent(raw) }), { ok: false, code: 'APPROVAL_REQUIRED' });
  assert.equal((await f.service.prepare(f.peer, { ...raw, stateRevision: '1' })).ok, false);
  assert.equal((await f.service.prepare(f.peer, f.intent('ANSWER', 'a'.repeat(4097)))).ok, false);
  f.database.prepare('UPDATE discovery_runs SET turn_index=20 WHERE run_id=?').run(f.discovery().currentRunId);
  assert.deepEqual(await f.service.prepare(f.peer, f.intent()), { ok: false, code: 'DISCOVERY_LIMIT' });
  assert.equal(f.answers().length, 0); assert.equal(f.launches.length, 1);
});
test('question count and byte caps reject publication rather than truncating or accepting provider IDs', async t => {
  const f = await fixture(t); value((await f.answer()).accepted); await f.service.idle();
  await assert.rejects(f.publish(undefined, { kind: 'QUESTIONS', questions: Array.from({ length: 20 }, () => ({ ...result.questions[0]! })) }), /DISCOVERY_LIMIT/);
  assert.equal(f.questions().length, 1);
});
