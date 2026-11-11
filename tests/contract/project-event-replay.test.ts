import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createMixedProjectHistory } from '../fixtures/project-event-history.js';
import { snapshotArchive } from '../fixtures/archive-snapshot.js';
import { readEventPage } from '../../src/core/diagnostics.js';
import { EventStreamError, encodeCursor, decodeCursor, type EventCursor } from '../../src/protocol/event-cursor.js';
import { EVENT_TYPES, MAX_EVENT_PAGE_BYTES } from '../../src/protocol/messages.js';
import { openJournal } from '../../src/storage/event-journal.js';
import type { EventRecord } from '../../src/ports/storage.js';

// A live writer's SHM read marks are volatile. Durable DB/WAL/history bytes
// remain exact; offline tests separately compare every file without exclusions.
async function durableHistory(directory: string) {
  return (await snapshotArchive(directory) as { relative: string }[]).filter(file => file.relative !== 'state.sqlite-shm');
}

async function collect(f: Awaited<ReturnType<typeof createMixedProjectHistory>>, limit: number) {
  const records: EventRecord[] = []; let after: EventCursor = { storeId: f.storeId, seq: '0' };
  for (;;) {
    const page = await readEventPage(f.reader, f.storeId, { after, limit });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= MAX_EVENT_PAGE_BYTES);
    records.push(...page.records); assert.equal(page.nextCursor.seq, page.records.at(-1)?.seq ?? after.seq);
    assert.deepEqual(decodeCursor(encodeCursor(page.nextCursor)), page.nextCursor);
    if (!page.truncated) return records;
    assert.ok(BigInt(page.nextCursor.seq) > BigInt(after.seq)); after = page.nextCursor;
  }
}

test('E2 mixed Foundation/registry history keeps original envelope, exact revisions and correlation across pages', async t => {
  const f = await createMixedProjectHistory(t), original = f.store.listEvents({ limit: 1000 }).records;
  const records = await collect(f, 2); assert.deepEqual(records, original); assert.deepEqual(await collect(f, 3), original);
  assert.deepEqual(records.map(event => event.seq), records.map((_event, i) => String(i + 1)));
  assert.equal(new Set(records.map(event => event.eventId)).size, records.length);
  assert.ok(records.some(event => event.payload.action === 'start' && event.payload.scope === undefined));
  for (const event of records) { assert.equal(event.protocolVersion, 1); assert.equal(event.storeId, f.storeId); assert.ok(EVENT_TYPES.includes(event.type as typeof EVENT_TYPES[number])); }
  for (const result of f.results) {
    const completion = records.filter(event => event.operationId === result.requestId && event.type === 'operation.completed');
    assert.equal(completion.length, 1); assert.equal(completion[0]!.instanceId, f.instanceId);
    assert.deepEqual(completion[0]!.payload, { scope: 'project', action: result.action, outcome: 'SUCCEEDED', projectId: f.projectId,
      effect: result.effect, configRevision: result.configRevision, observationRevision: result.observationRevision });
  }
  assert.doesNotMatch(JSON.stringify(records), /Private registry name|\/fixture|repositoryIdentity|canonicalIntent|payloadHash/);
});

test('E2 cursor rejects foreign store, malformed or future sequence without advancing, rewriting or draining history', async t => {
  const f = await createMixedProjectHistory(t);
  const before = await durableHistory(f.directory);
  for (const [after, code] of [[{ storeId: randomUUID(), seq: '0' }, 'WRONG_STORE'], [{ storeId: f.storeId, seq: '9223372036854775807' }, 'INVALID_REQUEST'],
    [{ storeId: f.storeId, seq: '-1' }, 'INVALID_REQUEST'], ['0', 'INVALID_REQUEST']] as const) {
    await assert.rejects(readEventPage(f.reader, f.storeId, { after }), new RegExp(code));
  }
  assert.deepEqual(await durableHistory(f.directory), before);
});

test('E2 redacted mixed pages remain at most 60 KiB with whole records and exact decimal revisions', async t => {
  const f = await createMixedProjectHistory(t), sentinel = 'E2_PRIVATE_SENTINEL';
  for (let batch = 0; batch < 4; batch++) f.store.recordEvents(Array.from({ length: 50 }, () => ({ type: 'operation.failed' as const,
    operationId: randomUUID(), instanceId: f.instanceId, payload: { scope: 'project', projectId: f.projectId, action: 'VERIFY', outcome: 'FAILED',
      effect: 'NONE', code: 'REVISION_CONFLICT', configRevision: '9007199254740993', observationRevision: '9007199254740993', name: sentinel,
      path: '/private/' + sentinel, branch: sentinel, stderr: sentinel } })));
  const first = await readEventPage(f.reader, f.storeId, { after: { storeId: f.storeId, seq: '0' }, limit: 1000, maxBytes: 65_536 });
  assert.equal(first.truncated, true); assert.ok(Buffer.byteLength(JSON.stringify(first)) <= 60 * 1024);
  const records = await collect(f, 1000); assert.equal(BigInt(records.length), BigInt(f.store.getEventState().highWater));
  assert.doesNotMatch(JSON.stringify(records), new RegExp(sentinel));
  assert.equal(records.filter(event => event.payload.configRevision === '9007199254740993').length, 200);
});

test('E2 expired retained history reports a store-bound gap instead of silently resuming at a newer event', async t => {
  const f = await createMixedProjectHistory(t);
  // Smaller injected adapter budget exercises real rotation quickly; production limits are unchanged.
  const journal = openJournal({ directory: join(f.directory, 'events'), storeId: f.storeId, segmentBytes: 16 * 1024, budgetBytes: 64 * 1024 });
  (f.store as unknown as { journal: typeof journal }).journal = journal;
  for (let batch = 0; batch < 12; batch++) f.store.recordEvents(Array.from({ length: 20 }, () => ({ type: 'operation.failed' as const,
    operationId: randomUUID(), instanceId: f.instanceId, payload: { scope: 'project', action: 'VERIFY', projectId: f.projectId,
      outcome: 'FAILED', effect: 'NONE', code: 'REVISION_CONFLICT', configRevision: '9007199254740993', observationRevision: '9007199254740993' } })));
  const bounds = f.store.getEventState(true); assert.ok(BigInt(bounds.firstAvailable) > 1n);
  const before = await durableHistory(f.directory);
  await assert.rejects(readEventPage(f.reader, f.storeId, { after: { storeId: f.storeId, seq: '0' } }), error => {
    assert.ok(error instanceof EventStreamError); assert.equal(error.message, 'CURSOR_EXPIRED');
    assert.deepEqual(error.gap, { storeId: f.storeId, firstAvailable: bounds.firstAvailable, highWater: bounds.highWater, nextAction: 'reread-status' }); return true;
  });
  assert.deepEqual(await durableHistory(f.directory), before);
});
