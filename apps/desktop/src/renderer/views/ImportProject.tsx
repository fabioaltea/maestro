import { useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import { useProjectAction, operationProjectId, projectMutationEffect } from '../state/project-actions.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import { record, projectName, localBranchInput } from '../../shared/validation.ts';
interface ChosenRepository { repositoryHandle: string; displayPath: string }
export function ImportProject({ desktop, live, onImported, onClose }: { desktop: Desktop; live: boolean; onImported(id: string, existing: boolean): Promise<void>; onClose(): void }) {
  const [repository, setRepository] = useState<ChosenRepository | null>(null), [name, setName] = useState(''), [base, setBase] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null), [choosing, setChoosing] = useState(false);
  const action = useProjectAction(desktop, async result => { const id = operationProjectId(result); if (id) await onImported(id, projectMutationEffect(result).type === 'existing'); });
  async function choose() { setChoosing(true); try { const value = await desktop.invoke('chooseRepository'); if (value && record(value).repository) setRepository(record(value).repository as unknown as ChosenRepository); } finally { setChoosing(false); } }
  async function submit() {
    setFieldError(null);
    try { if (name.trim()) projectName(name); if (base) localBranchInput(base); }
    catch { setFieldError('Controlla nome e branch base: nome entro 120 caratteri, branch locale senza spazi o espressioni Git.'); return; }
    if (!repository || !live) return;
    await action.prepare('project.register', { repositoryHandle: repository.repositoryHandle, ...(name.trim() ? { name } : {}), ...(base ? { baseBranch: base } : {}) });
  }
  return <section className="project-form" aria-labelledby="import-title"><div className="section-heading"><div><h3 id="import-title">Importa un progetto locale</h3><p className="muted">Registra un repository esistente. Nessun file viene copiato o modificato.</p></div><button className="text-button" disabled={action.busy} onClick={onClose}>Torna ai progetti</button></div>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><label>Repository locale</label><button className="button subtle" type="button" disabled={choosing || action.busy} onClick={() => void choose()}>Scegli repository</button><p className="mono hint">{repository?.displayPath ?? 'Nessun repository selezionato'}</p>
      <label htmlFor="import-name">Nome progetto (facoltativo)</label><input id="import-name" value={name} maxLength={240} aria-invalid={fieldError !== null} aria-describedby="import-error" onChange={e => setName(e.target.value)} placeholder="Usa il nome del repository" />
      <label htmlFor="import-base">Branch base locale (facoltativo)</label><input id="import-base" value={base} maxLength={1024} aria-invalid={fieldError !== null} aria-describedby="import-error" onChange={e => setBase(e.target.value)} placeholder="es. main" /><p className="hint">Lascia vuoto per non configurare un branch base. Non viene creato né cambiato alcun branch.</p>
      {fieldError && <p id="import-error" className="field-error" role="alert">{fieldError}</p>}
      {!live && <p className="hint">Avvia il servizio per importare. Nessuna richiesta viene accodata offline.</p>}
      {action.last && <div className="operation-result" role="status"><p>{action.last.result === 'UNKNOWN_OUTCOME' ? 'Esito da verificare nelle operazioni.' : action.last.error?.message ?? 'Operazione non riuscita.'}</p><p className="mono">{action.last.requestId}</p></div>}
      <div className="row-actions form-actions"><button className="button primary" disabled={!repository || !live || choosing || action.busy}>Rivedi importazione</button><button className="button subtle" type="button" disabled={action.busy} onClick={onClose}>Annulla</button></div>
    </form>{action.prepared && <ConfirmationDialog prepared={action.prepared} busy={action.busy} onConfirm={() => void action.confirm()} onCancel={() => void action.cancel()} />}
  </section>;
}
