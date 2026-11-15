import type { Project } from '../state/project-view.ts';
export { dateLabel, flagLabel } from '../format.ts';
import { dateLabel } from '../format.ts';
import { ProjectObservation } from '../components/ProjectObservation.tsx';
import type { Desktop } from '../state/desktop.ts';
export function ProjectDetail({ project, loading, desktop, live, onUpdated }: { project: Project | null; loading: boolean; desktop: Desktop; live: boolean; onUpdated(id: string): Promise<void> }) {
  if (loading) return <div className="detail-empty" role="status">Caricamento dettaglio…</div>;
  if (!project) return <div className="detail-empty"><p>Seleziona un progetto<br />per consultarne i dettagli.</p></div>;
  const states: Record<string, string> = { UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione', INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare' };
  return <article className="detail" aria-label={`Dettaglio ${project.displayName}`}>
    <h3>{project.displayName}</h3><p className="mono muted">{project.projectId}</p>
    <dl><dt>Checkout di riferimento</dt><dd className="mono">{project.referenceCheckout}</dd><dt>Branch base configurato</dt><dd>{project.baseBranch ?? 'Non configurato'} <span className="muted">· {states[project.baseState] ?? 'Non verificata'}</span></dd><dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd><dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
    <ProjectObservation project={project} desktop={desktop} live={live} onUpdated={onUpdated} />
  </article>;
}
