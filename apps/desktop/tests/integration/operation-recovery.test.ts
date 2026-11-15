import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationRecovery } from '../../src/main/operation-recovery.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { createScratch } from '../fixtures/desktop.ts';
import type { PublicResult } from '../../src/shared/bridge-contract.ts';
function response(storeId: string | null, requestId: string | null): PublicResult {
  return { protocolVersion: 1, storeId, instanceId: null, requestId, result: 'OK', outcome: null, liveness: 'ABSENT_VERIFIED', freshness: 'LAST_KNOWN', data: {}, error: null };
}
test('restart only queries original IDs, unknown IDs stay unknown and foreign stores are fenced', async () => {
  const f = await createScratch();
  try {
    const receipts = new ReceiptStore(join(f.userData, 'receipts')), storeId = randomUUID();
    const receipt = await receipts.create({ requestId: randomUUID(), namespace: 'foundation', action: 'start', archivePath: f.archive, storeId, projectId: null, expectedRevision: null, intentHash: 'b'.repeat(64) });
    const commands: string[] = []; let foreign = false, completed = false;
    const recovery = new OperationRecovery(receipts, { async call(c) {
      commands.push(c.action); assert.ok(['status', 'operation'].includes(c.action));
      if (c.action === 'status') return response(foreign ? randomUUID() : storeId, null);
      assert.equal(c.params?.requestId, receipt.requestId);
      return completed ? { ...response(storeId, receipt.requestId), outcome: 'SUCCEEDED', data: { operation: { requestId: receipt.requestId, action: 'start', outcome: 'SUCCEEDED' } } } : { ...response(storeId, receipt.requestId), result: 'ERROR', error: { code: 'INVALID_REQUEST', message: 'safe', nextAction: 'safe' } };
    }, close() {} });
    await recovery.reconcileAll(); assert.equal((await receipts.list())[0]!.phase, 'UNKNOWN');
    foreign = true; const before = commands.length; await recovery.reconcile(receipt.requestId);
    assert.deepEqual(commands.slice(before), ['status']); assert.equal((await receipts.list())[0]!.storeId, storeId);
    foreign = false; completed = true; await recovery.reconcile(receipt.requestId);
    assert.equal((await receipts.list())[0]!.phase, 'TERMINAL');
    assert.ok(commands.every(c => c === 'status' || c === 'operation'));
  } finally { await f.cleanup(); }
});
test('an interrupted receipt update keeps the original durable ID readable and never enables a new effect', async () => {
  const f = await createScratch();
  try {
    const { writeFile, access } = await import('node:fs/promises');
    const storeId = randomUUID(), path = join(f.userData, 'receipts'), store = new ReceiptStore(path);
    const original = await store.create({ requestId: randomUUID(), namespace: 'foundation', action: 'start', archivePath: f.archive, storeId, projectId: null, expectedRevision: null, intentHash: 'c'.repeat(64) });
    const temporary = join(path, `.${original.requestId}.${randomUUID()}.tmp`);
    await writeFile(temporary, '{incomplete', { mode: 0o600 });
    const restarted = new ReceiptStore(path);
    assert.equal((await restarted.list())[0]!.requestId, original.requestId);
    await assert.rejects(() => restarted.create({ ...original, requestId: randomUUID() }));
    await restarted.update(original.requestId, { phase: 'TERMINAL', outcome: 'SUCCEEDED' });
    await restarted.dismiss(original.requestId);
    await assert.rejects(() => access(temporary));
  } finally { await f.cleanup(); }
});
