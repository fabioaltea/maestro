import { join } from 'node:path';
import { ReceiptStore } from './receipt-store.ts';
import type { Receipt } from './receipt-store.ts';
import { OperationRecovery } from './operation-recovery.ts';
import { ActionService } from './action-handlers.ts';
import type { BridgeRouter } from './bridge.ts';
import { ArchiveContext } from './archive-context.ts';
import { record, text } from '../shared/validation.ts';
export function publicReceipt(receipt: Receipt, context: ArchiveContext) {
  return { requestId: receipt.requestId, namespace: receipt.namespace, action: receipt.action, projectId: receipt.projectId,
    storeId: receipt.storeId, phase: receipt.phase, outcome: receipt.outcome, errorCode: receipt.errorCode, createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt, currentArchive: context.current?.path === receipt.archivePath };
}
export function installLifecycle(router: BridgeRouter, context: ArchiveContext, userData: string) {
  const receipts = new ReceiptStore(join(userData, 'operation-receipts'));
  const core = router.services.core;
  const actions = core ? new ActionService({ core, receipts, context, owner: () => ({ owner: router.window.webContents.id, frame: router.window.webContents.mainFrame.routingId }) }) : null;
  const recovery = core ? new OperationRecovery(receipts, core) : null;
  router.register('listReceipts', async () => ({ receipts: (await receipts.list()).map(r => publicReceipt(r, context)) }));
  router.register('prepareAction', async request => {
    if (!actions) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    try { return await actions.prepare(text(request.action), record(request.params)); }
    finally { router.setContext(context.current?.view ?? null); }
  });
  router.register('confirmAction', async request => {
    if (!actions) throw new Error(router.services.runtimeError ?? 'RUNTIME_UNAVAILABLE');
    try { const result = await actions.confirm(text(request.confirmationId), ['daemon', 'project']); return { ...result, receipt: publicReceipt(result.receipt, context) }; }
    finally { router.setContext(context.current?.view ?? null); }
  });
  router.register('cancelAction', request => { actions?.confirmations.cancel(text(request.confirmationId), ['daemon', 'project']); return { canceled: true }; });
  router.register('reconcileOperation', async request => {
    if (!recovery) throw new Error('RUNTIME_UNAVAILABLE');
    const result = await recovery.reconcile(text(request.receiptId)); return { ...result, receipt: publicReceipt(result.receipt, context) };
  });
  router.register('dismissReceipt', async request => { await receipts.dismiss(text(request.receiptId)); return { dismissed: true }; });
  router.register('selectReceiptArchive', async request => {
    const receipt = (await receipts.list()).find(r => r.requestId === request.receiptId); if (!receipt) throw new Error('INVALID_INPUT');
    if (!router.services.dialogs.confirmSelection || !await router.services.dialogs.confirmSelection('Aprire l’archivio di questa operazione?', receipt.archivePath)) return { context: router.context, canceled: true };
    if ((router.context?.selectionEpoch ?? 0) !== request.selectionEpoch) throw new Error('STALE_CONTEXT');
    const selection = await context.select(receipt.archivePath); router.setContext(selection.view); return { context: selection.view, canceled: false };
  });
  void recovery?.reconcileAll().catch(() => undefined);
  router.window.once('closed', () => recovery?.close());
  return { actions, receipts, recovery, close: () => recovery?.close() };
}
