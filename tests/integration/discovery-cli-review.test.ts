import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewFixture, reviewDraft } from '../fixtures/discovery-review.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { createDiscoveryDispatch, DISCOVERY_LIVE_METHODS } from '../../src/core/discovery/dispatch.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { createLocalTransport } from '../../src/platform/macos/transport.js';
import { invokeCli } from '../fixtures/cli-harness.js';
import type { StoragePort } from '../../src/ports/storage.js';
test('CLI streams a complete 256KiB document in bounded chunks and approves only the exact grant payload', async t => {
  const f = await reviewFixture(t), doc = reviewDraft(), claim = doc.sections[0]!.claims[0]! as { text: string };
  claim.text = ''; claim.text = 'x'.repeat(262144 - Buffer.byteLength(JSON.stringify(doc)));
  await f.service.publishDocument(await f.exit(), doc); const revisionId = f.discovery().latestDocumentRevisionId!, d = f.discovery();
  const dispatch = createDiscoveryDispatch({ storage: f.store as unknown as StoragePort, operations: f.service });
  const key = await createPlatformPaths().createCredential(f.paths.clientKeyFile);
  const server = await createLocalTransport().listen(f.paths.daemonEndpoint, f.instanceId, new Map([[key, 'client']]), async (request, peer) => request.method === 'status.get'
    ? { protocolVersion: 1, correlationId: request.correlationId, result: 'OK', data: { storeId: f.storeId, instanceId: f.instanceId, lifecycle: 'RUNNING', capabilities: { discoveryVersion: 1, discoveryMethods: DISCOVERY_LIVE_METHODS } } }
    : dispatch(request, peer, f.store.readSnapshot()!));
  const call = async (...args: string[]) => { const raw = await invokeCli(['discovery', ...args, '--state-dir', f.directory, '--json']); assert.ok(Buffer.byteLength(raw.stdout) < 32768); return JSON.parse(raw.stdout); };
  try {
    let cursor: string | null = null; const chunks: Buffer[] = [];
    do { const page = await call('document', revisionId, ...(cursor ? [`--after=${cursor}`] : [])); assert.equal(page.result, 'OK'); chunks.push(Buffer.from(page.data.chunk.data, 'base64')); cursor = page.data.nextCursor; } while (cursor);
    const bytes = Buffer.concat(chunks); assert.equal(bytes.length, 262144); assert.deepEqual(JSON.parse(bytes.toString()), doc);
    const payload = { revisionId, bundleDigest: createHash('sha256').update(bytes).digest('hex'), acceptedUnknownIds: doc.sections.map(s => `${s.id}:0`) };
    const intentFile = join(f.directory, 'review-intent.json'), body = join(f.directory, 'review.json');
    await writeFile(intentFile, JSON.stringify(f.intent('approve', payload))); await writeFile(body, JSON.stringify(payload));
    const grant = (await call('prepare', `--intent-file=${intentFile}`)).data.grantId;
    const accepted = await call('approve', d.discoveryId, `--review-file=${body}`, `--grant=${grant}`, `--request-id=${randomUUID()}`); assert.equal(accepted.data.accepted, true, JSON.stringify(accepted)); await f.service.idle(); assert.equal(f.discovery().state, 'APPROVED');
    const first = await call('eligibility', f.projectId); await f.service.idle(); assert.equal((await call('eligibility', f.projectId, `--check-id=${first.data.checkId}`)).data.eligible, true);
  } finally { await server.close(); }
  const offline = await call('document', revisionId, '--metadata'); assert.equal(offline.freshness, 'LAST_KNOWN');
  assert.equal((await call('eligibility', f.projectId)).data.eligible, false);
  value(f.store.readDiscoveryMetadata({ kind: 'revision', id: revisionId }));
});
