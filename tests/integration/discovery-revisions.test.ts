import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
test('only verified completed run can publish an append-only document revision; exit zero never approves', async t => {
  const f = await reviewFixture(t), identity = await f.exit(); await f.service.publishDocument(identity, reviewDraft());
  const d = f.discovery(); assert.equal(d.state, 'READY_FOR_REVIEW');
  const r = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: d.latestDocumentRevisionId! })).data!;
  assert.equal(r.provenanceValidated, true); assert.equal(r.parentRevisionId, null); assert.equal(r.revisionNumber, '1');
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'approval', id: r.revisionId })).data, null);
  const c = await f.command('correct', { revisionId: r.revisionId, correctionId: randomUUID(), correction: 'Chiarisci le ipotesi' });
  value(await f.service.correct(f.peer, c)); await f.service.idle(); assert.equal(f.discovery().state, 'UPDATING');
  await f.service.publishDocument(await f.exit(), reviewDraft());
  const next = value(f.store.readDiscoveryMetadata({ kind: 'revision', id: f.discovery().latestDocumentRevisionId! })).data!;
  assert.equal(next.parentRevisionId, r.revisionId); assert.equal(next.revisionNumber, '2');
  assert.deepEqual(value(f.store.readDiscoveryMetadata({ kind: 'revision', id: r.revisionId })).data, r);
  await assert.rejects(f.service.publishDocument(identity, reviewDraft()));
});
