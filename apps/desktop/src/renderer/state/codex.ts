import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexAccountStatus } from '../../shared/codex-contract.ts';
import type { BridgeMethod } from '../../shared/bridge-contract.ts';

export function useCodexAccount(invoke: (method: BridgeMethod) => Promise<unknown>, ready: boolean) {
  const [account, setAccount] = useState<CodexAccountStatus | null>(null);
  const [pending, setPending] = useState<'status' | 'login' | null>(null);
  const inFlight = useRef(false);
  const run = useCallback(async (action: 'status' | 'login') => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(action);
    try {
      const result = await invoke(action === 'status' ? 'codexStatus' : 'codexLogin');
      setAccount((result as CodexAccountStatus | null) ?? { state: 'UNAVAILABLE', binary: null, version: null });
    } finally {
      inFlight.current = false;
      setPending(null);
    }
  }, [invoke]);
  const refresh = useCallback(() => run('status'), [run]);
  useEffect(() => { if (ready) void refresh(); }, [ready, refresh]);
  return { account, pending, refresh, login: () => run('login'), cancel: () => invoke('cancelCodexLogin') };
}
