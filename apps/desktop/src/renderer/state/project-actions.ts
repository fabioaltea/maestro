import { useRef, useState } from 'react';
import type { Desktop } from './desktop.ts';
import type { Params, PublicResult } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
import type { PreparedAction } from '../components/ConfirmationDialog.tsx';
export function operationProjectId(result: PublicResult): string | null {
  if (typeof result.data.projectId === 'string') return result.data.projectId;
  const operation = result.data.operation ? record(result.data.operation) : null;
  const value = operation?.result ? record(operation.result) : null;
  return typeof value?.projectId === 'string' ? value.projectId : null;
}
export function useProjectAction(desktop: Desktop, onSuccess: (result: PublicResult) => void | Promise<void>) {
  const [prepared, setPrepared] = useState<PreparedAction | null>(null), [busy, setBusy] = useState(false), [last, setLast] = useState<PublicResult | null>(null);
  const working = useRef(false);
  async function execute(approval: PreparedAction) {
    const value = await desktop.invoke('confirmAction', { confirmationId: approval.confirmationId });
    setPrepared(null);
    if (!value) return;
    const result = record(value).result as PublicResult; setLast(result);
    if (result.outcome === 'SUCCEEDED') await onSuccess(result);
  }
  async function prepare(action: string, params: Params, immediate = false) {
    if (working.current) return; working.current = true; setBusy(true); setLast(null); desktop.setNotice(null);
    try {
      const value = await desktop.invoke('prepareAction', { action, params });
      if (value) { const approval = value as PreparedAction; if (immediate) await execute(approval); else setPrepared(approval); }
    } finally { working.current = false; setBusy(false); }
  }
  async function confirm() {
    if (working.current || !prepared) return; working.current = true; setBusy(true);
    try { await execute(prepared); } finally { working.current = false; setBusy(false); }
  }
  async function cancel() { if (prepared) await desktop.invoke('cancelAction', { confirmationId: prepared.confirmationId }); setPrepared(null); }
  return { prepared, busy, last, prepare, confirm, cancel };
}
