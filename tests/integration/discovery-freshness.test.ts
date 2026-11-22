import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
for (const change of ['bytes', 'head', 'branch', 'config', 'provider', 'removed'] as const) test(`freshness denies ${change} changes and preserves historical approval`, async t => {
  const f = await reviewFixture(t); await f.service.publishDocument(await f.exit(), reviewDraft());
  const r = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: f.discovery().latestDocumentRevisionId! })).data!;
  const c = await f.command('approve', { revisionId: r.revisionId, bundleDigest: r.bundleDigest, acceptedUnknownIds: reviewDraft().sections.map(s => `${s.id}:0`) });
  value(await f.service.approve(f.peer, c)); await f.service.idle(); const original = value(f.store.readDiscoveryMetadata({ kind: 'approval', id: r.revisionId })).data!;
  if (change === 'bytes') await writeFile(join(f.repo, 'tracked.txt'), 'new bytes\n');
  if (change === 'head') await f.repositories.git(f.repo, ['commit', '--allow-empty', '-m', 'new head']);
  if (change === 'branch') await f.repositories.git(f.repo, ['switch', '-c', 'new-name']);
  if (change === 'config') f.database.prepare('UPDATE projects SET config_revision=2 WHERE project_id=?').run(f.projectId);
  if (change === 'provider') value(f.store.commitDiscoveryMetadata({ kind: 'provider', expectedRevision: '1', configuration: { ...f.configuration, revision: '2', modelId: 'other-model' } }));
  if (change === 'removed') f.database.prepare('UPDATE projects SET removed_at=? WHERE project_id=?').run(new Date().toISOString(), f.projectId);
  const check = await f.service.eligibility(f.peer, f.projectId); await f.service.idle(); assert.equal((await f.service.eligibility(f.peer, f.projectId, check.checkId!)).eligible, false);
  assert.deepEqual(value(f.store.readDiscoveryMetadata({ kind: 'approval', id: r.revisionId })).data, original);
});
test('late valid document after byte change is confined to its generation and cannot become current', async t => {
  const f = await reviewFixture(t), identity = await f.exit(); await writeFile(join(f.repo, 'tracked.txt'), 'changed during run\n');
  await assert.rejects(f.service.publishDocument(identity, reviewDraft()), /CONTEXT_CHANGED/); assert.equal(f.discovery().state, 'STALE'); assert.equal(f.discovery().latestDocumentRevisionId, null);
  await assert.rejects(f.service.publishDocument({ ...identity, generation: randomUUID() }, reviewDraft()), /STALE_TARGET/);
});
test('an explicit file scope does not claim coverage of an unrelated untracked file', async t => {
  const f = await reviewFixture(t); await writeFile(join(f.repo, 'outside.txt'), 'outside explicit scope\n');
  await f.service.publishDocument(await f.exit(), reviewDraft()); assert.equal(f.discovery().state, 'READY_FOR_REVIEW');
});
