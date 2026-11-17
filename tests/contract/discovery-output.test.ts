import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { outputFixture } from '../fixtures/discovery-output.js';
import { value } from '../fixtures/discovery-artifacts.js';
import { createDiscoveryReader } from '../../src/core/discovery/read.js';
test('normalized UTF-8 output uses hash-validated raw8KiB pages within32KiB and stable cursors', async t => {
  const f = await outputFixture(t), text = 'SYNTHETIC_OUTPUT_CANARY\n' + '🎼é'.repeat(1800);
  await f.publisher.publish(f.identity, { kind: 'AGENT_TEXT', text });
  const read = createDiscoveryReader({ storage: f.store as never, storeId: f.storeId, offline: false });
  let cursor: string | undefined, result = '';
  do {
    const page = await read('discovery.output.list', { runId: f.run.runId, limit: 1, ...(cursor ? { cursor } : {}) });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= 32768);
    for (const item of page.items as { data: string; byteLength: number }[]) { const bytes = Buffer.from(item.data, 'base64'); assert.ok(bytes.length <= 8192); assert.equal(bytes.length, item.byteLength); result += new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    cursor = page.nextCursor as string | undefined;
  } while (cursor);
  assert.equal(result, text); assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId })).data!.outputWatermark, '2');
  await assert.rejects(read('discovery.output.list', { runId: randomUUID(), cursor: Buffer.from(JSON.stringify({ version: 1, storeId: f.storeId, kind: 'discovery.output.list', targetId: f.run.runId, revision: f.run.generation, offset: 1 })).toString('base64url') }));
});
test('foreign generations and output after exit cannot publish an artifact or advance a watermark', async t => {
  const f = await outputFixture(t), before = value(f.store.getDiscoveryBudget());
  await assert.rejects(f.publisher.publish({ ...f.identity, generation: randomUUID() }, { kind: 'PROGRESS', text: 'x' }), /STALE_TARGET/);
  value(f.store.commitDiscoveryMetadata({ kind: 'run', expectedPhase: 'PROVIDER_RUNNING', exitVerified: true, value: { ...f.run, phase: 'EXIT_OBSERVED', outcome: 'FAILED' } }));
  await assert.rejects(f.publisher.publish(f.identity, { kind: 'AGENT_TEXT', text: 'late' }), /STALE_TARGET/);
  assert.deepEqual(value(f.store.getDiscoveryBudget()), before);
});
test('retained4MiB overflow marks truncation without another file or a false successful result', async t => {
  const f = await outputFixture(t), bytes = Buffer.alloc(8192, 97), reserved = value(f.store.reserveDiscoveryArtifact('OUTPUT', bytes.length)), artifact = value(f.store.publishDiscoveryArtifact(reserved.artifactId, bytes));
  f.database.prepare("WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<512) INSERT INTO discovery_output(run_id,seq,artifact_id,sha256,bytes,kind,created_at,truncated) SELECT ?,i,?,?,8192,'AGENT_TEXT',?,0 FROM n").run(f.run.runId, artifact.artifactId, artifact.sha256, new Date().toISOString());
  f.database.prepare('UPDATE discovery_runs SET output_watermark=512 WHERE run_id=?').run(f.run.runId);
  const before = value(f.store.getDiscoveryBudget()).allocatedFiles;
  await assert.rejects(f.publisher.publish(f.identity, { kind: 'AGENT_TEXT', text: 'overflow' }), /PROVIDER_OUTPUT_LIMIT/);
  assert.equal(value(f.store.getDiscoveryBudget()).allocatedFiles, before);
  const last = value(f.store.readDiscoveryMetadata({ kind: 'output', id: f.run.runId, offset: 511, limit: 1 })).data.items[0]!;
  assert.equal(last.seq, '512'); assert.equal(last.truncated, true);
  assert.equal(value(f.store.readDiscoveryMetadata({ kind: 'run', id: f.run.runId })).data!.outcome, 'RUNNING');
});
