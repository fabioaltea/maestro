import { openSync, closeSync, fstatSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { SCHEMA_VERSION } from '../../src/storage/schema.js';
import { openJournal, encodeEvent } from '../../src/storage/event-journal.js';
import { appendDiagnosticLog, MiB } from '../../src/storage/diagnostic-budget.js';
import { createCliHarness } from '../fixtures/cli-harness.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import type { EventRecord } from '../../src/ports/storage.js';
import { execFileSync } from 'node:child_process';

// Standalone campaign: npm run build && npm run build:test && node --test dist-tests/tests/acceptance/event-persistence.test.js
// Allocation uses st_blocks*512; authoritative history is never pruned for diagnostic quotas.
test('E1 saturation: physical budgets, stable authoritative history, closed readers and bounded redacted pages', async t => {
  const h = await createCliHarness(t), paths = (await createPlatformPaths().resolveArchive(h.archive, 'write'))!;
  const storeId = randomUUID();
  let store: SQLiteStore | undefined;
  let temporaryPeakTotalBytes = 0, unlinkedPeakBytes = 0;
  const pinned: number[] = [];
  const unlinked = () => pinned.reduce((sum, fd) => { const info = fstatSync(fd); return sum + (info.nlink === 0 ? info.blocks * 512 : 0); }, 0);
  const temporary = (point: string) => {
    if (store && ['journal.allocated', 'journal.retentionPrepared', 'log.allocated'].includes(point)) temporaryPeakTotalBytes = Math.max(temporaryPeakTotalBytes, store.getEventState().usage!.totalBytes + unlinked());
  };
  const peaks = {journalBytes: 0, logBytes: 0, walBytes: 0, shmBytes: 0, outboxMetadataBytes: 0, totalBytes: 0, pendingBytes: 0};
  const record = () => {
    if (!store) return;
    const state = store.getEventState();
    for (const key of ['journalBytes', 'logBytes', 'walBytes', 'shmBytes', 'outboxMetadataBytes', 'totalBytes'] as const) peaks[key] = Math.max(peaks[key], state.usage![key]);
    const pinnedBytes = unlinked(); unlinkedPeakBytes = Math.max(unlinkedPeakBytes, pinnedBytes);
    temporaryPeakTotalBytes = Math.max(temporaryPeakTotalBytes, state.usage!.totalBytes + pinnedBytes);
    peaks.pendingBytes = Math.max(peaks.pendingBytes, state.pendingBytes);
  };
  store = new SQLiteStore({path: paths.stateFile, identity: {storeId, schemaVersion: SCHEMA_VERSION, ownerUid: paths.ownerUid, canonicalPath: paths.directory, revision: '0'}}, {checkpoint: point => { if (point === 'event.committed') record(); temporary(point); }});
  const ids = Array.from({length: 1000}, () => randomUUID());
  const fixture = new Database(paths.stateFile);
  const statement = fixture.prepare("INSERT INTO operations(request_id,action,payload_hash,owner_uid,target_instance_id,phase,outcome,accepted_at,completed_at) VALUES(?,'stop',?,?,NULL,'FINALIZED','SUCCEEDED',?,?)");
  fixture.transaction(() => { for (const id of ids) statement.run(id, 'a'.repeat(64), paths.ownerUid, new Date().toISOString(), new Date().toISOString()); })();
  fixture.close();
  let retainedFloor = '1', generatedBytes = 0;
  try {
    const journal = openJournal({directory: join(paths.directory, 'events'), storeId, checkpoint: temporary});
    for (let offset = 0; offset < 3500; offset += 4) {
      const batch: EventRecord[] = Array.from({length: 4}, (_, index) => ({protocolVersion: 1, storeId, eventId: randomUUID(), seq: String(offset + index + 1), occurredAt: new Date().toISOString(), instanceId: null, operationId: null,
        type: 'diagnostics.degraded', payload: {padding: 'x'.repeat(14_000)}}));
      generatedBytes += batch.reduce((bytes, event) => bytes + encodeEvent(event).length, 0);
      journal.append(batch); appendDiagnosticLog(paths.directory, batch, temporary); record();
      if (offset === 100) {
        const oldest = (await readdir(join(paths.directory, 'events'))).filter(name => name.endsWith('.journal')).sort().slice(0, 10);
        for (const name of oldest) pinned.push(openSync(join(paths.directory, 'events', name), 'r'));
      }
    }
    const detachedPage = journal.list({limit: 1}); retainedFloor = detachedPage.firstAvailable;
    assert.ok(BigInt(retainedFloor) > 1n);
    const metadata = new Database(paths.stateFile);
    metadata.prepare('UPDATE journal_metadata SET high_water=?,retention_floor=?').run(3500n, BigInt(retainedFloor));
    metadata.prepare('UPDATE store SET next_event_seq=?').run(3501n); metadata.close();
    const sentinel = 'maestro-e1-raw-error-secret-sentinel';
    for (let batch = 0; batch < 16; batch++) {
      store.recordEvents(Array.from({length: 128}, () => ({type: 'diagnostics.degraded' as const, payload: {code: 'BUSY', rawError: sentinel, token: sentinel, phase: sentinel}})));
      record();
    }
    assert.equal(detachedPage.records.length, 1);
    const finalState = store.getEventState(true);
    assert.equal(finalState.degraded, false);
    assert.equal(finalState.pendingBytes, 0);
    for (const id of ids) assert.equal(store.getOperation(id)?.outcome, 'SUCCEEDED');
    const cli = await h.call('events', '--limit', '1000');
    assert.equal(cli.code, 0, cli.stdout);
    assert.ok(Buffer.byteLength(cli.stdout) <= 65_536);
    assert.equal(JSON.parse(cli.stdout).data.events.truncated, true);
    for (const folder of ['events', 'logs']) for (const name of await readdir(join(paths.directory, folder))) {
      assert.equal((await readFile(join(paths.directory, folder, name))).includes(Buffer.from(sentinel)), false);
    }
    assert.ok(peaks.journalBytes <= 40 * MiB);
    assert.ok(peaks.logBytes <= 5 * MiB);
    assert.ok(peaks.walBytes <= 2 * MiB);
    assert.ok(peaks.outboxMetadataBytes <= MiB);
    assert.ok(peaks.totalBytes <= 50 * MiB);
    assert.equal(pinned.length, 10);
    assert.ok(unlinkedPeakBytes > 0 && unlinkedPeakBytes <= 10 * 65_536);
    assert.ok(temporaryPeakTotalBytes <= 55 * MiB);
    assert.ok(peaks.pendingBytes > 0 && peaks.pendingBytes <= 65_536);
    await writeFile(resolve('specs/001-core-background-daemon/reports/e1-events-samples.json'), JSON.stringify({
      measuredAt: new Date().toISOString(), version: {schema: SCHEMA_VERSION, node: process.versions.node, macOS: execFileSync('/usr/bin/sw_vers', ['-productVersion'], {encoding: 'utf8'}).trim(), arch: process.arch},
      segmentBytes: 65536, maximumReaderSegmentBytes: 65536,
      generatedEvents: 5548, generatedBytesBeforeRetention: generatedBytes, retainedFloor, confirmedOperationsPreserved: ids.length,
      peaks, unlinkedPeakBytes, pinnedReaderHandles: pinned.length, temporaryPeakTotalBytes, final: finalState, cliPageBytes: Buffer.byteLength(cli.stdout), sentinelAbsent: true,
      allocationMethod: 'st_blocks * 512 plus fstat of ten deliberately pinned unlinked reader handles; full WAL and SHM; dbstat event tables plus full freelist; synchronous pages close files before returning',
    }, null, 2) + '\n');
  } catch (error) {
    t.diagnostic(JSON.stringify({peaks, current: store.getEventState()}));
    throw error;
  } finally { for (const fd of pinned) closeSync(fd); store.close(); }
});

test('diagnostics expose journal corruption without rewriting it or confirming damaged events', async t => {
  const h = await createCliHarness(t);
  assert.equal((await h.call('start')).code, 0);
  assert.equal((await h.call('stop')).code, 0);
  const files = (await readdir(join(h.archive, 'events'))).filter(name => name.endsWith('.journal'));
  const file = join(h.archive, 'events', files[0]!);
  const original = await readFile(file), damaged = Buffer.from(original); damaged[45] = damaged[45]! ^ 1;
  await writeFile(file, damaged);
  try {
    const diag = await h.call('diagnostics'); assert.equal(diag.code, 0, diag.stdout);
    assert.equal(JSON.parse(diag.stdout).data.observability.degraded, true);
    assert.equal(JSON.parse(diag.stdout).data.observability.errorCode, 'STATE_CORRUPT');
    const events = await h.call('events'); assert.equal(events.code, 7, events.stdout);
    assert.equal(JSON.parse(events.stdout).error.code, 'STATE_CORRUPT');
    assert.deepEqual(await readFile(file), damaged);
  } finally { await writeFile(file, original); }
});
