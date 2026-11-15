import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import type { PreparedAction } from '../components/ConfirmationDialog.tsx';
import { record } from '../../shared/validation.ts';
export function DaemonControls({ desktop, onOperations }: { desktop: Desktop; onOperations(): void }) {
  const [status, setStatus] = useState<PublicResult | null>(null), [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedAction | null>(null), [result, setResult] = useState<PublicResult | null>(null);
  const { core, invoke, context } = desktop;
  async function refresh() { const value = await core('status'); if (value) setStatus(value); }
  useEffect(() => { setStatus(null); setPrepared(null); setResult(null); if (context) void refresh(); }, [context?.selectionEpoch, core]);
  useEffect(() => {
    if (!context) return;
    let reading = false;
    const timer = setInterval(() => { if (reading || document.visibilityState !== 'visible') return; reading = true; void core('status').then(value => { if (value) setStatus(value); }).finally(() => { reading = false; }); }, 5000);
    return () => clearInterval(timer);
  }, [context?.selectionEpoch, core]);
  async function prepare(action: string) {
    setBusy(true); desktop.setNotice(null);
    try { const value = await invoke('prepareAction', { action: `daemon.${action}`, params: {} }); if (value) setPrepared(value as PreparedAction); }
    finally { setBusy(false); }
  }
  async function confirm() {
    if (!prepared) return;
    setBusy(true);
    try {
      const value = await invoke('confirmAction', { confirmationId: prepared.confirmationId });
      if (value) setResult(record(value).result as PublicResult);
      setPrepared(null); await refresh();
    } finally { setBusy(false); }
  }
  async function cancel() { if (prepared) await invoke('cancelAction', { confirmationId: prepared.confirmationId }); setPrepared(null); }
  if (!context) return <section className="empty-state"><h3>Scegli un archivio</h3><p>Il servizio viene avviato soltanto con un’azione esplicita sull’archivio selezionato.</p></section>;
  const live = status?.liveness === 'LIVE_VERIFIED', absent = status?.liveness === 'ABSENT_VERIFIED' && status.result === 'OK';
  const labels: Record<string, string> = { RUNNING: 'Attivo', STOPPED: 'Fermo', STARTING: 'In avvio', RECOVERING: 'Recupero dello stato', STOPPING: 'In arresto', BLOCKED: 'Bloccato: verifica la diagnostica' };
  return <section className="service-view" aria-label="Controllo servizio">
    <div className="section-heading"><div><h3>Servizio locale</h3><p className="muted">Il core continua a funzionare quando chiudi Maestro.</p></div><button className="button subtle" disabled={busy} onClick={() => void refresh()}>Aggiorna stato</button></div>
    <div className="service-state"><span className="eyebrow">Stato verificato</span><p>{status ? live ? labels[String(status.data.lifecycle)] ?? 'Attivo' : absent ? 'Fermo' : 'Non verificato' : 'Lettura dello stato…'}</p><span className="hint">{status?.freshness === 'LAST_KNOWN' ? 'Ultimo stato persistito; l’assenza del servizio è verificata separatamente.' : 'Connessione locale al servizio.'}</span></div>
    <div className="row-actions"><button className="button primary" disabled={busy || !absent} onClick={() => void prepare('start')}>Avvia servizio</button><button className="button" disabled={busy || !live} onClick={() => void prepare('restart')}>Riavvia servizio</button><button className="button" disabled={busy || !live} onClick={() => void prepare('stop')}>Arresta servizio</button></div>
    <p className="hint">Arresto e riavvio seguono i controlli di sicurezza del core. Chiudere questa finestra non equivale ad arrestare il servizio.</p>
    {result && <div className="operation-result" role="status"><h4>{result.result === 'UNKNOWN_OUTCOME' ? 'Esito da verificare' : result.outcome === 'SUCCEEDED' ? 'Operazione completata' : result.outcome === 'IN_PROGRESS' ? 'Operazione in corso' : result.outcome === 'BLOCKED' ? 'Operazione bloccata' : 'Operazione non riuscita'}</h4><p>{result.error?.message}</p><p className="mono">{result.requestId}</p><button className="text-button" onClick={onOperations}>Consulta operazioni ed esiti</button></div>}
    {prepared && <ConfirmationDialog prepared={prepared} busy={busy} onConfirm={() => void confirm()} onCancel={() => void cancel()} />}
  </section>;
}
