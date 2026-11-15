import type { Project } from '../state/project-view.ts';
import { record } from '../../shared/validation.ts';
export function dateLabel(value: unknown) {
  if (typeof value !== 'string') return 'Non disponibile';
  const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Non disponibile' : date.toLocaleString('it-IT');
}
export function flagLabel(value: unknown) { return value === true ? 'Sì' : value === false ? 'No' : 'Non verificato'; }
export function ProjectDetail({ project, loading }: { project: Project | null; loading: boolean }) {
  if (loading) return <div className="detail-empty" role="status">Caricamento dettaglio…</div>;
  if (!project) return <div className="detail-empty"><p>Seleziona un progetto<br />per consultarne i dettagli.</p></div>;
  const o = project.observation;
  const states: Record<string, string> = { UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione', INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare' };
  const error = o?.error ? record(o.error) : null;
  return <article className="detail" aria-label={`Dettaglio ${project.displayName}`}>
    <h3>{project.displayName}</h3><p className="mono muted">{project.projectId}</p>
    <dl><dt>Checkout di riferimento</dt><dd className="mono">{project.referenceCheckout}</dd><dt>Branch base configurato</dt><dd>{project.baseBranch ?? 'Non configurato'} <span className="muted">· {states[project.baseState] ?? 'Non verificata'}</span></dd><dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd><dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
    <section className="observation"><h4>Ultima verifica del repository</h4>{!o ? <p className="muted">Nessuna osservazione salvata.</p> : <>
      <p className="muted">{dateLabel(o.completedAt)} · Ultimo stato noto</p>
      {o.observedConfigRevision !== project.configRevision && <p className="hint">La verifica riguarda una configurazione precedente.</p>}
      <dl><dt>Checkout</dt><dd>{o.checkoutAvailability === 'VERIFIED' ? 'Disponibile all’ultima verifica' : o.checkoutAvailability === 'UNAVAILABLE' ? 'Non disponibile all’ultima verifica' : 'Disponibilità non verificata'}</dd><dt>Identità repository</dt><dd>{o.repositoryIdentityStatus === 'VERIFIED' ? 'Verificata' : o.repositoryIdentityStatus === 'CHANGED' ? 'Cambiata: richiede attenzione' : 'Non verificata'}</dd><dt>Branch osservato</dt><dd>{typeof o.currentBranch === 'string' ? o.currentBranch : o.headKind === 'DETACHED' ? 'HEAD detached' : o.headKind === 'UNBORN' ? 'Nessun commit' : 'Non verificato'}</dd></dl>
      <div className="flag-list"><span className="flag">Modifiche: {flagLabel(o.trackedChanges)}</span><span className="flag">Non tracciati: {flagLabel(o.untrackedChanges)}</span><span className="flag">Conflitti: {flagLabel(o.conflicts)}</span></div>
      <p className="hint">Stato del solo checkout di riferimento. Il contenuto dei submodule non è ispezionato.</p>
      {error && <p role="status" className="hint">{String(error.message)} {String(error.nextAction)}</p>}
    </>}</section>
  </article>;
}
