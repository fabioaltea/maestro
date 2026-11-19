import { useCallback, useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import { record } from '../../shared/validation.ts';
import { dateLabel } from './ProjectDetail.tsx';
interface ReceiptView { requestId: string; namespace: string; action: string; currentArchive: boolean; phase: string; outcome: string | null; errorCode: string | null; createdAt: string }
export function Operations({ desktop }: { desktop: Desktop }) {
  const [receipts, setReceipts] = useState<ReceiptView[]>([]), [loading, setLoading] = useState(false), [pending, setPending] = useState<string | null>(null);
  const { invoke } = desktop;
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const value = await invoke('listReceipts'); if (value) setReceipts(record(value).receipts as ReceiptView[]); }
    finally { setLoading(false); }
  }, [invoke]);
  useEffect(() => { void refresh(); }, [refresh, desktop.context?.selectionEpoch]);
  async function action(method: 'reconcileOperation' | 'dismissReceipt' | 'selectReceiptArchive', id: string) {
    setPending(id);
    try { await invoke(method, { receiptId: id }); await refresh(); } finally { setPending(null); }
  }
  const labels: Record<string, string> = { start: 'Avvio servizio', stop: 'Arresto servizio', restart: 'Riavvio servizio', register: 'Importazione progetto', verify: 'Verifica repository', update: 'Modifica configurazione', remove: 'Rimozione dal registro' };
  const outcomes: Record<string, string> = { SUCCEEDED: 'Completata', FAILED: 'Non riuscita', BLOCKED: 'Bloccata', INTERRUPTED: 'Interrotta', IN_PROGRESS: 'In corso' };
  const discoveryLabels: Record<string, string> = { start: 'Avvio Discovery', configure: 'Configurazione provider', check: 'Verifica provider', preview: 'Anteprima Discovery', discard: 'Scarto anteprima', answer: 'Risposta e continuazione', cancel: 'Annullamento Discovery' };
  const workspaceLabels:Record<string,string>={create:'Creazione workspace',refresh:'Osservazione workspace',remove:'Rimozione workspace'};
  return <section aria-label="Operazioni locali"><div className="section-heading"><div><h3>Operazioni ed esiti</h3><p className="muted">Identità conservate per ritrovare l’esito originale, anche dopo una riapertura.</p></div><button className="button subtle" disabled={loading} onClick={() => void refresh()}>Aggiorna operazioni</button></div>
    {loading && <p role="status" className="hint">Lettura operazioni…</p>}
    {!loading && !receipts.length && <div className="empty-state"><h3>Nessuna operazione conservata</h3><p>Le richieste inviate da questa app compaiono qui. Non sono una coda di comandi da rieseguire.</p></div>}
    <div className="receipt-list">{receipts.map(receipt => <article className="receipt-row" key={receipt.requestId}><div className="section-heading"><h4>{(receipt.namespace==='workspace'?workspaceLabels:receipt.namespace === 'discovery' ? discoveryLabels : labels)[receipt.action] ?? 'Operazione locale'}</h4><span className="badge">{receipt.phase === 'UNKNOWN' || receipt.phase === 'PREPARED' ? 'Esito da verificare' : outcomes[receipt.outcome ?? ''] ?? 'Da verificare'}</span></div><p className="mono">{receipt.requestId}</p><p className="hint">{dateLabel(receipt.createdAt)} · {receipt.currentArchive ? 'Archivio selezionato' : 'Altro archivio'}</p>{receipt.errorCode && <p className="hint">{receipt.errorCode}</p>}
      {receipt.phase !== 'TERMINAL' && <p className="hint">Nessun reinvio automatico. Un’operazione non trovata non dimostra che il comando non sia stato inviato.</p>}
      <div className="row-actions">{receipt.phase !== 'TERMINAL' && <button className="button" disabled={pending !== null} onClick={() => void action('reconcileOperation', receipt.requestId)}>Aggiorna esito</button>}{!receipt.currentArchive && <button className="button subtle" disabled={pending !== null} onClick={() => void action('selectReceiptArchive', receipt.requestId)}>Apri archivio dell’operazione</button>}{receipt.phase === 'TERMINAL' && <button className="text-button" disabled={pending !== null} onClick={() => void action('dismissReceipt', receipt.requestId)}>Rimuovi ricevuta conclusa</button>}</div>
    </article>)}</div>
  </section>;
}
