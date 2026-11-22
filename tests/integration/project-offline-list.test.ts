import test from 'node:test';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';
import { inspectProjectList, inspectProjectGet } from '../../src/core/inspect-main.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';

test('offline list/get read the same dated projection without modifying any archive file', async t => {
  const a = await observationStore(t);
  a.store.close();
  const before = await snapshotArchive(a.directory);
  const list = await inspectProjectList(a.directory), get = await inspectProjectGet(a.directory, a.projectId);
  assert.equal(list.freshness, 'LAST_KNOWN'); assert.equal(get.freshness, 'LAST_KNOWN');
  assert.deepEqual((list.data.projects as unknown[])[0], get.data.project);
  assert.deepEqual(await snapshotArchive(a.directory), before);
});
