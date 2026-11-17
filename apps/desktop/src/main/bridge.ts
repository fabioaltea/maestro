import { resultLogMetadata } from './safe-log.ts';
import { ipcMain } from 'electron';
import type { BrowserWindow } from 'electron';
import { CHANNEL } from '../shared/bridge-contract.ts';
import type { ArchiveView, BridgeMethod, BridgeRequest, BridgeResponse } from '../shared/bridge-contract.ts';
import { safeError, validateRequest, validateSender } from '../shared/validation.ts';
import { DISCOVERY_BRIDGE_METHODS } from '../shared/discovery-contract.ts';
import type { SafeLog } from './safe-log.ts';
import type { CorePort, DialogPort } from './ports.ts';
export interface BridgeServices { core: CorePort | null; runtimeError: string | null; dialogs: DialogPort; log?: SafeLog }
export type Handler = (request: BridgeRequest) => Promise<unknown> | unknown;
export function installBridge(window: BrowserWindow, services: BridgeServices) {
  const handlers = new Map<BridgeMethod, Handler>();
  let context: ArchiveView | null = null, pending = 0;
  const router = {
    services,
    get context() { return context; },
    setContext(value: ArchiveView | null) { context = value; },
    register(method: BridgeMethod, handler: Handler) { handlers.set(method, handler); },
    window,
  };
  handlers.set('releaseViewReads', async () => { await services.core?.cancelViewReads?.(); return {released:true}; });
  handlers.set('context', () => ({ context, runtimeReady: services.core !== null, error: services.runtimeError ? safeError(services.runtimeError) : null }));
  ipcMain.handle(CHANNEL, async (event, method: unknown, input: unknown): Promise<BridgeResponse> => {
    const envelope = { bridgeVersion: 1 as const, callId: '', selectionEpoch: 0, archiveHandle: null as string | null, storeId: null as string | null, result: null as unknown, error: null as BridgeResponse['error'] };
    let entered = false, authorized = false;const startedAt=performance.now();
    try {
      if (window.isDestroyed() || !event.senderFrame || typeof method !== 'string') throw new Error('INVALID_INPUT');
      validateSender({ webContentsId: event.sender.id, frameId: event.senderFrame.routingId, mainFrame: event.senderFrame === window.webContents.mainFrame, url: event.senderFrame.url },
        { webContentsId: window.webContents.id, frameId: window.webContents.mainFrame.routingId });
      authorized = true;
      Object.assign(envelope, { selectionEpoch: context?.selectionEpoch ?? 0, archiveHandle: context?.archiveHandle ?? null, storeId: context?.storeId ?? null });
      const request = validateRequest(method, input);
      envelope.callId = request.callId;
      if (method !== 'context' && request.selectionEpoch !== (context?.selectionEpoch ?? 0)) throw new Error('STALE_CONTEXT');
      if (pending >= 8) throw new Error('LOCAL_BUSY');
      pending++; entered = true;
      const handler = handlers.get(method as BridgeMethod);
      if (!handler) throw new Error('CONFIRMATION_REQUIRED');
      const result = await handler(request);
      void services.log?.write({ ...resultLogMetadata(result), action: method, requestId: request.callId, durationMs:performance.now()-startedAt }).catch(() => undefined);
      const response = { ...envelope, selectionEpoch: context?.selectionEpoch ?? 0, archiveHandle: context?.archiveHandle ?? null, storeId: context?.storeId ?? null, result };
      if ((DISCOVERY_BRIDGE_METHODS as readonly string[]).includes(method) && Buffer.byteLength(JSON.stringify(response)) > 32768) throw new Error('CLIENT_OUTPUT_LIMIT');
      return response;
    } catch (error) {
      if(authorized&&envelope.callId)void services.log?.write({code:safeError(error instanceof Error?error.message:'CLIENT_PROTOCOL_ERROR').code,requestId:envelope.callId,durationMs:performance.now()-startedAt}).catch(()=>undefined);
      return { ...envelope, ...(authorized ? { selectionEpoch: context?.selectionEpoch ?? 0, archiveHandle: context?.archiveHandle ?? null, storeId: context?.storeId ?? null } : {}), error: safeError(error instanceof Error ? error.message : 'CLIENT_PROTOCOL_ERROR') };
    } finally { if (entered) pending--; }
  });
  window.once('closed', () => ipcMain.removeHandler(CHANNEL));
  return router;
}
export type BridgeRouter = ReturnType<typeof installBridge>;
