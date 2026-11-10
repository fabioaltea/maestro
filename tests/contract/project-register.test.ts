import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createCliHarness, invokeCli } from '../fixtures/cli-harness.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { createClientBackend } from '../../src/bootstrap.js';
import { LocalClient } from '../../src/client/local-client.js';
import { requireUuid } from '../../src/domain/identifiers.js';

interface CliProjectResult { requestId: string; outcome: string; error: { code: string } | null; freshness: string;
  data: { projectId: string; effect: string; accepted: boolean; configRevision: string;
    project: { projectId: string; displayName: string; referenceCheckout: string; baseBranch: string | null; configRevision: string } } }

test('project add/show/operation expose stable IDs, confirmed configuration and dated offline outcomes', async t => {
  const h = await createCliHarness(t), f = await createProjectRepositories(t);
  const repo = await f.createRepository('contract project 🎼');
  assert.equal((await h.call('start')).code, 0);
  const requestId = randomUUID();
  const added = await invokeCli(['project', 'add', repo, '--name', 'Maestro 🎼', '--request-id', requestId, '--state-dir', h.archive, '--json']);
  assert.equal(added.code, 0, added.stdout || added.stderr);
  const result = JSON.parse(added.stdout) as CliProjectResult;
  assert.equal(result.requestId, requestId); assert.equal(result.outcome, 'SUCCEEDED');
  assert.equal(result.data.accepted, true); assert.equal(result.data.effect, 'CREATED');
  assert.equal(requireUuid(result.data.projectId), result.data.projectId); assert.equal(result.data.configRevision, '1');
  const shown = await invokeCli(['project', 'show', result.data.projectId, '--state-dir', h.archive, '--json']);
  assert.equal(shown.code, 0, shown.stdout);
  const detail = (JSON.parse(shown.stdout) as CliProjectResult).data.project;
  assert.equal(detail.displayName, 'Maestro 🎼'); assert.equal(detail.referenceCheckout, repo);
  assert.equal(detail.baseBranch, 'fixture-base'); assert.equal(detail.configRevision, '1');
  assert.doesNotMatch(shown.stdout, /"(?:repositoryIdentity|birthtimeNs|canonicalIntent|payloadHash)"\s*:/);
  const client = new LocalClient(createClientBackend());
  const other = await client.runProject('get', { projectId: detail.projectId }, { stateDirectory: h.archive });
  assert.equal(other.result, 'OK');
  assert.equal((other.data.project as { projectId: string }).projectId, detail.projectId);
  assert.equal((await h.call('stop')).code, 0);
  const historical = await invokeCli(['project', 'operation', requestId, '--state-dir', h.archive, '--json']);
  assert.equal(historical.code, 0, historical.stdout);
  const saved = JSON.parse(historical.stdout) as CliProjectResult;
  assert.equal(saved.freshness, 'LAST_KNOWN'); assert.equal(saved.data.projectId, detail.projectId);
});

test('project CLI rejects invalid fields and extra authority; an unavailable daemon never autostarts', async t => {
  const h = await createCliHarness(t);
  for (const args of [
    ['add'], ['add', '/a', '--base-branch'], ['add', '/a', '--base-branch', ''],
    ['add', '/a', '--name', 'a\nb'], ['add', '/a', '--force'], ['show', 'not-a-uuid'], ['operation', 'not-a-uuid'],
    ['add', '/a', '--owner-uid', '0'], ['add', '/a', '--timeout-ms', '30001'],
  ]) {
    const result = await invokeCli(['project', ...args, '--state-dir', h.archive, '--json']);
    assert.equal(result.code, 2, result.stdout || result.stderr);
  }
  const requestId = randomUUID();
  const absent = await invokeCli(['project', 'add', '/never-initialized', '--request-id', requestId, '--state-dir', h.archive, '--json']);
  assert.equal(absent.code, 5, absent.stdout);
  const result = JSON.parse(absent.stdout) as CliProjectResult;
  assert.equal(result.error?.code, 'DAEMON_UNAVAILABLE'); assert.equal(result.requestId, requestId);
  const { lstat } = await import('node:fs/promises');
  await assert.rejects(lstat(h.archive), { code: 'ENOENT' });
});

test('Foundation v1 without registry capability receives no mutation from a registry client', async t => {
  const h = await createCliHarness(t);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'write'))!;
  const key = await adapter.createCredential(paths.clientKeyFile);
  const instanceId = randomUUID(); let mutations = 0;
  const server = await createLocalTransport().listen(paths.daemonEndpoint, instanceId, new Map([[key, 'client']]), async request => {
    if (request.method !== 'status.get') mutations++;
    return { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: {
      storeId: randomUUID(), instanceId, ready: true, lifecycle: 'RUNNING',
    } };
  });
  try {
    const client = new LocalClient(createClientBackend());
    const result = await client.runProject('register', { path: join(h.directory, 'not-probed') }, { stateDirectory: h.archive });
    assert.equal(result.error?.code, 'UNSUPPORTED_VERSION'); assert.equal(mutations, 0);
  } finally { await server.close(); }
});
