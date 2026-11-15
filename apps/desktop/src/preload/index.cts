import { contextBridge, ipcRenderer } from 'electron';
import { METHODS, CHANNEL, ACTIVITY_CHANNEL } from '../shared/bridge-contract.ts';
import type { DesktopApi, BridgeRequest, BridgeResponse, ActivityMessage } from '../shared/bridge-contract.ts';
import { safeError, validateRequest } from '../shared/validation.ts';
const api: Record<string, unknown> = {};
for (const method of METHODS) {
  api[method] = async (input: BridgeRequest): Promise<BridgeResponse> => {
    try { validateRequest(method, input); return await ipcRenderer.invoke(CHANNEL, method, input) as BridgeResponse; }
    catch { return { bridgeVersion: 1, callId: typeof input?.callId === 'string' ? input.callId : '', selectionEpoch: Number.isSafeInteger(input?.selectionEpoch) ? input.selectionEpoch : 0, archiveHandle: null, storeId: null, result: null, error: safeError('INVALID_INPUT') }; }
  };
}
api.onActivity = (callback: (message: ActivityMessage) => void) => {
  const listener = (_event: unknown, message: ActivityMessage) => callback(message);
  ipcRenderer.on(ACTIVITY_CHANNEL, listener);
  return () => ipcRenderer.removeListener(ACTIVITY_CHANNEL, listener);
};
contextBridge.exposeInMainWorld('maestro', Object.freeze(api) as DesktopApi);
