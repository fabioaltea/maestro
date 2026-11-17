import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import type { PublicResult } from '../../src/protocol/messages.js';
import { createDiscoveryMetadataFixture } from '../fixtures/discovery-metadata.js';
import { createRegistryV3 } from '../fixtures/discovery-schema-v3.js';
import { createTestContext } from '../fixtures/test-context.js';
import { loadContract } from '../fixtures/load-contract.js';
const reader = async () => (await loadContract<{ inspectDiscovery(directory: string, method: string, params: Record<string, unknown>): Promise<PublicResult> }>('core/inspect-main.js', ['inspectDiscovery'])).inspectDiscovery;

test('offline metadata reads preserve files and never need source, provider, login or an upgrade', async t => {
  const f = await createDiscoveryMetadataFixture(t); f.store.close(); f.database.close();
  const inspect = await reader(), before = await readFile(f.path), files = (await readdir(f.directory)).sort();
  const result = await inspect(f.directory, 'discovery.get', { discoveryId: f.discovery.discoveryId });
  assert.equal(result.result, 'OK'); assert.equal(result.freshness, 'LAST_KNOWN'); assert.equal((result.data.discovery as { discoveryId: string }).discoveryId, f.discovery.discoveryId);
  assert.doesNotMatch(JSON.stringify(result), /canonicalIntent|payloadHash|credentialRef|hostEndpoint|authProfileRef/);
  const operation = await inspect(f.directory, 'discovery.operation.get', { requestId: f.run.requestId });
  assert.equal((operation.data.operation as { outcome: string }).outcome, 'IN_PROGRESS');
  assert.equal(operation.freshness, 'LAST_KNOWN'); assert.deepEqual(await readFile(f.path), before); assert.deepEqual((await readdir(f.directory)).sort(), files);
});
test('offline eligibility is UNKNOWN and false even for a historically approved revision', async t => {
  const f = await createDiscoveryMetadataFixture(t); f.exit(f.run);
  const revisionId = randomUUID(), artifactId = f.artifact('DOCUMENT');
  f.commit({ kind: 'revision', runId: f.run.runId, generation: f.run.generation, expectedRevision: '1', value: { revisionId, discoveryId: f.discovery.discoveryId, revisionNumber: '1', parentRevisionId: null, snapshotId: f.snapshot.snapshotId, contextDigest: f.run.contextDigest, artifactId, bundleDigest: 'a'.repeat(64), bytes: 12, provenanceValidated: true, status: 'READY_FOR_REVIEW' } });
  const requestId = randomUUID(), grantId = randomUUID();
  const admitted = f.store.admitDiscoveryOperation({ ...f.prepare('approve', f.discovery.discoveryId, '2', { revisionId, bundleDigest: 'a'.repeat(64), acceptedUnknownIds: [] }, requestId, grantId), discovery: { ...f.discovery, state: 'READY_FOR_REVIEW', stateRevision: '2', latestDocumentRevisionId: revisionId }, run: null, expectedStateRevision: '2', acquireSlot: false }); assert.equal(admitted.ok, true);
  f.commit({ kind: 'approval', expectedRevision: '2', requiredUnknownIds: [], value: { approvalId: randomUUID(), requestId, storeId: f.storeId, projectId: f.projectId, discoveryId: f.discovery.discoveryId, revisionId, bundleDigest: 'a'.repeat(64), configRevision: '1', contextDigest: f.run.contextDigest, acceptedUnknownIds: [], ownerUid: process.getuid!(), approvedAt: f.at, checkedAt: f.at } });
  f.store.close(); f.database.close();
  const result = await (await reader())(f.directory, 'discovery.eligibility.get', { projectId: f.projectId });
  assert.equal(result.result, 'OK'); assert.equal(result.freshness, 'LAST_KNOWN'); assert.equal(result.data.eligible, false); assert.equal(result.data.freshness, 'UNKNOWN'); assert.equal(result.data.checkId, null);
});
test('Discovery read of schema3 is unavailable and byte-preserving rather than migrating', async t => {
  const context = await createTestContext(t), directory = await realpath(context.directory), f = createRegistryV3(directory);
  const before = await readFile(f.path), files = (await readdir(directory)).sort();
  const result = await (await reader())(directory, 'discovery.list', { projectId: f.projectId });
  assert.equal(result.error?.code, 'DISCOVERY_NOT_INITIALIZED'); assert.deepEqual(await readFile(f.path), before); assert.deepEqual((await readdir(directory)).sort(), files);
});
test('shipped CLI reads actual daemon capabilities and the same registry offline without starting a provider', async t => {
  const { createCliHarness, invokeCli } = await import('../fixtures/cli-harness.js');
  const { createProjectRepositories } = await import('../fixtures/project-repositories.js');
  const h = await createCliHarness(t), repositories = await createProjectRepositories(t), repo = await repositories.createRepository('headless');
  assert.equal((await h.call('start')).code, 0);
  const imported = await invokeCli(['project', 'add', repo, '--state-dir', h.archive, '--json']); assert.equal(imported.code, 0, imported.stdout);
  const projectId = JSON.parse(imported.stdout).data.operation.result.projectId as string;
  const before = await repositories.snapshotTree(repo);
  const run = (...args: string[]) => invokeCli(['discovery', ...args, '--state-dir', h.archive, '--json']);
  const provider = await run('provider', 'get'); assert.equal(provider.code, 0, provider.stdout); assert.equal(JSON.parse(provider.stdout).freshness, 'LIVE'); assert.equal(JSON.parse(provider.stdout).data.configuration, null);
  const listed = await run('list', projectId); assert.equal(listed.code, 0, listed.stdout); assert.deepEqual(JSON.parse(listed.stdout).data.items, []);
  const status = JSON.parse((await h.call('status')).stdout); assert.equal(status.data.capabilities.discoveryVersion, 1); assert.ok(!status.data.capabilities.discoveryMethods.includes('discovery.start'));
  assert.equal((await h.call('stop')).code, 0);
  const offline = await run('list', projectId); assert.equal(offline.code, 0, offline.stdout); assert.equal(JSON.parse(offline.stdout).freshness, 'LAST_KNOWN'); assert.deepEqual(JSON.parse(offline.stdout).data.items, []);
  assert.deepEqual(await repositories.snapshotTree(repo), before);
});
