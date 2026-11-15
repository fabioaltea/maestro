import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArchiveView, BridgeMethod, Params, PublicResult } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
export function useDesktop() {
  const [context, setContext] = useState<ArchiveView | null>(null);
  const current = useRef<ArchiveView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runtimeReady, setRuntimeReady] = useState(false);
  const invoke = useCallback(async (method: BridgeMethod, params: Params = {}): Promise<unknown> => {
    const epoch = current.current?.selectionEpoch ?? 0;
    try {
      const response = await window.maestro[method]({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: epoch, ...params });
      if (method !== 'chooseArchive' && method !== 'context' && ((current.current?.selectionEpoch ?? 0) !== epoch || response.selectionEpoch !== epoch)) return null;
      if (response.error) { setNotice(response.error.message); return null; }
      if (method === 'context' || method === 'chooseArchive') {
        const data = record(response.result), selected = data.context as ArchiveView | null;
        current.current = selected; setContext(selected);
        if (method === 'context') { setRuntimeReady(data.runtimeReady === true); if (data.error) setNotice(String(record(data.error).message)); }
      }
      return response.result;
    } catch { setNotice('Client locale non disponibile. Consulta lo stato prima di riprovare.'); return null; }
  }, []);
  useEffect(() => { void invoke('context'); }, [invoke]);
  const core = useCallback(async (method: BridgeMethod, params: Params = {}): Promise<PublicResult | null> => {
    const value = await invoke(method, params);
    if (!value) return null;
    const result = value as PublicResult;
    if (result.error) setNotice(`${result.error.message} ${result.error.nextAction}`);
    return result;
  }, [invoke]);
  return { context, runtimeReady, notice, setNotice, invoke, core };
}
export type Desktop = ReturnType<typeof useDesktop>;
