import test from 'node:test';
import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { observationStore } from '../fixtures/project-observation.js';

test('page validation binds store/revision, never exposes private anchors and verify invalidates old cursors', async t => {
  const f = await observationStore(t);
  const page = f.store.listProjects({ limit: 1 });
  assert.equal(page.projects.length, 1); assert.equal(page.nextCursor, null); assert.equal(page.registryRevision, '1');
  assert.doesNotMatch(JSON.stringify(page), /"(?:repositoryIdentity|birthtimeNs|canonicalIntent)"\s*:/);
  for (const limit of [0, 101, -1, 1.5]) assert.throws(() => f.store.listProjects({ limit }), /INVALID_REQUEST/);
  for (const cursor of ['', '{}', '%%%']) assert.throws(() => f.store.listProjects({ cursor }), /INVALID_REQUEST/);
  const cursor = (storeId = f.storeId, registryRevision = '1') => Buffer.from(JSON.stringify({ storeId, registryRevision, lastProjectId: f.projectId })).toString('base64url');
  assert.equal(f.store.listProjects({ cursor: cursor() }).projects.length, 0);
  assert.throws(() => f.store.listProjects({ cursor: cursor('00000000-0000-4000-8000-000000000000') }), /WRONG_STORE/);
  const intent = f.intent('VERIFY', { projectId: f.projectId }); f.store.acceptProjectOperation({ ...intent, projectId: f.projectId });
  f.store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: f.projectId,
    expectedConfigRevision: '1', expectedObservationRevision: '1', observation: f.evidence.observation, completedAt: f.evidence.observation.completedAt });
  assert.throws(() => f.store.listProjects({ cursor: cursor() }), /REGISTRY_CHANGED/);
  assert.equal(f.store.listProjects().registryRevision, '2');
});


test('large records force multiple whole-record pages below 60 KiB even with limit 100', async t => {
  const f = await observationStore(t), database = new Database(f.path);
  try {
    const state = f.store.getProject(f.projectId)!;
    const insert = database.prepare(`INSERT INTO projects(project_id,display_name,repository_key,repository_identity,reference_checkout,base_branch,config_revision,created_at,updated_at)
      SELECT ?,display_name,?,repository_identity,?,base_branch,config_revision,created_at,updated_at FROM projects WHERE project_id=?`);
    database.transaction(() => {
      for (let i = 0; i < 104; i++) {
        const id = randomUUID(), reference = { ...state.project.referenceCheckout, root: { ...state.project.referenceCheckout.root, canonicalPath: '/fixtures/' + 'x'.repeat(2000) + i } };
        insert.run(id, createHash('sha256').update(id).digest('hex'), JSON.stringify(reference), f.projectId);
      }
      database.prepare('UPDATE registry_metadata SET registry_revision=registry_revision+104').run();
    })();
  } finally { database.close(); }
  const ids: string[] = []; let cursor: string | undefined, pages = 0;
  do {
    const page = f.store.listProjects({ limit: 100, ...(cursor ? { cursor } : {}) });
    assert.ok(page.projects.length > 0 && page.projects.length <= 100);
    assert.ok(Buffer.byteLength(JSON.stringify({ protocolVersion: 1, data: page })) <= 60 * 1024);
    ids.push(...page.projects.map(project => project.projectId)); pages++; cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.ok(pages > 1); assert.equal(ids.length, 105); assert.equal(new Set(ids).size, 105); assert.deepEqual(ids, [...ids].sort());
});
