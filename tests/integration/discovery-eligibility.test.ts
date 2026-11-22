import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
test('eligibility revalidates current bytes and never promotes offline or uncertain fingerprints', async t => {
  const f = await reviewFixture(t); await f.service.publishDocument(await f.exit(), reviewDraft());
  const revision = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: f.discovery().latestDocumentRevisionId! })).data!;
  const c = await f.command('approve', { revisionId: revision.revisionId, bundleDigest: revision.bundleDigest, acceptedUnknownIds: reviewDraft().sections.map(s => `${s.id}:0`) });
  value(await f.service.approve(f.peer, c)); await f.service.idle();
  const first = await f.service.eligibility(f.peer, f.projectId); assert.equal(first.eligible, false); assert.equal(first.reason, 'CHECKING');
  await f.service.idle(); const checked = await f.service.eligibility(f.peer, f.projectId, first.checkId!); assert.equal(checked.eligible, true);
  await writeFile(join(f.repo, 'tracked.txt'), 'changed\n');
  const next = await f.service.eligibility(f.peer, f.projectId); await f.service.idle();
  assert.equal((await f.service.eligibility(f.peer, f.projectId, next.checkId!)).eligible, false); assert.equal(f.discovery().state, 'STALE');
});
test('byte change immediately before approve is blocked despite a valid grant', async t => {
  const f = await reviewFixture(t); await f.service.publishDocument(await f.exit(), reviewDraft());
  const r = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: f.discovery().latestDocumentRevisionId! })).data!;
  const c = await f.command('approve', { revisionId: r.revisionId, bundleDigest: r.bundleDigest, acceptedUnknownIds: reviewDraft().sections.map(s => `${s.id}:0`) });
  await writeFile(join(f.repo, 'tracked.txt'), 'changed after consent\n'); value(await f.service.approve(f.peer, c)); await f.service.idle();
  assert.equal(f.discovery().state, 'STALE'); assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'approval', id: r.revisionId })).data, null);
});
