import type { PublicResult } from '../shared/bridge-contract.ts';
import { validateDiscoveryData } from '../shared/discovery-contract.ts';
import type { Receipt, ReceiptStore } from './receipt-store.ts';
const certainRejections = new Set(['INVALID_REQUEST', 'IDEMPOTENCY_CONFLICT', 'APPROVAL_REQUIRED', 'APPROVAL_STALE', 'CONTEXT_CHANGED', 'CONTEXT_LIMIT', 'SOURCE_EXCLUDED',
  'PROVIDER_NOT_CONFIGURED', 'PROVIDER_AUTH_REQUIRED', 'PROVIDER_UNSUPPORTED', 'PROVIDER_UNSAFE', 'PROVIDER_UNAVAILABLE', 'DISCOVERY_BUSY', 'DISCOVERY_LIMIT', 'PROJECT_NOT_FOUND', 'PROJECT_REMOVED', 'UNSUPPORTED_VERSION']);
/** Admission completes the submission only; the Discovery state remains in core. */
export async function settleDiscoveryReceipt(store: ReceiptStore, receipt: Receipt, result: PublicResult): Promise<Receipt> {
  const unknown = (code = 'UNKNOWN_OUTCOME') => store.update(receipt.requestId, { phase: 'UNKNOWN', errorCode: code });
  if (result.requestId !== receipt.requestId) return unknown();
  if (receipt.storeId && receipt.storeId !== result.storeId) return unknown('WRONG_STORE');
  if (result.result === 'UNKNOWN_OUTCOME') return unknown();
  try {
    const data = validateDiscoveryData(result.data.operation !== undefined ? 'operation' : receipt.action === 'configure' ? 'provider.configure' : receipt.action === 'check' ? 'provider.check' : receipt.action === 'discard' ? 'preview.discard' : receipt.action, result.data);
    if (data.operation !== undefined) {
      const operation = data.operation as Record<string, unknown>;
      if (operation.requestId !== receipt.requestId || operation.action !== receipt.action || operation.outcome === 'UNKNOWN' || operation.outcome !== result.outcome) return unknown();
      const terminal = operation.phase === 'FINALIZED' && ['SUCCEEDED', 'FAILED', 'BLOCKED', 'INTERRUPTED'].includes(String(operation.outcome));
      return store.update(receipt.requestId, { phase: terminal ? 'TERMINAL' : 'RECONCILING', outcome: result.outcome, errorCode: result.error?.code ?? null, ...(result.storeId ? { storeId: result.storeId } : {}) });
    }
    if (data.accepted === true && data.requestId === receipt.requestId && ['OK', 'BUSY'].includes(result.result)) return store.update(receipt.requestId,
      { phase: 'RECONCILING', outcome: 'IN_PROGRESS', errorCode: null, ...(result.storeId ? { storeId: result.storeId } : {}) });
    if (result.liveness === 'LIVE_VERIFIED' && result.error && certainRejections.has(result.error.code)) return store.update(receipt.requestId, { phase: 'TERMINAL', outcome: 'BLOCKED', errorCode: result.error.code });
    return unknown();
  } catch { return unknown('CLIENT_PROTOCOL_ERROR'); }
}
