import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile, readdir, writeFile, lstat } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createProjectRepositories } from '../fixtures/project-repositories.js';
import { createFoundationV2 } from '../fixtures/foundation-schema-v2.js';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { observationStore, observationInspection } from '../fixtures/project-observation.js';
import { createMixedProjectHistory } from '../fixtures/project-event-history.js';
import { createEventPump } from '../../src/protocol/event-pump.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { openJournal } from '../../src/storage/event-journal.js';
import { openStorage } from '../../src/storage/worker.js';
import { LocalClient } from '../../src/client/local-client.js';
import { createClientBackend } from '../../src/bootstrap.js';
import { readEventPage } from '../../src/core/diagnostics.js';
import { encodeCursor, type EventCursor } from '../../src/protocol/event-cursor.js';
import { decodeProjectOperationView } from '../../src/protocol/validation.js';
import type { EventRecord, StoragePort } from '../../src/ports/storage.js';
import type { EventPage } from '../../src/protocol/messages.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';

type PublicPage = EventPage & { nextCursor: EventCursor };
async function clientHistory(client: LocalClient, directory: string, after?: EventCursor) {
  const records: EventRecord[] = []; let cursor = after;
  for (;;) {
    const result = await client.run('events', { stateDirectory: directory, limit: 7, ...(cursor ? { after: encodeCursor(cursor) } : {}) });
    assert.equal(result.result, 'OK', JSON.stringify(result));
    const page = result.data.events as unknown as PublicPage;
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 60 * 1024);
    records.push(...page.records); if (!page.truncated) return { records, cursor: page.nextCursor };
    assert.notEqual(page.nextCursor.seq, cursor?.seq); cursor = page.nextCursor;
  }
}

function contiguous(records: readonly EventRecord[], after = '0') {
  assert.deepEqual(records.map(event => event.seq), records.map((_event, i) => String(BigInt(after) + BigInt(i + 1))));
  assert.equal(new Set(records.map(event => event.eventId)).size, records.length);
}

test('E2 updated client replays actual Foundation v2 prefix and all registry actions before/after daemon restart and offline', async t => {
  const h = await createCliHarness(t), f = await createProjectRepositories(t), paths = (await createPlatformPaths().resolveArchive(h.archive, 'write'))!;
  const legacy = createFoundationV2(paths.directory), seed = new Database(legacy.path);
  const historical: EventRecord[] = Array.from({ length: 41 }, (_value, i) => ({ protocolVersion: 1, storeId: legacy.storeId,
    eventId: randomUUID(), seq: String(i + 1), occurredAt: '2026-11-10T10:00:00.000Z', instanceId: null, operationId: null,
    type: 'diagnostics.degraded', payload: { code: 'BUSY' } }));
  try {
    seed.prepare('UPDATE journal_metadata SET retention_floor=1').run();
    historical.push(...JSON.parse((seed.prepare('SELECT records FROM event_outbox').get() as { records: string }).records) as EventRecord[]);
  } finally { seed.close(); }
  const journalDir = join(h.archive, 'events'); openJournal({ directory: journalDir, storeId: legacy.storeId }).append(historical.slice(0, 41));
  const segment = join(journalDir, (await readdir(journalDir))[0]!), prefix = await readFile(segment);
  assert.equal((await h.call('start')).code, 0);
  const client = new LocalClient(createClientBackend()), before = await clientHistory(client, h.archive);
  assert.deepEqual(before.records.slice(0, 42), historical); contiguous(before.records);
  const repo = await f.createRepository('replay-private-name'); const snapshot = await f.snapshotTree(repo);
  const requests: ProjectOperationResult[] = [];
  const registration = await client.runProject('register', { path: repo, name: 'E2_PRIVATE_SENTINEL' }, { stateDirectory: h.archive });
  assert.equal(registration.outcome, 'SUCCEEDED', JSON.stringify(registration));
  requests.push(decodeProjectOperationView(registration.data.operation).result!); const projectId = requests[0]!.projectId!;
  for (const [action, params] of [ ['verify', { projectId }], ['update', { projectId, expectedRevision: '1', patch: { name: 'Another private name' } }],
    ['remove', { projectId, expectedRevision: '2' }] ] as const) {
    const result = await client.runProject(action, params, { stateDirectory: h.archive });
    assert.equal(result.outcome, 'SUCCEEDED', JSON.stringify(result)); requests.push(decodeProjectOperationView(result.data.operation).result!);
  }
  const after = await clientHistory(client, h.archive); contiguous(after.records);
  assert.deepEqual(after.records.slice(0, before.records.length), before.records);
  const resumed = await clientHistory(client, h.archive, before.cursor); contiguous(resumed.records, before.cursor.seq);
  assert.deepEqual(resumed.records, after.records.filter(event => BigInt(event.seq) > BigInt(before.cursor.seq)));
  for (const result of requests) {
    const completed = after.records.filter(event => event.operationId === result.requestId && event.type === 'operation.completed');
    assert.equal(completed.length, 1); assert.equal(completed[0]!.payload.action, result.action); assert.equal(completed[0]!.payload.projectId, projectId);
    assert.equal(completed[0]!.payload.configRevision, result.configRevision); assert.equal(completed[0]!.payload.observationRevision, result.observationRevision);
  }
  assert.doesNotMatch(JSON.stringify(after.records), /E2_PRIVATE_SENTINEL|Another private name|replay-private-name|birthtimeNs|canonicalIntent/);
  assert.equal((await h.call('restart')).code, 0);
  const restarted = await clientHistory(client, h.archive); contiguous(restarted.records);
  assert.deepEqual(restarted.records.slice(0, after.records.length), after.records);
  assert.equal(restarted.cursor.storeId, legacy.storeId);
  assert.deepEqual((await readFile(segment)).subarray(0, prefix.byteLength), prefix);
  assert.equal((await h.call('stop')).code, 0);
  const archive = await snapshotArchive(h.archive), offline = await clientHistory(client, h.archive);
  assert.deepEqual(offline.records.slice(0, restarted.records.length), restarted.records); contiguous(offline.records);
  assert.deepEqual(await snapshotArchive(h.archive), archive); assert.deepEqual(await f.snapshotTree(repo), snapshot);
  await writeFile('specs/002-project-registry/reports/event-replay-samples.json', JSON.stringify({ measuredAt: new Date().toISOString(),
    legacySchema: 2, currentSchema: 3, historicalRecords: historical.length, historicalPrefixPreserved: true, storeId: legacy.storeId,
    afterMutations: after.records.length, afterRestart: restarted.records.length, offline: offline.records.length, offlineWrites: 0,
    requests, events: after.records.filter(event => requests.some(result => result.requestId === event.operationId)),
  }, null, 2) + '\n');
});

for (const action of ['REGISTER', 'VERIFY', 'UPDATE', 'REMOVE'] as const) {
  test(`E2 ${action} completion survives post-sync drain failure/reopen with exactly one original journal record`, async t => {
    let fault = false;
    const checkpoint = (point: string) => { if (fault && point === 'journal.allocated') throw new Error('controlled post-sync drain failure'); };
    const f = action === 'REGISTER' ? await createRegistryStore(t, checkpoint) : await observationStore(t, checkpoint);
    const evidence = observationInspection();
    const projectId = action === 'REGISTER' ? null : (f as Awaited<ReturnType<typeof observationStore>>).projectId;
    const params = action === 'REGISTER' ? { path: '/fixture' } : action === 'VERIFY' ? { projectId }
      : action === 'UPDATE' ? { projectId, expectedRevision: '1', patch: { name: 'New private name' } } : { projectId, expectedRevision: '1' };
    const intent = { ...f.intent(action, params), projectId }; f.store.acceptProjectOperation(intent);
    const boundary = f.store.getEventState().highWater, completedAt = new Date().toISOString(); fault = true;
    let result: ProjectOperationResult;
    if (action === 'REGISTER') result = f.store.commitProjectRegistration({ requestId: intent.requestId, instanceId: f.instanceId, displayName: 'Private name',
      baseBranch: 'fixture-base', repositoryKey: createHash('sha256').update(JSON.stringify(evidence.identity)).digest('hex'),
      repositoryIdentity: evidence.identity, referenceCheckout: evidence.reference, observation: evidence.observation, completedAt });
    else if (action === 'VERIFY') result = f.store.commitProjectObservation({ requestId: intent.requestId, instanceId: f.instanceId, projectId: projectId!,
      expectedConfigRevision: '1', expectedObservationRevision: '1', observation: evidence.observation, completedAt });
    else if (action === 'UPDATE') result = f.store.commitProjectUpdate({ requestId: intent.requestId, instanceId: f.instanceId, projectId: projectId!, expectedConfigRevision: '1', completedAt });
    else result = f.store.commitProjectRemoval({ requestId: intent.requestId, instanceId: f.instanceId, projectId: projectId!, expectedConfigRevision: '1', completedAt });
    assert.equal(result.outcome, 'SUCCEEDED'); assert.deepEqual(f.store.getProjectOperation(intent.requestId)!.result, result);
    assert.equal(f.store.getEventState().degraded, true); assert.ok(f.store.getEventState().pendingBytes > 0);
    assert.deepEqual(f.store.listEvents({ after: boundary }).records, []);
    const db = (f.store as unknown as { database: Database.Database }).database;
    const pending = JSON.parse((db.prepare('SELECT records FROM event_outbox').get() as { records: string }).records) as EventRecord[];
    assert.equal(pending.length, 1); assert.equal(pending[0]!.operationId, intent.requestId);
    f.store.close();
    const reopened = await openStorage({ path: f.path }); let records: readonly EventRecord[];
    try {
      assert.deepEqual(await reopened.getProjectOperation(intent.requestId).then(operation => operation!.result), result);
      await reopened.drainEvents(); await reopened.drainEvents();
      records = (await readEventPage(reopened, f.storeId, {})).records; contiguous(records);
      assert.deepEqual(records.filter(event => event.operationId === intent.requestId && event.type === 'operation.completed'), pending);
      assert.equal((await reopened.getEventState()).pendingBytes, 0);
    } finally { await reopened.close(); }
    const snapshot = await snapshotArchive(f.directory), reader = await openStorage({ path: f.path, readonly: true });
    try { assert.deepEqual((await readEventPage(reader, f.storeId, {})).records, records!); } finally { await reader.close(); }
    assert.deepEqual(await snapshotArchive(f.directory), snapshot);
  });
}


test('E2 retention overtaking a mixed paged replay emits a verified gap and never pins old segments', async t => {
  const f = await createMixedProjectHistory(t), highWater = f.store.getEventState().highWater;
  const journal = openJournal({ directory: join(f.directory, 'events'), storeId: f.storeId, segmentBytes: 16 * 1024, budgetBytes: 64 * 1024 });
  (f.store as unknown as { journal: typeof journal }).journal = journal;
  const frames: Record<string, unknown>[] = [];
  const sink = { bufferedBytes: 0, needsDrain: false, closed: false,
    write(bytes: Uint8Array) {
      const frame = JSON.parse(Buffer.from(bytes).toString()) as Record<string, unknown>; frames.push(frame);
      if (frame.kind === 'event' && (frame.event as EventRecord).seq === '1') {
        for (let batch = 0; batch < 12; batch++) f.store.recordEvents(Array.from({ length: 20 }, () => ({ type: 'operation.failed' as const,
          operationId: randomUUID(), payload: { scope: 'project', action: 'VERIFY', projectId: f.projectId, outcome: 'FAILED', effect: 'NONE',
            code: 'REVISION_CONFLICT', configRevision: '9007199254740993', observationRevision: '9007199254740993' } })));
      }
      return true;
    },
    waitDrain: async () => {}, end(bytes?: Uint8Array) { if (bytes) frames.push(JSON.parse(Buffer.from(bytes).toString())); this.closed = true; },
    onClose: () => () => {},
  };
  const pump = createEventPump({ subscriptionId: randomUUID(), correlationId: randomUUID(), instanceId: f.instanceId,
    storeId: f.storeId, after: '0', replayHighWater: highWater, sink,
    readPage: async (after, maxBytes, through) => f.store.listEvents({ after, maxBytes, limit: 1, ...(through ? { highWater: through } : {}) }),
    eventState: async () => f.store.getEventState(true),
  });
  pump.start();
  const result = await pump.done, bounds = f.store.getEventState(true);
  assert.equal(result.reason, 'CURSOR_EXPIRED'); assert.equal(result.cursor, '1'); assert.equal(result.deliveredFrames, 1);
  const gap = frames.at(-1)!; assert.equal(gap.kind, 'subscription.closed');
  assert.equal(gap.storeId, f.storeId); assert.equal(gap.firstAvailable, bounds.firstAvailable);
  assert.equal(gap.highWater, bounds.highWater); assert.equal(gap.nextAction, 'reread-status');
  assert.ok(BigInt(bounds.firstAvailable) > 1n);
  const directory = join(f.directory, 'events');
  const allocated = (await lstat(directory)).blocks * 512 + (await Promise.all((await readdir(directory)).map(async name => (await lstat(join(directory, name))).blocks * 512))).reduce((a, b) => a + b, 0);
  assert.ok(allocated <= 64 * 1024);
  for (const result of f.results) assert.deepEqual(f.store.getProjectOperation(result.requestId)!.result, result);
});
