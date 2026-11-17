import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { ActionService, settleReceipt } from '../../src/main/action-handlers.ts';
import { Confirmations } from '../../src/main/confirmations.ts';
import { ReceiptStore } from '../../src/main/receipt-store.ts';
import { OperationRecovery } from '../../src/main/operation-recovery.ts';
import type { PublicResult } from '../../src/shared/bridge-contract.ts';
import type { ReceiptMeta } from '../../src/main/receipt-store.ts';
import { discoveryDesktopFixture } from '../fixtures/discovery.ts';
import type { DiscoveryResolved } from '../fixtures/discovery.ts';
import type { Params } from '../../src/shared/bridge-contract.ts';

function service(f: Awaited<ReturnType<typeof discoveryDesktopFixture>>, receipts: ReceiptStore) {
  const actions = new ActionService({ context: f.context, receipts, core: f.core, owner: () => ({ ...f.owner }), confirmations: new Confirmations(f.clock.now) }) as ActionService & { resolveDiscovery: (action: string, params: Params) => Promise<DiscoveryResolved> };
  actions.resolveDiscovery = (action, params) => f.actions.resolve(action, params); return actions;
}
test('Discovery receipt is durable before start; admission remains reconciling and stores no grant/intent/provider path', async () => {
  const f = await discoveryDesktopFixture();
  try {
    const receipts = new ReceiptStore(join(f.userData, 'receipts')), actions = service(f, receipts); let effects = 0;
    f.controls.beforeEffect = async command => { effects++; const records = await receipts.list(); assert.equal(records.length, 1);
      assert.equal(records[0]!.namespace as string, 'discovery'); assert.equal(records[0]!.action, 'start'); assert.equal(records[0]!.phase, 'PREPARED'); assert.equal(records[0]!.requestId, command.requestId);
      assert.ok(!JSON.stringify(records).includes('grantId')); assert.ok(!JSON.stringify(records).includes('canonicalIntent')); assert.ok(!JSON.stringify(records).includes(f.binary)); };
    const prepared = await actions.prepare('discovery.start', f.start()); assert.equal(effects, 0);
    const confirmed = await actions.confirm(prepared.confirmationId); assert.equal(effects, 1);
    assert.equal(confirmed.receipt.phase, 'RECONCILING'); assert.equal(confirmed.result.data.accepted, true); assert.equal(confirmed.result.outcome, null);
    assert.ok(Buffer.byteLength(await readFile(join(receipts.directory, `${prepared.requestId}.json`))) <= 4096);
  } finally { await f.cleanup(); }
});
test('cancelled, expired, wrong-owner and stale-epoch confirmations have no mutation or receipt', async () => {
  const f = await discoveryDesktopFixture();
  try {
    const receipts = new ReceiptStore(join(f.userData, 'receipts')), actions = service(f, receipts); let effects = 0; f.controls.beforeEffect = async () => { effects++; };
    const cancelled = await actions.prepare('discovery.start', f.start()); actions.confirmations.cancel(cancelled.confirmationId); await assert.rejects(() => actions.confirm(cancelled.confirmationId));
    const expired = await actions.prepare('discovery.start', f.start()); f.clock.advance(60001); await assert.rejects(() => actions.confirm(expired.confirmationId));
    const owner = await actions.prepare('discovery.start', f.start()); f.owner.frame++; await assert.rejects(() => actions.confirm(owner.confirmationId)); f.owner.frame--;
    const stale = await actions.prepare('discovery.start', f.start()); await f.context.select(join(f.directory, 'other')); await assert.rejects(() => actions.confirm(stale.confirmationId));
    assert.equal(effects, 0); assert.equal((await receipts.list()).length, 0);
  } finally { await f.cleanup(); }
});
test('lost reply recovers only the original Discovery operation, with no registry fallback or repeated start', async () => {
  const f = await discoveryDesktopFixture();
  try {
    const receipts = new ReceiptStore(join(f.userData, 'receipts')), actions = service(f, receipts); f.controls.loseReply = true;
    const prepared = await actions.prepare('discovery.start', f.start()), uncertain = await actions.confirm(prepared.confirmationId);
    assert.equal(uncertain.receipt.phase, 'UNKNOWN'); assert.equal(uncertain.result.requestId, prepared.requestId);
    const effects = f.calls.filter(c => c.namespace === 'discovery' && c.action === 'start').length;
    f.controls.loseReply = false;
    const recovered = await new OperationRecovery(receipts, f.core).reconcile(prepared.requestId);
    assert.equal(recovered.receipt.phase, 'TERMINAL'); assert.equal(recovered.receipt.outcome, 'SUCCEEDED');
    assert.ok(f.calls.some(c => c.namespace === 'discovery' && c.action === 'operation' && c.params?.requestId === prepared.requestId));
    assert.equal(f.calls.filter(c => c.namespace === 'discovery' && c.action === 'start').length, effects);
    assert.equal(f.calls.filter(c => c.namespace === 'project' && c.action === 'operation').length, 0);
  } finally { await f.cleanup(); }
});
test('Discovery BLOCKED is terminal, wrong action/store is unknown and receipts reject secret or replayable fields', async () => {
  const f = await discoveryDesktopFixture();
  try {
    const receipts = new ReceiptStore(join(f.userData, 'receipts'));
    const meta = (requestId: string): ReceiptMeta => ({ requestId, namespace: 'discovery', action: 'start', archivePath: f.archive, storeId: f.storeId, projectId: f.projectId, expectedRevision: '1', intentHash: 'a'.repeat(64) } as unknown as ReceiptMeta);
    const original = await receipts.create(meta(randomUUID()));
    const response = (requestId: string, action: string, storeId: string): PublicResult => ({ protocolVersion: 1, requestId, storeId, instanceId: randomUUID(), result: 'BLOCKED', outcome: 'BLOCKED',
      freshness: 'LIVE', liveness: 'LIVE_VERIFIED', error: null, data: { operation: { requestId, action, phase: 'FINALIZED', outcome: 'BLOCKED', acceptedAt: new Date().toISOString(), completedAt: new Date().toISOString(), result: null, error: null } } });
    assert.equal((await settleReceipt(receipts, original, response(original.requestId, 'start', f.storeId))).phase, 'TERMINAL');
    const wrong = await receipts.create(meta(randomUUID())); assert.equal((await settleReceipt(receipts, wrong, response(wrong.requestId, 'configure', f.storeId))).phase, 'UNKNOWN');
    const store = await receipts.create(meta(randomUUID())); assert.equal((await settleReceipt(receipts, store, response(store.requestId, 'start', randomUUID()))).phase, 'UNKNOWN');
    await assert.rejects(() => receipts.create({ ...meta(randomUUID()), canonicalIntent: 'PRIVATE' } as ReceiptMeta));
    await assert.rejects(() => receipts.create({ ...meta(randomUUID()), grantId: randomUUID(), providerPath: f.binary } as ReceiptMeta));
  } finally { await f.cleanup(); }
});
