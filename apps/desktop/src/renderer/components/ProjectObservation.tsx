import type { Project } from '../state/project-view.ts';
import type { Desktop } from '../state/desktop.ts';
import { record } from '../../shared/validation.ts';
import { useProjectAction } from '../state/project-actions.ts';
import { dateLabel, flagLabel } from '../format.ts';
export function ProjectObservation({ project, desktop, live, onUpdated }: { project: Project; desktop: Desktop; live: boolean; onUpdated(id: string): Promise<void> }) {
  const o = project.observation, error = o?.error ? record(o.error) : null;
  const action = useProjectAction(desktop, async () => { await onUpdated(project.projectId); });
  return <section className="observation"><div className="section-heading"><h4>Ultima verifica del repository</h4><button className="button subtle" disabled={!live || action.busy} onClick={() => void action.prepare('project.verify', { projectId: project.projectId }, true)}>{action.busy ? 'Verifica in corso…' : 'Verifica repository'}</button></div>
    {!o ? <p className="muted">Nessuna osservazione salvata.</p> : <>
      <p className="muted">{dateLabel(o.completedAt)} · Ultimo stato noto</p>
      {o.observedConfigRevision !== project.configRevision && <p className="hint">La verifica riguarda una configurazione precedente.</p>}
      <dl><dt>Checkout</dt><dd>{o.checkoutAvailability === 'VERIFIED' ? 'Disponibile all’ultima verifica' : o.checkoutAvailability === 'UNAVAILABLE' ? 'Non disponibile all’ultima verifica' : 'Disponibilità non verificata'}</dd><dt>Identità repository</dt><dd>{o.repositoryIdentityStatus === 'VERIFIED' ? 'Verificata' : o.repositoryIdentityStatus === 'CHANGED' ? 'Cambiata: richiede attenzione' : 'Non verificata'}</dd><dt>Branch osservato</dt><dd>{typeof o.currentBranch === 'string' ? o.currentBranch : o.headKind === 'DETACHED' ? 'HEAD detached' : o.headKind === 'UNBORN' ? 'Nessun commit' : 'Non verificato'}</dd></dl>
      <div className="flag-list"><span className="flag">Modifiche: {flagLabel(o.trackedChanges)}</span><span className="flag">Non tracciati: {flagLabel(o.untrackedChanges)}</span><span className="flag">Conflitti: {flagLabel(o.conflicts)}</span></div>
      <p className="hint">Stato del solo checkout di riferimento. Il contenuto dei submodule non è ispezionato.</p>
      {error && <p role="status" className="hint">{String(error.message)} {String(error.nextAction)}</p>}
    </>}
    {action.last && <p className="hint" role="status">{action.last.outcome === 'SUCCEEDED' ? 'Osservazione salvata. Disponibilità ed eventuali errori sono riportati sopra.' : action.last.result === 'UNKNOWN_OUTCOME' ? 'Esito da verificare nelle operazioni.' : action.last.error?.message ?? 'Verifica non riuscita.'}</p>}
  </section>;
}
