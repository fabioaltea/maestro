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

test('verify of an unknown project is a durable PROJECT_NOT_FOUND outcome rather than invalid input', async t => {
  const a = await createProjectHarness(t);
  const result = await a.client.runProject('verify', { projectId: randomUUID() }, { stateDirectory: a.h.archive });
  assert.equal(result.outcome, 'FAILED', JSON.stringify(result)); assert.equal(result.error?.code, 'PROJECT_NOT_FOUND');
  assert.equal(decodeProjectOperationView(result.data.operation).result!.effect, 'NONE');
});

test('corrupt and inaccessible archives report explicit failures without producing an empty successful list', async t => {
  const { createRegistryStore } = await import('../fixtures/registry-store.js');
  const { createPlatformPaths } = await import('../../src/platform/macos/paths.js');
  const { writeFile, chmod, readFile, readdir } = await import('node:fs/promises');
  const { LocalClient } = await import('../../src/client/local-client.js');
  const { createClientBackend } = await import('../../src/bootstrap.js');
  const f = await createRegistryStore(t); f.store.close();
  const paths = (await createPlatformPaths().resolveArchive(f.directory, 'read'))!;
  await writeFile(paths.stateFile, 'not a SQLite archive\n', { mode: 0o600 });
  const client = new LocalClient(createClientBackend()), before = await readFile(paths.stateFile), names = await readdir(f.directory);
  const corrupt = await client.runProject('list', {}, { stateDirectory: f.directory });
  assert.equal(corrupt.error?.code, 'STATE_CORRUPT', JSON.stringify(corrupt));
  assert.deepEqual(await readFile(paths.stateFile), before); assert.deepEqual(await readdir(f.directory), names);
  await chmod(paths.stateFile, 0);
  try {
    const denied = await client.runProject('list', {}, { stateDirectory: f.directory });
    assert.equal(denied.result, 'ERROR'); assert.ok(denied.error); assert.equal(denied.data.projects, undefined);
  } finally { await chmod(paths.stateFile, 0o600); }
});
