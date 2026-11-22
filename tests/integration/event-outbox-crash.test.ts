import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { createProcessSandbox } from '../fixtures/process-sandbox.js';
import { loadContract } from '../fixtures/load-contract.js';

type EventStore = SQLiteStore;
for (const point of ['event.beforeCommit', 'event.committed', 'journal.appended', 'journal.synced', 'event.cleared']) {
  test(`outbox survives actual crash at ${point} with stable event identity and no premature publication`, async t => {
    await loadContract('storage/sqlite-store.js', ['SQLiteStore']);
    assert.equal(typeof (SQLiteStore.prototype as unknown as EventStore).getEventState, 'function', 'event outbox contract is missing');
    const sandbox = await createProcessSandbox(t);
    const path = join(sandbox.directory, 'state.sqlite'), requestId = randomUUID();
    const file = join(sandbox.directory, 'event-intent.json');
    await writeFile(file, JSON.stringify({path, directory: sandbox.directory, storeId: randomUUID(), requestId}), {mode: 0o600});
    const child = sandbox.spawnFixture('event-writer.js', [file, point]);
    const exit = await new Promise<number | null>(resolve => child.once('exit', resolve));
    assert.equal(exit, 86);
    const reader = new SQLiteStore({path, readonly: true}) as EventStore;
    const confirmed = reader.getOperation(requestId);
    const before = reader.getEventState();
    assert.equal(Boolean(confirmed), point !== 'event.beforeCommit');
    assert.equal(reader.listEvents().records.length, 0);
    if (confirmed) assert.ok(before.pendingBytes > 0 && before.pendingBytes <= 65_536);
    reader.close();
    const writer = new SQLiteStore({path}) as EventStore;
    try {
      writer.drainEvents();
      const first = writer.listEvents().records;
      assert.equal(first.length, confirmed ? 1 : 0);
      if (confirmed) { assert.equal(first[0]?.seq, '1'); assert.equal(first[0]?.operationId, requestId); }
      writer.drainEvents();
      assert.deepEqual(writer.listEvents().records, first);
      assert.equal(writer.getEventState().pendingBytes, 0);
      assert.equal(writer.getEventState().highWater, confirmed ? '1' : '0');
    } finally { writer.close(); }
  });
}
