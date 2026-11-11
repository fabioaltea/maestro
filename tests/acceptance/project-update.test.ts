import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';

interface Result { requestId: string; outcome: string; freshness: string; error: { code: string } | null;
  data: { effect: string; configRevision: string; operation: { result: unknown } } }

test('US3 CLI: two clients, explicit local base, unavailable reference rename/clear and durable original retry preserve Git', async t => {
  const a = await createProjectHarness(t), repo = await a.f.createRepository('acceptance-update');
  await a.f.git(repo, ['branch', 'candidate-base']); await a.f.makeDirty(repo);
  const added = await a.register(repo), before = await a.f.snapshotTree(repo);
  const state = ['--state-dir', a.h.archive, '--json'];
  const requestId = randomUUID();
  const setArgs = ['project', 'update', added.projectId!, '--expected-revision', '1', '--name', 'Initial explicit config', '--base-branch', 'candidate-base', '--request-id', requestId, ...state];
  const selected = await invokeCli(setArgs); assert.equal(selected.code, 0, selected.stdout);
  const original = JSON.parse(selected.stdout) as Result; assert.equal(original.data.configRevision, '2');
  const current = await a.get(added.projectId!); assert.equal(current.baseBranch, 'candidate-base');
  const concurrent = await Promise.all(['Client A', 'Client B'].map(name => invokeCli(['project', 'update', added.projectId!, '--expected-revision', '2', '--name', name, ...state])));
  assert.deepEqual(concurrent.map(result => result.code).sort(), [0, 2]);
  assert.equal((await a.get(added.projectId!)).configRevision, '3');
  await chmod(repo, 0);
  try {
    const changed = await invokeCli(['project', 'update', added.projectId!, '--expected-revision', '3', '--name', 'No repository access required', '--clear-base-branch', ...state]);
    assert.equal(changed.code, 0, changed.stdout); assert.equal((JSON.parse(changed.stdout) as Result).data.configRevision, '4');
  } finally { await chmod(repo, 0o755); }
  const confirmed = await a.get(added.projectId!);
  assert.equal(confirmed.baseBranch, null); assert.equal(confirmed.displayName, 'No repository access required');
  assert.equal(confirmed.observation.observedConfigRevision, '1'); assert.equal(confirmed.observation.observationRevision, '1');
  assert.equal((await a.h.call('restart')).code, 0); assert.deepEqual(await a.get(added.projectId!), confirmed);
  const retry = await invokeCli(setArgs); assert.equal(retry.code, 0, retry.stdout);
  assert.deepEqual((JSON.parse(retry.stdout) as Result).data.operation.result, original.data.operation.result);
  assert.deepEqual(await a.get(added.projectId!), confirmed); assert.deepEqual(await a.f.snapshotTree(repo), before);
  assert.equal((await a.h.call('stop')).code, 0);
  const archive = await snapshotArchive(a.h.archive);
  const history = await invokeCli(['project', 'operation', requestId, ...state]); assert.equal(history.code, 0, history.stdout);
  assert.equal((JSON.parse(history.stdout) as Result).freshness, 'LAST_KNOWN');
  assert.deepEqual((JSON.parse(history.stdout) as Result).data.operation.result, original.data.operation.result);
  assert.deepEqual(await snapshotArchive(a.h.archive), archive);
  await writeFile(resolve('specs/002-project-registry/reports/us3-preservation-samples.json'), JSON.stringify({
    measuredAt: new Date().toISOString(), projectId: added.projectId, originalRequestId: requestId,
    originalResult: original.data.operation.result, currentConfigRevision: confirmed.configRevision,
    twoClientResults: concurrent.map(result => ({ exitCode: result.code, result: JSON.parse(result.stdout) })),
    unavailableReferenceUpdate: true, restartPreserved: true, originalRetryPreserved: true,
    repositoryUnchanged: true, offlineWrites: 0,
  }, null, 2) + '\n');
});
