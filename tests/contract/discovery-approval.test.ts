import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canonicalDiscoveryIntent } from '../../src/domain/discovery/intent.js';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
test('headless approval needs exact grant, latest revision and explicit UNKNOWN acceptance', async t => {
  const f = await reviewFixture(t); await f.service.publishDocument(await f.exit(), reviewDraft());
  const revision = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: f.discovery().latestDocumentRevisionId! })).data!;
  const payload = { revisionId: revision.revisionId, bundleDigest: revision.bundleDigest, acceptedUnknownIds: [] };
  assert.equal((await f.service.approve(f.peer, { requestId: randomUUID(), grantId: null, canonicalIntent: canonicalDiscoveryIntent(f.intent('approve', payload)) })).ok, false);
  assert.equal((await f.service.prepare(f.peer, f.intent('approve', payload))).ok, false);
  assert.equal((await f.service.prepare(f.peer, f.intent('approve', { ...payload, revisionId: randomUUID() }))).ok, false);
  const ids = reviewDraft().sections.map(s => `${s.id}:0`), c = await f.command('approve', { ...payload, acceptedUnknownIds: ids });
  value(await f.service.approve(f.peer, c)); await f.service.idle(); assert.equal(f.discovery().state, 'APPROVED');
  value(await f.service.approve(f.peer, c)); assert.equal(f.discovery().state, 'APPROVED');
});
