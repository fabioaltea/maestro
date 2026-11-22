import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFixture } from '../fixtures/discovery-launch.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { publicDiscoveryOperation, decodeDiscoveryOperationView } from '../../src/protocol/discovery.js';

test('accepted start returns promptly while context verification is pending; grant/run wait for verification', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), request = f.startInput(grant);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }), revalidate = f.context.revalidate;
  f.context.revalidate = async (...args) => { await gate; return revalidate(...args); };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const admission = value(await Promise.race([f.service.start(f.peer, request), new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new Error('ADMISSION_WAITED_FOR_CONTEXT')), 2000); })]));
    assert.equal(admission.requestId, request.requestId); assert.ok(await f.service.get(f.peer, request.requestId)); assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
    assert.equal((f.database.prepare('SELECT consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(grant.grantId) as { consumed_by_request_id: string | null }).consumed_by_request_id, null);
    const publicOperation = publicDiscoveryOperation((await f.service.get(f.peer, request.requestId))!);
    assert.ok(!JSON.stringify(publicOperation).includes(grant.grantId));
    assert.doesNotThrow(() => decodeDiscoveryOperationView(publicOperation));
  } finally { clearTimeout(timer); release(); }
  await f.service.idle(); assert.equal(f.launches.length, 1); assert.equal(f.counts().runs, 1);
});
test('identical retry and a concurrent second start cannot duplicate a durable run or consume another grant', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), secondGrant = await f.prepare(), request = f.startInput(grant);
  const responses = await Promise.all([f.service.start(f.peer, request), f.service.start(f.peer, request)]); responses.forEach(result => value(result));
  await f.service.idle(); assert.equal(f.counts().runs, 1); assert.equal(f.launches.length, 1);
  const second = await f.service.start(f.peer, f.startInput(secondGrant)); assert.deepEqual(second, { ok: false, code: 'DISCOVERY_BUSY' });
  assert.equal((f.database.prepare('SELECT consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(secondGrant.grantId) as { consumed_by_request_id: string | null }).consumed_by_request_id, null);
});
test('changed working bytes block activation without consuming the old grant or sending a new corpus', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), request = f.startInput(grant); await writeFile(join(f.repo, 'tracked.txt'), 'changed after consent\n');
  value(await f.service.start(f.peer, request)); await f.service.idle();
  const operation = await f.service.get(f.peer, request.requestId); assert.equal(operation?.outcome, 'BLOCKED'); assert.equal(operation.error, 'CONTEXT_CHANGED');
  assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
  assert.equal((f.database.prepare('SELECT consumed_by_request_id FROM discovery_grants WHERE grant_id=?').get(grant.grantId) as { consumed_by_request_id: string | null }).consumed_by_request_id, null);
});
test('global request UUID collision is rejected in the original namespace before a launch', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), collision = randomUUID();
  f.store.acceptOperation({ requestId: collision, action: 'stop', payloadHash: 'd'.repeat(64), ownerUid: process.getuid!(), targetInstanceId: f.instanceId, acceptedAt: new Date().toISOString() });
  assert.deepEqual(await f.service.start(f.peer, { ...f.startInput(grant), requestId: collision }), { ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.launches.length, 0);
});
test('lost response after acceptance resolves the original UUID and never launches a second run', async t => {
  let lose = true;
  const f = await launchFixture(t, { checkpoint: async point => { if (point === 'discovery.start.afterAcceptance' && lose) { lose = false; throw new Error('SIMULATED_RESPONSE_LOSS'); } } });
  const grant = await f.prepare(), request = f.startInput(grant); assert.deepEqual(await f.service.start(f.peer, request), { ok: false, code: 'UNKNOWN_OUTCOME' });
  assert.ok(await f.service.get(f.peer, request.requestId)); value(await f.service.start(f.peer, request)); await f.service.idle(); assert.equal(f.launches.length, 1);
});
for (const repository of ['dirty', 'conflict', 'unborn'] as const) {
  test(`start from ${repository} preserves checkout, refs, index and config; all identities predate the launch effect`, async t => {
    const f = await launchFixture(t, { repository }), before = await f.repositories.snapshotTree(f.repo), grant = await f.prepare();
    value(await f.service.start(f.peer, f.startInput(grant))); await f.service.idle(); assert.equal(f.launches.length, 1);
    assert.deepEqual(await f.repositories.snapshotTree(f.repo), before);
    assert.equal(Number((f.database.prepare('SELECT count(*) AS n FROM discovery_approvals').get() as { n: number }).n), 0);
  });
}
test('two distinct concurrent start requests admit only one preparation and never queue another run', async t => {
  const f = await launchFixture(t), first = await f.prepare(), second = await f.prepare();
  const results = await Promise.all([f.service.start(f.peer, f.startInput(first)), f.service.start(f.peer, f.startInput(second))]);
  assert.equal(results.filter(result => result.ok).length, 1); assert.deepEqual(results.find(result => !result.ok), { ok: false, code: 'DISCOVERY_BUSY' });
  await f.service.idle(); assert.equal(f.launches.length, 1); assert.equal(f.counts().runs, 1);
});
test('a failure before acceptance leaves no operation or consumed permission and permits the original request', async t => {
  let failBefore = true;
  const f = await launchFixture(t, { checkpoint: async point => { if (point === 'discovery.start.beforeAdmission' && failBefore) { failBefore = false; throw new Error('SIMULATED_PRE_ADMISSION_LOSS'); } } });
  const grant = await f.prepare(), request = f.startInput(grant); assert.equal((await f.service.start(f.peer, request)).ok, false);
  assert.equal(await f.service.get(f.peer, request.requestId), null); assert.equal(f.launches.length, 0); assert.equal(f.counts().runs, 0);
  value(await f.service.start(f.peer, request)); await f.service.idle(); assert.equal(f.launches.length, 1);
});
test('a provider change during context verification blocks the atomic activation and preserves the old grant', async t => {
  const f = await launchFixture(t), grant = await f.prepare(), request = f.startInput(grant), revalidate = f.context.revalidate;
  f.context.revalidate = async (...args) => {
    const result = await revalidate(...args);
    value(f.store.commitDiscoveryMetadata({ kind: 'provider', expectedRevision: '1', configuration: { ...f.configuration, revision: '2', modelId: 'new-explicit-model' } }));
    return result;
  };
  value(await f.service.start(f.peer, request)); await f.service.idle();
  assert.equal((await f.service.get(f.peer, request.requestId))?.error, 'APPROVAL_STALE');
  assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'grant', id: grant.grantId })).data?.consumedByRequestId, null);
});
test('immutable registered bytes still require manifest/corpus consistency before granting authority', async t => {
  const f = await launchFixture(t), snapshotId = randomUUID();
  const manifest = JSON.parse(Buffer.from(value(await f.artifacts.read(f.snapshot.manifestArtifactId!, 0, 8192)).bytes).toString('utf8')) as Record<string, unknown>;
  const corpus = JSON.parse(Buffer.from(value(await f.artifacts.read(f.snapshot.corpusArtifactId!, 0, 8192)).bytes).toString('utf8')) as { sources: { text: string }[] };
  corpus.sources[0]!.text = 'different bytes with an old source hash';
  const publish = async (kind: 'MANIFEST' | 'CORPUS', raw: unknown) => { const bytes = Buffer.from(JSON.stringify(raw));
    const reserved = value(await f.artifacts.reserve(kind, bytes.length)); return { object: value(await f.artifacts.publish(reserved.artifactId, bytes)), bytes: bytes.length }; };
  const m = await publish('MANIFEST', { ...manifest, snapshotId }), c = await publish('CORPUS', corpus);
  value(f.store.commitDiscoveryMetadata({ kind: 'snapshot', value: { ...f.snapshot, snapshotId, manifestArtifactId: m.object.artifactId, corpusArtifactId: c.object.artifactId, byteCount: c.bytes } }));
  const bad = f.intent({ snapshotId, payload: { snapshotId } });
  assert.deepEqual(await f.service.prepare(f.peer, bad), { ok: false, code: 'ARTIFACT_CORRUPT' });
  assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
});
test('pending previews count toward the four preview limit before starting additional readers', async t => {
  const f = await launchFixture(t), capture = f.context.capture;
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let readers = 0;
  f.context.capture = async (...args) => { readers++; await gate; return capture(...args); };
  const inputs = Array.from({ length: 4 }, () => ({ requestId: randomUUID(), projectId: f.projectId, expectedConfigRevision: '1', selectors: ['tracked.txt'] }));
  try {
    for (const input of inputs.slice(0, 3)) value(await f.service.preview(f.peer, input));
    assert.deepEqual(await f.service.preview(f.peer, inputs[3]!), { ok: false, code: 'DISCOVERY_LIMIT' });
    value(await f.service.preview(f.peer, inputs[0]!)); assert.equal(readers, 3);
  } finally { release(); }
  await f.service.idle(); assert.equal(f.counts().runs, 0); assert.equal(f.launches.length, 0);
});
