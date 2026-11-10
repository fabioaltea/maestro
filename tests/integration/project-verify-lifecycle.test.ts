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
