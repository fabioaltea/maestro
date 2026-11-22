import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rename, lstat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';
import type { EventRecord } from '../../src/ports/storage.js';

interface Result { requestId: string; outcome: string; freshness: string; error: { code: string } | null;
  data: { projectId: string; effect: string; configRevision: string; operation: { result: unknown };
    tombstone: { projectId: string; configRevision: string; removedAt: string }; events: { records: EventRecord[] } } }

test('US4 CLI: dirty/absent removal, reimport and old retry preserve all Git data and durable correlated history', async t => {
  const a = await createProjectHarness(t), main = await a.f.createRepository('remove-main'), linked = await a.f.addWorktree(main, 'remove-linked');
  await a.f.makeDirty(linked);
  const absent = await a.f.createRepository('remove-absent'); await a.f.makeDirty(absent);
  const first = await a.register(linked), missing = await a.register(absent), other = await a.register(await a.f.createRepository('unrelated'));
  const untouched = await a.get(other.projectId!);
  await rename(absent, absent + '.saved');
  const source = await snapshotArchive(a.f.directory), state = ['--state-dir', a.h.archive, '--json'];
  const removed: Result[] = [];
  for (const projectId of [first.projectId!, missing.projectId!]) {
    const requestId = randomUUID();
    const command = await invokeCli(['project', 'remove', projectId, '--expected-revision', '1', '--request-id', requestId, ...state]);
    assert.equal(command.code, 0, command.stdout || command.stderr);
    const result = JSON.parse(command.stdout) as Result;
    assert.equal(result.data.effect, 'REMOVED'); assert.equal(result.data.configRevision, '2'); removed.push(result);
    const tombstone = await invokeCli(['project', 'show', projectId, ...state]); assert.equal(tombstone.code, 4, tombstone.stdout);
    const saved = JSON.parse(tombstone.stdout) as Result; assert.equal(saved.error?.code, 'PROJECT_REMOVED');
    assert.equal(saved.data.tombstone.projectId, projectId); assert.equal(saved.data.tombstone.configRevision, '2');
  }
  const reimported = await invokeCli(['project', 'add', linked, ...state]); assert.equal(reimported.code, 0, reimported.stdout);
  const next = JSON.parse(reimported.stdout) as Result; assert.notEqual(next.data.projectId, first.projectId); assert.equal(next.data.configRevision, '1');
  const retry = await invokeCli(['project', 'remove', first.projectId!, '--expected-revision', '1', '--request-id', removed[0]!.requestId, ...state]);
  assert.equal(retry.code, 0, retry.stdout); assert.deepEqual((JSON.parse(retry.stdout) as Result).data.operation.result, removed[0]!.data.operation.result);
  assert.equal((await a.get(next.data.projectId)).projectId, next.data.projectId); assert.deepEqual(await a.get(other.projectId!), untouched);
  assert.equal((await a.h.call('restart')).code, 0); assert.equal((await a.get(next.data.projectId)).configRevision, '1');
  const eventPage = JSON.parse((await a.h.call('events', '--limit', '100')).stdout) as Result;
  const completions = removed.map(result => {
    const records = eventPage.data.events.records.filter(event => event.operationId === result.requestId && event.type === 'operation.completed');
    assert.equal(records.length, 1); const event = records[0]!;
    assert.equal(event.payload.action, 'REMOVE'); assert.equal(event.payload.projectId, result.data.projectId); assert.equal(event.payload.configRevision, '2');
    return event;
  });
  assert.equal((await a.h.call('stop')).code, 0);
  const archive = await snapshotArchive(a.h.archive);
  for (const result of removed) {
    const query = await invokeCli(['project', 'operation', result.requestId, ...state]); assert.equal(query.code, 0, query.stdout);
    const saved = JSON.parse(query.stdout) as Result; assert.equal(saved.freshness, 'LAST_KNOWN'); assert.deepEqual(saved.data.operation.result, result.data.operation.result);
    const shown = await invokeCli(['project', 'show', result.data.projectId, ...state]); assert.equal(shown.code, 4, shown.stdout);
    const tombstone = JSON.parse(shown.stdout) as Result; assert.equal(tombstone.freshness, 'LAST_KNOWN'); assert.equal(tombstone.data.tombstone.configRevision, '2');
  }
  const listed = await a.other.runProject('list', {}, { stateDirectory: a.h.archive });
  assert.deepEqual((listed.data.projects as { projectId: string }[]).map(project => project.projectId).sort(), [next.data.projectId, other.projectId!].sort());
  assert.deepEqual(await snapshotArchive(a.h.archive), archive); assert.deepEqual(await snapshotArchive(a.f.directory), source);
  await assert.rejects(lstat(absent), { code: 'ENOENT' }); await lstat(linked); await lstat(join(main, '.git'));
  await writeFile(resolve('specs/002-project-registry/reports/us4-preservation-samples.json'), JSON.stringify({
    measuredAt: new Date().toISOString(), removed: removed.map(result => ({ requestId: result.requestId, projectId: result.data.projectId, originalResult: result.data.operation.result })),
    newProjectId: next.data.projectId, completions, oldRetryPreserved: true, unrelatedProjectPreserved: true,
    sourceUnchanged: true, missingCheckoutRecreations: 0, offlineWrites: 0, restartPreserved: true,
  }, null, 2) + '\n');
});
