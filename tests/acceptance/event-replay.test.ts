import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {readdir, writeFile} from 'node:fs/promises';
import {createCliHarness} from '../fixtures/cli-harness.js';
import {createPlatformPaths} from '../../src/platform/macos/paths.js';
import {createLocalTransport} from '../../src/platform/macos/transport.js';
import {SQLiteStore} from '../../src/storage/sqlite-store.js';
import {openJournal} from '../../src/storage/event-journal.js';
import {encodeCursor, EventStreamError} from '../../src/protocol/event-cursor.js';
import type {EventRecord} from '../../src/ports/storage.js';

async function until(predicate: () => boolean) {const deadline = performance.now() + 5_000; while (!predicate()) {assert.ok(performance.now() < deadline, 'replay acceptance deadline'); await new Promise(resolve => setTimeout(resolve, 5));}}
function readAll(path: string, after: string) {
  const reader = new SQLiteStore({path, readonly: true}); const records: EventRecord[] = []; let pages = 0, cursor = after;
  try {for (;;) {const page = reader.listEvents({after: cursor, limit: 1000}); pages++; records.push(...page.records); cursor = page.nextAfter; if (!page.truncated) return {records, pages, highWater: page.highWater, firstAvailable: page.firstAvailable};}}
  finally {reader.close();}
}
function produce(path: string, count: number, offset = 0) {
  const writer = new SQLiteStore({path});
  try {for (let i = 0; i < count; i += 64) writer.recordEvents(Array.from({length: Math.min(64, count - i)}, (_, j) => ({type: 'diagnostics.degraded' as const, payload: {code: 'BUSY', count: offset + i + j}}))); writer.drainEvents();}
  finally {writer.close();}
}

test('E3: known history survives partial replay, reconnect and restart; rotation gives an explicit recoverable gap', async t => {
  const h = await createCliHarness(t); assert.equal((await h.call('start')).code, 0);
  const adapter = createPlatformPaths(), paths = (await adapter.resolveArchive(h.archive, 'read'))!, key = await adapter.readCredential(paths.clientKeyFile);
  const transport = createLocalTransport(), before = JSON.parse((await h.call('status')).stdout);
  const init = new SQLiteStore({path: paths.stateFile}); let initial: string;
  try {init.drainEvents(); initial = init.getEventState().highWater;} finally {init.close();}
  const storeId = before.storeId as string;
  produce(paths.stateFile, 320);
  const firstRecords: EventRecord[] = []; let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const first = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: initial}}}, async frame => {firstRecords.push(frame.event); if (firstRecords.length === 80) await held;});
  try {await until(() => firstRecords.length === 80);} finally {await first.close(); release();}
  const firstEnd = await first.done;
  assert.equal(firstEnd.lastReceived, firstRecords[78]!.seq, 'only callback-accepted events advance the checkpoint');
  const checkpoint = firstRecords[69]!.seq;
  produce(paths.stateFile, 640, 320);
  assert.equal((await h.call('restart')).code, 0);
  const afterRestart = JSON.parse((await h.call('status')).stdout);
  assert.equal(afterRestart.storeId, storeId); assert.notEqual(afterRestart.instanceId, before.instanceId);
  const drain = new SQLiteStore({path: paths.stateFile}); try {drain.drainEvents();} finally {drain.close();}
  const expected = readAll(paths.stateFile, initial);
  const secondRecords: EventRecord[] = [];
  const second = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: checkpoint}}}, async frame => {secondRecords.push(frame.event);});
  try {await until(() => secondRecords.at(-1)?.seq === second.highWater);} finally {await second.close();}
  const seen = new Map<string, string>(); let duplicates = 0;
  for (const record of [...firstRecords, ...secondRecords]) {if (seen.has(record.seq)) {duplicates++; assert.equal(seen.get(record.seq), record.eventId);} seen.set(record.seq, record.eventId);}
  assert.equal(duplicates, 10);
  assert.deepEqual([...seen], expected.records.map(record => [record.seq, record.eventId]));
  assert.equal(expected.records.filter(record => record.type === 'diagnostics.degraded').length, 960);
  assert.ok(expected.pages > 1);
  const segmentsBefore = (await readdir(join(h.archive, 'events'))).filter(name => name.endsWith('.journal')).length;
  assert.ok(segmentsBefore > 2);
  assert.equal((await h.call('stop')).code, 0);
  // Exercise the production retention algorithm with a smaller fixture budget; production remains 40 MiB.
  const fixtureBudgetBytes = 128 * 1024;
  const journal = openJournal({directory: join(h.archive, 'events'), storeId, budgetBytes: fixtureBudgetBytes}); journal.append([]);
  const retained = journal.list(); assert.ok(BigInt(retained.firstAvailable) > BigInt(initial) + 1n);
  const oldCursor = encodeCursor({storeId, seq: initial});
  const offline = await h.call('events', '--after', oldCursor), offlineGap = JSON.parse(offline.stdout);
  assert.equal(offline.code, 2); assert.equal(offlineGap.error.code, 'CURSOR_EXPIRED'); assert.equal(offlineGap.data.nextAction, 'reread-status');
  assert.equal(JSON.parse((await h.call('status')).stdout).data.lifecycle, 'STOPPED');
  assert.equal((await h.call('start')).code, 0);
  let gap: NonNullable<EventStreamError['gap']> | undefined;
  await assert.rejects(transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: initial}}}, async () => assert.fail('expired history cannot be silently skipped')), error => {assert.ok(error instanceof EventStreamError); gap = error.gap; return error.message === 'CURSOR_EXPIRED';});
  assert.ok(gap); assert.equal(gap.nextAction, 'reread-status'); assert.equal(gap.firstAvailable, retained.firstAvailable);
  const status = JSON.parse((await h.call('status')).stdout); assert.equal(status.data.ready, true);
  const resumed: EventRecord[] = [], resumeAfter = String(BigInt(gap.firstAvailable) - 1n);
  const third = await transport.subscribe(paths.daemonEndpoint, key, {protocolVersion: 1, correlationId: randomUUID(), method: 'events.subscribe', params: {after: {storeId, seq: resumeAfter}}}, async frame => {resumed.push(frame.event);});
  try {await until(() => resumed.at(-1)?.seq === third.highWater);} finally {await third.close();}
  assert.deepEqual(resumed.map(record => [record.seq, record.eventId]), readAll(paths.stateFile, resumeAfter).records.map(record => [record.seq, record.eventId]));
  assert.deepEqual(resumed.map(record => record.seq), Array.from({length: resumed.length}, (_, i) => String(BigInt(resumeAfter) + BigInt(i + 1))));
  const samples = {measuredAt: new Date().toISOString(), platform: {node: process.versions.node, os: process.platform, arch: process.arch}, generatedEvents: 960,
    storeId, initial, beforeInstanceId: before.instanceId, afterRestartInstanceId: afterRestart.instanceId,
    partialReplay: {delivered: firstRecords.length, lastAccepted: firstEnd.lastReceived, savedCheckpoint: checkpoint},
    reconnect: {delivered: secondRecords.length, duplicates, stableIdentities: true, reconstructed: seen.size, reference: expected.records.length, pages: expected.pages, highWater: expected.highWater},
    rotation: {fixtureBudgetBytes, productionBudgetBytes: 40 * 1024 * 1024, segmentsBefore, firstAvailable: gap.firstAvailable, highWater: gap.highWater, offlineGap: offlineGap.error.code, liveGap: 'CURSOR_EXPIRED', nextAction: gap.nextAction},
    explicitResume: {after: resumeAfter, delivered: resumed.length, highWater: third.highWater, ordered: true}, anomalies: []};
  await writeFile('specs/001-core-background-daemon/reports/e3-replay-samples.json', JSON.stringify(samples, null, 2) + '\n');
});
