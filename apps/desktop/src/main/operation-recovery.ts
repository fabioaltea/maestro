import type { CorePort } from './ports.ts';
import { ReceiptStore } from './receipt-store.ts';
import { settleReceipt } from './action-handlers.ts';
import { unknownResult } from './core-cli.ts';
export class OperationRecovery {
  private receipts: ReceiptStore;
  private core: CorePort;
  private active = new Set<string>();
  private stopped = false;
  constructor(receipts: ReceiptStore, core: CorePort) { this.receipts = receipts; this.core = core; }
  async reconcile(id: string) {
    const receipt = (await this.receipts.list()).find(r => r.requestId === id);
    if (!receipt) throw new Error('INVALID_INPUT');
    if (receipt.phase === 'TERMINAL') return { receipt, result: null };
    if (this.active.has(id) || this.stopped) throw new Error('LOCAL_BUSY');
    this.active.add(id);
    try {
      const state = await this.core.call({ namespace: 'daemon', action: 'status', archive: receipt.archivePath });
      if (receipt.storeId && state.storeId !== receipt.storeId) {
        const unknown = await this.receipts.update(id, { phase: 'UNKNOWN', errorCode: 'WRONG_STORE' });
        return { receipt: unknown, result: unknownResult(id) };
      }
      if (state.result !== 'OK') throw new Error('OPERATION_UNCERTAIN');
      const result = await this.core.call({ namespace: receipt.namespace === 'foundation' ? 'daemon' : receipt.namespace, action: 'operation', archive: receipt.archivePath, params: { requestId: id } });
      const final = await settleReceipt(this.receipts, receipt, result);
      return { receipt: final, result: final.phase === 'UNKNOWN' ? unknownResult(id) : result };
    } catch {
      const unknown = await this.receipts.update(id, { phase: 'UNKNOWN', errorCode: 'UNKNOWN_OUTCOME' });
      return { receipt: unknown, result: unknownResult(id) };
    } finally { this.active.delete(id); }
  }
  async reconcileAll() {
    for (const receipt of await this.receipts.list()) {
      if (this.stopped) return;
      if (receipt.phase !== 'TERMINAL' && !this.active.has(receipt.requestId)) await this.reconcile(receipt.requestId).catch(() => undefined);
    }
  }
  close() { this.stopped = true; }
}
