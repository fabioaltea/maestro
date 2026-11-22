import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createProjectHarness } from '../fixtures/project-client.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { openStorage } from '../../src/storage/worker.js';

test('20 equivalent concurrent imports and 100 identical retries preserve one project and original immutable results', async t => {
  const h = await createProjectHarness(t);
  const main = await h.f.createRepository('concurrent main 🎼');
  const linked = await h.f.addWorktree(main, 'concurrent-linked');
  const alias = join(h.f.directory, 'alias'); await symlink(main, alias);
  const subdir = join(main, 'subdir'); await mkdir(subdir);
  const beforeMain = await h.f.snapshotTree(main), beforeLinked = await h.f.snapshotTree(linked);
  const paths = [main, linked, alias, subdir];
  const intents = Array.from({ length: 20 }, (_, index) => ({ requestId: randomUUID(), params: { path: paths[index % paths.length]!, name: `Contender ${index}` } }));
  const imports = await Promise.all(intents.map(async intent => {
    const started = performance.now();
    const response = await h.client.runProject('register', intent.params, { stateDirectory: h.h.archive, requestId: intent.requestId });
    return { requestId: intent.requestId, durationMs: performance.now() - started, response };
  }));
  const sample = { measuredAt: new Date().toISOString(), imports: imports.map(item => ({ requestId: item.requestId,
    durationMs: item.durationMs, outcome: item.response.outcome, error: item.response.error?.code ?? null })), retries: [] as unknown[] };
  await writeFile(resolve('specs/002-project-registry/reports/register-concurrency-samples.json'), JSON.stringify(sample, null, 2) + '\n');
  const results = imports.map(item => {
    assert.equal(item.response.outcome, 'SUCCEEDED', JSON.stringify(item.response));
    assert.ok(item.durationMs <= 30_000);
    return decodeProjectOperationView(item.response.data.operation).result!;
  });
  assert.equal(new Set(results.map(result => result.projectId)).size, 1);
  assert.equal(results.filter(result => result.effect === 'CREATED').length, 1);
  assert.equal(results.filter(result => result.effect === 'EXISTING').length, 19);
  const winner = results.find(result => result.effect === 'CREATED')!;
  const originalIntent = intents.find(intent => intent.requestId === winner.requestId)!;
  const original = await h.get(winner.projectId!);
  assert.equal(original.configRevision, '1'); assert.equal(original.observation.observationRevision, '1');
  assert.deepEqual(await h.f.snapshotTree(main), beforeMain); assert.deepEqual(await h.f.snapshotTree(linked), beforeLinked);
  // External HEAD changes do not alter the stored intent or authorize fresh probes on retry.
  await h.f.git(main, ['checkout', '--detach']); await h.f.git(linked, ['checkout', '--detach']);
  const retryMain = await h.f.snapshotTree(main), retryLinked = await h.f.snapshotTree(linked);
  const reader = await openStorage({ path: join(h.h.archive, 'state.sqlite'), readonly: true });
  try {
    const resourceCount = (await reader.listResources(JSON.parse((await h.h.call('status')).stdout).instanceId)).length;
    const revision = (await reader.readSnapshot())!.store.revision;
    for (let wave = 0; wave < 10; wave++) {
      const replies = await Promise.all(Array.from({ length: 10 }, async () => {
        const started = performance.now();
        const reply = await h.other.runProject('register', originalIntent.params, { stateDirectory: h.h.archive, requestId: winner.requestId });
        return { reply, durationMs: performance.now() - started };
      }));
      for (const { reply, durationMs } of replies) {
        sample.retries.push({ requestId: reply.requestId, outcome: reply.outcome, error: reply.error?.code ?? null, durationMs });
        assert.deepEqual(decodeProjectOperationView(reply.data.operation).result, winner);
      }
    }
    const conflict = await h.other.runProject('register', { ...originalIntent.params, name: 'Changed intent' }, { stateDirectory: h.h.archive, requestId: winner.requestId });
    assert.equal(conflict.error?.code, 'IDEMPOTENCY_CONFLICT');
    const status = JSON.parse((await h.h.call('status')).stdout);
    const lifecycleId = status.data.currentOperation?.requestId;
    // The last successful lifecycle ID is available in its durable table.
    const database = new Database(join(h.h.archive, 'state.sqlite'), { readonly: true });
    let firstLifecycle: string;
    try {
      firstLifecycle = lifecycleId ?? (database.prepare('SELECT request_id FROM operations ORDER BY rowid LIMIT 1').get() as { request_id: string }).request_id;
      assert.equal((database.prepare('SELECT count(*) AS count FROM projects WHERE removed_at IS NULL').get() as { count: number }).count, 1);
      assert.equal((database.prepare('SELECT registry_revision FROM registry_metadata').get() as { registry_revision: number }).registry_revision, 1);
    } finally { database.close(); }
    const scopeConflict = await h.client.runProject('register', originalIntent.params, { stateDirectory: h.h.archive, requestId: firstLifecycle });
    assert.equal(scopeConflict.error?.code, 'IDEMPOTENCY_CONFLICT');
    const forbiddenStop = await h.h.call('stop', '--request-id', winner.requestId);
    assert.equal(forbiddenStop.code, 2, forbiddenStop.stdout);
    assert.equal((await reader.readSnapshot())!.store.revision, revision);
    assert.equal((await reader.listResources(status.instanceId)).length, resourceCount);
    assert.deepEqual(await h.get(winner.projectId!), original);
    const events = (await reader.listEvents({ limit: 100 })).records.filter(event => event.operationId === winner.requestId);
    assert.equal(events.length, 2);
  } finally { await reader.close(); }
  assert.equal(sample.retries.length, 100);
  assert.deepEqual(await h.f.snapshotTree(main), retryMain); assert.deepEqual(await h.f.snapshotTree(linked), retryLinked);
  await writeFile(resolve('specs/002-project-registry/reports/register-concurrency-samples.json'), JSON.stringify({ ...sample,
    confirmedProjects: 1, identicalRetries: 100, concurrentImports: 20, originalResultPreserved: true, repositoryUnchanged: true }, null, 2) + '\n');
});

test('closing the mutation transport after durable acceptance does not cancel the registration', async t => {
  const h = await createProjectHarness(t), repo = await h.f.createRepository('disconnected client');
  const before = await h.f.snapshotTree(repo);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.h.archive, 'read'))!;
  const key = await adapter.readCredential(paths.clientKeyFile), requestId = randomUUID();
  const admitted = await createLocalTransport().call(paths.daemonEndpoint, key, { protocolVersion: 1, correlationId: randomUUID(),
    method: 'projects.register', params: { requestId, path: repo } }, 1_000);
  assert.equal((admitted.data as { accepted: boolean }).accepted, true);
  // call() has closed that connection. A separate client observes the durable work.
  const deadline = performance.now() + 10_000;
  for (;;) {
    const observed = await h.other.runProject('operation', { requestId }, { stateDirectory: h.h.archive });
    if (observed.outcome !== 'IN_PROGRESS') { assert.equal(observed.outcome, 'SUCCEEDED', JSON.stringify(observed)); break; }
    assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(await h.f.snapshotTree(repo), before);
});
