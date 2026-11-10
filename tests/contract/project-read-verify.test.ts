import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProjectHarness } from '../fixtures/project-client.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';

test('live registry pages are bounded and store/revision bound; observations remain LAST_KNOWN', async t => {
  const a = await createProjectHarness(t), b = await createProjectHarness(t);
  for (const name of ['page-a', 'page-b', 'page-c']) await a.register(await a.f.createRepository(name));
  const first = await a.client.runProject('list', { limit: 1 }, { stateDirectory: a.h.archive });
  assert.equal(first.result, 'OK', JSON.stringify(first)); assert.equal(first.freshness, 'LIVE');
  const page = first.data as { projects: { projectId: string; observation: { freshness: string } }[]; nextCursor: string; registryRevision: string };
  assert.equal(page.projects.length, 1); assert.equal(page.projects[0]!.observation.freshness, 'LAST_KNOWN');
  assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 60 * 1024); assert.ok(page.nextCursor);
  const next = await a.other.runProject('list', { limit: 100, cursor: page.nextCursor }, { stateDirectory: a.h.archive });
  assert.equal(next.result, 'OK'); assert.equal((next.data.projects as unknown[]).length, 2);
  const foreign = await b.client.runProject('list', { cursor: page.nextCursor }, { stateDirectory: b.h.archive });
  assert.equal(foreign.result, 'ERROR');
  await a.register(await a.f.createRepository('changed'));
  const stale = await a.client.runProject('list', { cursor: page.nextCursor }, { stateDirectory: a.h.archive });
  assert.equal(stale.error?.code, 'REGISTRY_CHANGED'); assert.equal(stale.error.nextAction, 'restart-list');
});

test('verify persists OBSERVED with stable configuration; CLI list and offline operation use the same archive', async t => {
  const a = await createProjectHarness(t), added = await a.register(await a.f.createRepository('verify-contract'));
  const requestId = randomUUID();
  const verified = await a.other.runProject('verify', { projectId: added.projectId }, { stateDirectory: a.h.archive, requestId });
  assert.equal(verified.outcome, 'SUCCEEDED', JSON.stringify(verified));
  const result = decodeProjectOperationView(verified.data.operation).result!;
  assert.equal(result.effect, 'OBSERVED'); assert.equal(result.configRevision, '1'); assert.equal(result.observationRevision, '2');
  assert.equal((await a.h.call('stop')).code, 0);
  const listed = await invokeCli(['project', 'list', '--limit', '100', '--state-dir', a.h.archive, '--json']);
  assert.equal(listed.code, 0, listed.stdout); assert.equal(JSON.parse(listed.stdout).freshness, 'LAST_KNOWN');
  const historical = await a.client.runProject('operation', { requestId }, { stateDirectory: a.h.archive });
  assert.deepEqual(decodeProjectOperationView(historical.data.operation).result, result);
});
