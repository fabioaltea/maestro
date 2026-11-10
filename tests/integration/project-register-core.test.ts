import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, rename } from 'node:fs/promises';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createProjectOperations } from '../../src/core/projects/operations.js';
import { registerProject } from '../../src/core/projects/register.js';
import { openStorage } from '../../src/storage/worker.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createProbeSupervisor } from '../../src/platform/macos/git/probe-supervisor.js';
import { createFilesystemIdentity } from '../../src/platform/macos/git/filesystem-identity.js';
import { readProject } from '../../src/core/projects/read.js';
import { inspectProjectGet } from '../../src/core/inspect-main.js';

test('registration core uses real confined probes and commits through the storage worker without a public UI or Git mutation', async t => {
  const state = await createRegistryStore(t), f = await createProjectRepositories(t);
  const repo = await f.createRepository('core import 🎼');
  const before = await f.snapshotTree(repo);
  const paths = (await createPlatformPaths().resolveArchive(state.directory, 'write'))!;
  const storage = await openStorage({ path: state.path });
  const api = createProjectOperations({ storage, ownerUid: paths.ownerUid, instanceId: state.instanceId,
    supervisor: createProbeSupervisor({ paths, onResource: resource => storage.saveResource(resource) }),
    execute: context => registerProject(context, storage, createFilesystemIdentity()) });
  for (const context of [state.context, f.context]) {
    const cleanup = context.cleanup.bind(context);
    context.cleanup = async () => { assert.equal(await api.shutdown(), 'ABSENT', 'retain fixture if probe ownership is uncertain'); await storage.close(); await cleanup(); };
  }
  try {
    const requestId = randomUUID();
    assert.equal((await api.admit({ role: 'client' }, 'REGISTER', requestId, { path: repo })).accepted, true);
    const deadline = performance.now() + 10_000;
    let operation = await storage.getProjectOperation(requestId);
    while (operation?.outcome === 'IN_PROGRESS') {
      assert.ok(performance.now() < deadline);
      await new Promise(resolve => setTimeout(resolve, 10)); operation = await storage.getProjectOperation(requestId);
    }
    assert.equal(operation?.outcome, 'SUCCEEDED', JSON.stringify(operation));
    const project = await storage.getProject(operation!.projectId!);
    assert.equal(project?.project.referenceCheckout.root.canonicalPath, repo);
    assert.equal(project?.project.displayName, 'core import 🎼'); assert.equal(project?.project.baseBranch, 'fixture-base');
    assert.equal(project?.observation?.observationRevision, '1');
    const resources = await storage.listResources(state.instanceId);
    assert.equal(resources.length, 2); assert.ok(resources.every(resource => resource.releaseState === 'RELEASED'));
    const events = (await storage.listEvents({ limit: 100 })).records.filter(event => event.operationId === requestId);
    assert.deepEqual(events.map(event => event.type), ['operation.accepted', 'operation.completed']);
    assert.equal(events[1]?.payload.projectId, operation?.projectId);
    assert.deepEqual(await f.snapshotTree(repo), before);
    const view = await readProject(storage, operation!.projectId!);
    assert.equal(view.referenceCheckout, repo); assert.equal(view.observation?.freshness, 'LAST_KNOWN');
    assert.doesNotMatch(JSON.stringify(view), /"(?:repositoryIdentity|repositoryKey|birthtimeNs|canonicalIntent|payloadHash)"\s*:/);
    await api.shutdown(); await storage.close(); state.store.close();
    const entries = await readdir(state.directory), database = await readFile(state.path);
    await rename(repo, repo + '-moved-externally');
    try {
      const offline = await inspectProjectGet(state.directory, operation!.projectId!);
      assert.equal(offline.freshness, 'LAST_KNOWN'); assert.deepEqual(offline.data.project, view);
      assert.deepEqual(await readdir(state.directory), entries); assert.deepEqual(await readFile(state.path), database);
    } finally { await rename(repo + '-moved-externally', repo); }
    assert.deepEqual(await f.snapshotTree(repo), before);
  } finally { assert.equal(await api.shutdown(), 'ABSENT'); await storage.close(); }
});
