import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { createDiscoveryRuntime } from '../../src/core/discovery/runtime.js';
import { createAgentRuntime } from '../../src/platform/macos/discovery/agent-runtime.js';
import { createCodexOutputDecoder } from '../../src/providers/codex/parser.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { agentDeadline, waitFor } from '../fixtures/discovery-agent-runtime.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { createTestContext } from '../fixtures/test-context.js';
import type { StoragePort } from '../../src/ports/storage.js';

test('headless answer/cancel preserve the original UUID, expose portable history and remain readable offline', async t => {
  let stopped = false; const f = await launchFixture(t, { cleanupAllowed: () => stopped });
  f.provider.createOutputDecoder = createCodexOutputDecoder;
  f.provider.buildInvocation = async (_c, cwd) => ({ ok: true, value: { executable: process.execPath, args: [fileURLToPath(new URL('../fixtures/discovery-jsonl-provider.js', import.meta.url)), 'success'], cwd, env: { HOME: cwd, PATH: '/usr/bin:/bin' } } });
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context,
    createAgent: callbacks => createAgentRuntime({ storage: f.store as unknown as StoragePort, paths: f.paths, instanceId: f.instanceId, ...callbacks, providerModuleUrl: new URL('../fixtures/discovery-agent-launcher.js', import.meta.url).href }) });
  const key = await createPlatformPaths().createCredential(f.paths.clientKeyFile);
  const server = await createLocalTransport().listen(f.paths.daemonEndpoint, f.instanceId, new Map([[key, 'client']]), async (request, peer) => request.method === 'status.get'
    ? { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: { storeId: f.storeId, instanceId: f.instanceId, lifecycle: 'RUNNING', capabilities: { discoveryVersion: 1, discoveryMethods: runtime.methods } } }
    : runtime.dispatch(request, peer, f.store.readSnapshot()!));
  const call = async (...args: string[]) => JSON.parse((await invokeCli(['discovery', ...args, '--state-dir', f.directory, '--json'])).stdout);
  try {
    await runtime.recover(); const prepared = value(await runtime.operations.prepare(f.peer, f.intent())), startId = randomUUID();
    value(await runtime.operations.startGranted(f.peer, { requestId: startId, grantId: prepared.grantId, projectId: f.projectId })); await runtime.operations.idle();
    const initial = f.store.getDiscoveryOperation(startId)!;
    const discovery = () => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: initial.discoveryId! })).data!;
    await waitFor(() => discovery().state === 'WAITING_USER', 5000);
    const q = (await call('questions', initial.discoveryId!)).data.items[0], answer = { kind: 'ANSWER', text: 'Distribuzione soltanto locale.' }, body = join(f.directory, 'answer.json'), intentFile = join(f.directory, 'intent.json');
    await writeFile(body, JSON.stringify(answer)); await writeFile(intentFile, JSON.stringify(f.intent({ action: 'answer', targetId: q.questionId, stateRevision: discovery().stateRevision,
      payload: { questionId: q.questionId, questionRevision: q.revision, answerId: randomUUID(), answerRevision: '1', ...answer } })));
    const grant = (await call('prepare', `--intent-file=${intentFile}`)).data.grantId, requestId = randomUUID();
    const accepted = await call('answer', q.questionId, `--answer-file=${body}`, `--grant=${grant}`, `--request-id=${requestId}`);
    assert.equal(accepted.data.accepted, true); assert.equal(accepted.requestId, requestId); await runtime.operations.idle();
    await waitFor(() => discovery().state === 'WAITING_USER', 5000); assert.equal(f.counts().runs, 2);
    assert.equal((await call('operation', requestId)).data.operation.action, 'answer');
    assert.equal((await call('answer', q.questionId, `--answer-file=${body}`, `--grant=${grant}`, `--request-id=${requestId}`)).data.accepted, true); assert.equal(f.counts().runs, 2);
    const questions = (await call('questions', initial.discoveryId!)).data.items;
    assert.equal(questions.find((item: { questionId: string }) => item.questionId === q.questionId).answer.text, answer.text);
    const d = discovery(); await writeFile(intentFile, JSON.stringify(f.intent({ action: 'cancel', targetId: d.discoveryId, stateRevision: d.stateRevision, modelId: null, providerProfileDigest: null, payload: {} })));
    const cancelGrant = (await call('prepare', `--intent-file=${intentFile}`)).data.grantId;
    assert.equal((await call('cancel', d.discoveryId, `--grant=${cancelGrant}`, `--request-id=${randomUUID()}`)).data.accepted, true);
    await runtime.operations.idle(); assert.equal(discovery().state, 'CANCELLED');
    await server.close(); await runtime.stop(agentDeadline()); stopped = true;
    assert.equal((await call('questions', initial.discoveryId!)).freshness, 'LAST_KNOWN'); assert.equal((await call('output', initial.runId!)).data.items.length > 0, true);
  } finally { await server.close(); await runtime.stop(agentDeadline()); stopped = true; }
});
test('answer file schemas, byte caps and unrelated flags are rejected before contacting an archive', async t => {
  const f = await createTestContext(t), body = join(f.directory, 'answer.json'), questionId = randomUUID(), requestId = randomUUID();
  for (const raw of [{ kind: 'ANSWER', text: 'x'.repeat(4097) }, { kind: 'ANSWER', text: 'ok', approved: true }, { kind: 'UNKNOWN', text: '\ud800' }]) {
    await writeFile(body, JSON.stringify(raw));
    const result = JSON.parse((await invokeCli(['discovery', 'answer', questionId, `--answer-file=${body}`, `--grant=${randomUUID()}`, `--request-id=${requestId}`, '--state-dir', f.directory, '--json'])).stdout);
    assert.equal(result.error.code, 'INVALID_REQUEST'); assert.equal(result.requestId, requestId);
  }
  const flags = JSON.parse((await invokeCli(['discovery', 'cancel', questionId, `--grant=${randomUUID()}`, `--answer-file=${body}`, '--state-dir', f.directory, '--json'])).stdout);
  assert.equal(flags.error.code, 'INVALID_REQUEST');
});
