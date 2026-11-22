import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { createDiscoveryRuntime } from '../../src/core/discovery/runtime.js';
import { createAgentRuntime } from '../../src/platform/macos/discovery/agent-runtime.js';
import { createCodexOutputDecoder } from '../../src/providers/codex/parser.js';
import { waitFor, agentDeadline } from '../fixtures/discovery-agent-runtime.js';
import { inspectDiscovery } from '../../src/core/inspect-main.js';
import type { StoragePort } from '../../src/ports/storage.js';
async function snapshot(root: string): Promise<unknown> { const files = await readdir(root, { recursive: true, withFileTypes: true }); return Promise.all(files.filter(f => f.isFile()).map(async f => [join(f.parentPath, f.name).slice(root.length), (await readFile(join(f.parentPath, f.name))).toString('base64')]).sort()); }
test('G3 local process flow: question, portable answer, draft, correction, exact approval and current eligibility', async t => {
  let stopped = false; const f = await launchFixture(t, { cleanupAllowed: () => stopped }), before = await snapshot(f.repo);
  f.provider.createOutputDecoder = createCodexOutputDecoder;
  f.provider.buildInvocation = async (_c, cwd) => ({ ok: true, value: { executable: process.execPath, args: [fileURLToPath(new URL('../fixtures/discovery-jsonl-provider.js', import.meta.url)), 'flow'], cwd, env: { HOME: cwd, PATH: '/usr/bin:/bin' } } });
  const runtime = createDiscoveryRuntime(f.store as unknown as StoragePort, f.paths, f.instanceId, { provider: f.provider, context: f.context, createAgent: callbacks => createAgentRuntime({ storage: f.store as unknown as StoragePort, paths: f.paths, instanceId: f.instanceId, ...callbacks, providerModuleUrl: new URL('../fixtures/discovery-agent-launcher.js', import.meta.url).href }) });
  try {
    await runtime.recover(); const service = runtime.operations, g = value(await service.prepare(f.peer, f.intent())), startId = randomUUID();
    value(await service.startGranted(f.peer, { requestId: startId, grantId: g.grantId, projectId: f.projectId })); await service.idle();
    const discoveryId = f.store.getDiscoveryOperation(startId)!.discoveryId!, d = () => value(f.store.readDiscoveryMetadata({ kind: 'discovery', id: discoveryId })).data!;
    await waitFor(() => d().state === 'WAITING_USER', 5000);
    const q = value(f.store.readDiscoveryMetadata({ kind: 'questions', id: discoveryId })).data.items[0]!;
    const intent = f.intent({ action: 'answer', targetId: q.questionId, stateRevision: d().stateRevision, payload: { questionId: q.questionId, questionRevision: q.revision, answerId: randomUUID(), answerRevision: '1', kind: 'ANSWER', text: 'Distribuzione locale.' } });
    const answer = value(await service.prepare(f.peer, intent)); value(await service.answer(f.peer, { requestId: randomUUID(), grantId: answer.grantId, canonicalIntent: answer.canonicalIntent })); await service.idle();
    await waitFor(() => d().state === 'READY_FOR_REVIEW', 5000); const firstId = d().latestDocumentRevisionId!;
    const correction = value(await service.prepare(f.peer, f.intent({ action: 'correct', targetId: discoveryId, stateRevision: d().stateRevision, payload: { revisionId: firstId, correctionId: randomUUID(), correction: 'Esplicita meglio ciò che manca.' } })));
    value(await service.correct(f.peer, { requestId: randomUUID(), grantId: correction.grantId, canonicalIntent: correction.canonicalIntent })); await service.idle(); await waitFor(() => d().state === 'READY_FOR_REVIEW', 5000);
    assert.notEqual(d().latestDocumentRevisionId, firstId); const r = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: d().latestDocumentRevisionId! })).data!; assert.equal(r.parentRevisionId, firstId);
    assert.equal((await service.prepare(f.peer, f.intent({ action: 'approve', targetId: discoveryId, stateRevision: d().stateRevision, payload: { revisionId: firstId, bundleDigest: r.bundleDigest, acceptedUnknownIds: [] } }))).ok, false);
    const approval = value(await service.prepare(f.peer, f.intent({ action: 'approve', targetId: discoveryId, stateRevision: d().stateRevision, payload: { revisionId: r.revisionId, bundleDigest: r.bundleDigest, acceptedUnknownIds: ['conventions-and-operations:0'] } })));
    value(await service.approve(f.peer, { requestId: randomUUID(), grantId: approval.grantId, canonicalIntent: approval.canonicalIntent })); await service.idle(); assert.equal(d().state, 'APPROVED'); assert.equal(f.counts().runs, 3);
    const check = await service.eligibility(f.peer, f.projectId); await service.idle(); assert.equal((await service.eligibility(f.peer, f.projectId, check.checkId!)).eligible, true);
    assert.equal((await inspectDiscovery(f.directory, 'discovery.document.get', { revisionId: firstId })).result, 'OK'); assert.equal((await inspectDiscovery(f.directory, 'discovery.eligibility.get', { projectId: f.projectId })).data.eligible, false);
    assert.deepEqual(await snapshot(f.repo), before);
  } finally { await runtime.stop(agentDeadline()); stopped = true; }
});
