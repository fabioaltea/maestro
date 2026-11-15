import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import type { Params } from '../../shared/bridge-contract.ts';
import { useProjectAction } from '../state/project-actions.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import { projectName, localBranchInput } from '../../shared/validation.ts';
export function EditProject({ desktop, project, live, onUpdated, onClose }: { desktop: Desktop; project: Project; live: boolean; onUpdated(id: string): Promise<void>; onClose(): void }) {
  const [name, setName] = useState(project.displayName), [mode, setMode] = useState('keep'), [base, setBase] = useState(project.baseBranch ?? ''), [error, setError] = useState<string | null>(null);
  const action = useProjectAction(desktop, async () => { await onUpdated(project.projectId); onClose(); });
  useEffect(() => { setName(project.displayName); setBase(project.baseBranch ?? ''); setMode('keep'); setError(null); }, [project.configRevision]);
  async function submit() {
    setError(null);
    try { projectName(name); if (mode === 'set') localBranchInput(base); }
    catch { setError('Controlla il nome e il branch base locale prima di rivedere la modifica.'); return; }
    const patch: Params = { ...(name !== project.displayName ? { name } : {}), ...(mode === 'clear' ? { baseBranch: null } : mode === 'set' ? { baseBranch: base } : {}) };
    if (!Object.keys(patch).length) { setError('Nessuna modifica da applicare.'); return; }
    await action.prepare('project.update', { projectId: project.projectId, expectedRevision: project.configRevision, patch });
  }
  return <section className="edit-project" aria-labelledby="edit-title"><h4 id="edit-title">Modifica configurazione</h4><p className="hint">Revisione da approvare: {project.configRevision}</p>
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><label htmlFor="edit-name">Nome progetto</label><input id="edit-name" value={name} maxLength={240} aria-invalid={error !== null} aria-describedby="edit-error" onChange={e => setName(e.target.value)} />
      <label htmlFor="base-intent">Configurazione branch base</label><select id="base-intent" value={mode} onChange={e => setMode(e.target.value)}><option value="keep">Mantieni invariata</option><option value="set">Imposta branch locale</option><option value="clear">Cancella configurazione</option></select>
      {mode === 'set' && <><label htmlFor="edit-base">Nuovo branch base locale</label><input id="edit-base" value={base} maxLength={1024} required aria-invalid={error !== null} aria-describedby="edit-error" onChange={e => setBase(e.target.value)} /></>}
      {error && <p id="edit-error" className="field-error" role="alert">{error}</p>}
      {action.last?.error && <p role="status" className="field-error">{action.last.error.message}</p>}
      <div className="row-actions form-actions"><button className="button primary" disabled={!live || action.busy}>Rivedi modifica</button><button type="button" className="button subtle" disabled={action.busy} onClick={() => void onUpdated(project.projectId)}>Ricarica configurazione</button><button type="button" className="text-button" disabled={action.busy} onClick={onClose}>Annulla modifica</button></div>
    </form>{action.prepared && <ConfirmationDialog prepared={action.prepared} busy={action.busy} onConfirm={() => void action.confirm()} onCancel={() => void action.cancel()} />}
  </section>;
}
