import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { createDiscoveryRuntime } from '../../src/core/discovery/runtime.js';
import { createAgentRuntime } from '../../src/platform/macos/discovery/agent-runtime.js';
import { createCodexOutputDecoder } from '../../src/providers/codex/parser.js';
import { agentDeadline, waitFor } from '../fixtures/discovery-agent-runtime.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import type { AuthenticatedPeer } from '../../src/ports/platform.js';

interface CancelOperations { cancelGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; discoveryId: string }): Promise<DiscoveryResult<unknown>> }
test('restart interrupts a durable run intent with no process record and never launches it automatically', async t => {
  const f = await launchFixture(t), grant = await f.prepare(); value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle();
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context });
  await runtime.recover();
  const d = value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: f.launches[0]!.discoveryId })).data!;
  assert.equal(d.state, 'INTERRUPTED'); assert.equal(f.launches.length, 1);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: d.currentRunId! })).data!.phase, 'FINALIZED');
  await runtime.stop(agentDeadline());
});
for (const state of ['RUNNING', 'WAITING_USER'] as const) test(`intentional cancel in ${state} proves local absence and preserves output/questions`, async t => {
  let stopped = false; const f = await launchFixture(t, { cleanupAllowed: () => stopped });
  f.provider.createOutputDecoder = createCodexOutputDecoder;
  f.provider.buildInvocation = async (_c, cwd) => ({ ok: true, value: { executable: process.execPath, args: [fileURLToPath(new URL('../fixtures/discovery-jsonl-provider.js', import.meta.url)), state === 'RUNNING' ? 'waiting' : 'success'], cwd, env: { HOME: cwd, PATH: '/usr/bin:/bin' } } });
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context,
    createAgent: callbacks => createAgentRuntime({ storage: f.store as unknown as StoragePort, paths: f.paths, instanceId: f.instanceId, ...callbacks, providerModuleUrl: new URL('../fixtures/discovery-agent-launcher.js', import.meta.url).href }) });
  try {
    await runtime.recover(); const grant = value(await runtime.operations.prepare(f.peer, f.intent())), requestId = randomUUID();
    value(await runtime.operations.startGranted(f.peer, { requestId, grantId: grant.grantId, projectId: f.projectId })); await runtime.operations.idle();
    const op = f.store.getDiscoveryOperation(requestId)!, read = () => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: op.discoveryId! })).data!;
    await waitFor(() => read().state === state && value(f.store.readDiscoveryMetadata({ kind: 'run', id: op.runId! })).data!.outputWatermark !== '0', 5000);
    const before = value(f.store.readDiscoveryMetadata({ kind: 'outputStatus', id: op.runId! })).data!, d = read();
    const prepared = value(await runtime.operations.prepare(f.peer, f.intent({ action: 'cancel', targetId: d.discoveryId, stateRevision: d.stateRevision, providerProfileDigest: null, modelId: null, payload: {} })));
    const input = { requestId: randomUUID(), grantId: prepared.grantId, discoveryId: d.discoveryId }, cancel = runtime.operations as unknown as CancelOperations;
    const started = performance.now(); value(await cancel.cancelGranted(f.peer, input)); await runtime.operations.idle();
    assert.ok(performance.now() - started < 4500); assert.equal(read().state, 'CANCELLED'); assert.equal(f.store.getDiscoveryOperation(input.requestId)!.outcome, 'SUCCEEDED');
    const after = value(f.store.readDiscoveryMetadata({ kind: 'outputStatus', id: op.runId! })).data!; assert.equal(after.bytes, before.bytes);
    if (state === 'WAITING_USER') assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'questions', id: d.discoveryId })).data.items.length, 1);
    value(await cancel.cancelGranted(f.peer, input)); await runtime.operations.idle(); assert.equal(f.counts().runs, 1);
  } finally { await runtime.stop(agentDeadline()); stopped = true; }
});
test('restart preserves WAITING_USER and an answer accepted before interruption without creating its continuation', async t => {
  let stopped = false; const f = await launchFixture(t, { cleanupAllowed: () => stopped });
  f.provider.createOutputDecoder = createCodexOutputDecoder;
  f.provider.buildInvocation = async (_c, cwd) => ({ ok: true, value: { executable: process.execPath, args: [fileURLToPath(new URL('../fixtures/discovery-jsonl-provider.js', import.meta.url)), 'success'], cwd, env: { HOME: cwd, PATH: '/usr/bin:/bin' } } });
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context,
    createAgent: callbacks => createAgentRuntime({ storage: f.store as unknown as StoragePort, paths: f.paths, instanceId: f.instanceId, ...callbacks, providerModuleUrl: new URL('../fixtures/discovery-agent-launcher.js', import.meta.url).href }) });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await runtime.recover(); const grant = value(await runtime.operations.prepare(f.peer, f.intent())), requestId = randomUUID();
    value(await runtime.operations.startGranted(f.peer, { requestId, grantId: grant.grantId, projectId: f.projectId })); await runtime.operations.idle();
    const op = f.store.getDiscoveryOperation(requestId)!;
    await waitFor(() => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: op.discoveryId! })).data?.state === 'WAITING_USER', 5000);
    const d = value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: op.discoveryId! })).data!, q = value(f.store.readDiscoveryMetadata({ kind: 'questions', id: d.discoveryId })).data.items[0]!;
    const answer = f.intent({ action: 'answer', targetId: q.questionId, stateRevision: d.stateRevision, payload: { questionId: q.questionId, questionRevision: q.revision, answerId: randomUUID(), answerRevision: '1', kind: 'UNKNOWN', text: '' } });
    const prepared = value(await runtime.operations.prepare(f.peer, answer)), answerRequest = randomUUID();
    f.context.revalidate = async () => { await gate; return { ok: true, value: { freshness: 'UNKNOWN', contextDigest: null, checkedAt: new Date().toISOString() } }; };
    value(await runtime.operations.answerGranted(f.peer, { requestId: answerRequest, grantId: prepared.grantId, questionId: q.questionId, kind: 'UNKNOWN', text: '' }));
    const reopened = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context });
    await reopened.recover();
    assert.equal(f.store.getDiscoveryOperation(answerRequest)!.outcome, 'INTERRUPTED');
    assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'answers', id: d.discoveryId })).data.items.length, 1);
    assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: d.discoveryId })).data!.state, 'WAITING_USER');
    assert.equal(f.counts().runs, 1); release(); await runtime.operations.idle(); await reopened.stop(agentDeadline());
  } finally { release(); await runtime.stop(agentDeadline()); stopped = true; }
});
