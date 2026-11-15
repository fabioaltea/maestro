import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ActionService } from '../../src/main/action-handlers.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { ArchiveContext } from '../../src/main/archive-context.ts';
import { createScratch } from '../fixtures/desktop.ts';
import type { PublicResult } from '../../src/shared/bridge-contract.ts';
function status(storeId: string | null): PublicResult { return { protocolVersion: 1, storeId, requestId: null, instanceId: null, result: 'OK', outcome: null, freshness: 'LAST_KNOWN', liveness: 'ABSENT_VERIFIED', data: {}, error: null }; }
test('dispatch writes original UUID before a single effect and preserves uncertainty on reply loss', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    const receipts = new ReceiptStore(join(f.userData, 'receipts'));
    let effects = 0;
    const service = new ActionService({ context, receipts, owner: () => ({ owner: 1, frame: 2 }), core: {
      async call(command) {
        if (command.action === 'status') return status(null);
        const durable = await receipts.list(); assert.equal(durable.length, 1); assert.equal(durable[0]!.requestId, command.requestId);
        effects++; throw new Error('lost response');
      }, close() {},
    } });
    const prepared = await service.prepare('daemon.start', {});
    const result = await service.confirm(prepared.confirmationId);
    assert.equal(result.result.result, 'UNKNOWN_OUTCOME'); assert.equal(effects, 1);
    assert.equal((await receipts.list())[0]!.requestId, prepared.requestId);
    await assert.rejects(() => service.confirm(prepared.confirmationId));
    await assert.rejects(() => service.prepare('daemon.start', {}), { message: 'OPERATION_UNCERTAIN' });
    assert.equal(effects, 1);
  } finally { await f.cleanup(); }
});
test('store replacement invalidates approval before a mutation is submitted', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive);
    let storeId = randomUUID(), effects = 0;
    const service = new ActionService({ context, receipts: new ReceiptStore(join(f.userData, 'receipts')), owner: () => ({ owner: 1, frame: 2 }), core: {
      async call(command) { if (command.action === 'status') return status(storeId); effects++; return status(storeId); }, close() {},
    } });
    const prepared = await service.prepare('daemon.start', {}); storeId = randomUUID();
    await assert.rejects(() => service.confirm(prepared.confirmationId)); assert.equal(effects, 0);
  } finally { await f.cleanup(); }
});
test('receipt persistence failure prevents every mutating call', async () => {
  const f = await createScratch();
  try {
    const context = new ArchiveContext(); await context.select(f.archive); let effects = 0;
    const service = new ActionService({ context, receipts: new ReceiptStore(join(f.userData, 'receipts'), () => { throw new Error('controlled disk failure'); }), owner: () => ({ owner: 1, frame: 2 }), core: {
      async call(command) { if (command.action !== 'status') effects++; return status(null); }, close() {},
    } });
    const prepared = await service.prepare('daemon.start', {});
    await assert.rejects(() => service.confirm(prepared.confirmationId), { message: 'RECEIPT_STORAGE_UNAVAILABLE' });
    assert.equal(effects, 0);
  } finally { await f.cleanup(); }
});
