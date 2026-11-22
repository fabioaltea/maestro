import { useEffect, useRef } from 'react';
export interface PreparedAction { confirmationId: string; requestId: string; expiresAt: number; action: string; summary: string[] }
export function ConfirmationDialog({ prepared, busy, onConfirm, onCancel, returnFocus }: { prepared: PreparedAction; busy: boolean; onConfirm(): void; onCancel(): void;returnFocus?:()=>HTMLElement|null }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = returnFocus?.() ?? document.activeElement as HTMLElement | null;
    dialog.current?.showModal(); cancel.current?.focus();
    return () => { dialog.current?.close(); queueMicrotask(() => {const target=previous?.isConnected&&!previous.hasAttribute('disabled')?previous:document.querySelector<HTMLElement>('.project-row[aria-current=true], .toolbar>.button, .nav-item[aria-current=page]');target?.focus();}); };
  }, []);
  return <dialog ref={dialog} className="confirmation-dialog" aria-labelledby="confirm-title" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
    <p className="eyebrow">Conferma azione</p><h3 id="confirm-title">Rivedi l’operazione</h3>
    <ul className="summary-list">{prepared.summary.map((line, i) => <li key={i}>{line}</li>)}</ul>
    <p className="hint">Questa conferma vale per il riepilogo mostrato e scade dopo un minuto.</p>
    <div className="row-actions"><button ref={cancel} type="button" className="button subtle" disabled={busy} onClick={onCancel}>Annulla</button><button type="button" className="button primary" disabled={busy} onClick={onConfirm}>{busy ? 'Invio e verifica esito…' : 'Conferma operazione'}</button></div>
  </dialog>;
}
