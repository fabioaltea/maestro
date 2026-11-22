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
export function projectMutationEffect(result: PublicResult): { type: 'created' | 'existing' | 'updated' | 'observed' | 'removed' | 'unchanged' | 'unknown' | 'none'; projectId: string | null } {
  const projectId = operationProjectId(result);
  if (result.result === 'UNKNOWN_OUTCOME' || result.outcome === null) return { type: 'unknown', projectId };
  if (result.result !== 'OK' || result.outcome !== 'SUCCEEDED') return { type: 'none', projectId };
  const operation = result.data.operation ? record(result.data.operation) : null;
  const data = operation?.result ? record(operation.result) : result.data;
  const types = { CREATED: 'created', EXISTING: 'existing', UPDATED: 'updated', OBSERVED: 'observed', REMOVED: 'removed', NONE: 'unchanged' } as const;
  const effect = String(data.effect);
  return { type: Object.hasOwn(types, effect) ? types[effect as keyof typeof types] : 'none', projectId };
}
export function useProjectAction(desktop: Desktop, onSuccess: (result: PublicResult) => void | Promise<void>) {
  const [prepared, setPrepared] = useState<PreparedAction | null>(null), [busy, setBusy] = useState(false), [last, setLast] = useState<PublicResult | null>(null);
  const working = useRef(false),trigger=useRef<HTMLElement|null>(null);
  async function execute(approval: PreparedAction) {
    const value = await desktop.invoke('confirmAction', { confirmationId: approval.confirmationId });
    setPrepared(null);
    if (!value) return;
    const result = record(value).result as PublicResult; setLast(result);
    const effect = projectMutationEffect(result);
    if (effect.type !== 'unknown' && effect.type !== 'none') await onSuccess(result);
  }
  async function prepare(action: string, params: Params, immediate = false) {
    if (working.current) return;trigger.current=document.activeElement as HTMLElement|null; working.current = true; setBusy(true); setLast(null); desktop.setNotice(null);
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
  return { prepared, busy, last, prepare, confirm, cancel, returnFocus:()=>trigger.current };
}
