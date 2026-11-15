import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import Database from 'better-sqlite3';
import { createRegistryStore } from '../fixtures/registry-store.js';
import { openStorage } from '../../src/storage/worker.js';
test('confined readonly resource diagnostics remain bounded after hundreds of released resources', async t => {
  const f = await createRegistryStore(t); f.store.close();
  const writer = new Database(f.path);
  try {
    const insert = writer.prepare('INSERT INTO managed_resources VALUES (?,?,?,?,?,?,?,?,?,?)');
    writer.transaction(() => {
      for (let i = 0; i < 250; i++) insert.run(randomUUID(), f.instanceId, 'auxiliary', 'foundation', '1', null, '/private/fixture/'.repeat(80), null, 'ABSENT', 'RELEASED');
      for (let i = 0; i < 25; i++) insert.run(randomUUID(), f.instanceId, 'temp', 'foundation', '1', null, '/private/fixture/'.repeat(80), null, 'UNKNOWN', 'BLOCKED');
    })();
  } finally { writer.close(); }
  const before = await readFile(f.path), reader = await openStorage({ path: f.path, readonly: true });
  try {
    const issues = await reader.listResourceSummaries(f.instanceId, { unreleasedOnly: true });
    assert.equal(issues.resources.length, 20); assert.equal(issues.truncated, true);
    assert.ok(issues.resources.every(r => r.releaseState === 'BLOCKED' && !Object.hasOwn(r, 'endpoint') && !Object.hasOwn(r, 'credentialRef')));
    assert.ok(Buffer.byteLength(JSON.stringify(issues)) < 8192);
    assert.equal((await reader.listResourceSummaries(f.instanceId, {})).resources.length, 20);
  } finally { await reader.close(); }
  assert.deepEqual(await readFile(f.path), before);
});
