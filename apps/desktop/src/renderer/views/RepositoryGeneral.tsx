import { useState } from 'react';
import { ProjectObservation } from '../components/ProjectObservation.tsx';
import { RemoveProjectDialog } from '../components/RemoveProjectDialog.tsx';
import { baseStateLabel, dateLabel } from '../format.ts';
import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import { EditProject } from './EditProject.tsx';

export function RepositoryGeneral({ project, desktop, live, onUpdated, onRemoved }: {
  project: Project; desktop: Desktop; live: boolean;
  onUpdated(id: string): Promise<void>; onRemoved(): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return <article className="detail repository-general" aria-label={`Impostazioni di ${project.displayName}`}>
    <h4>{project.displayName}</h4>
    <p className="mono muted">{project.referenceCheckout}</p>
    {!live && <p className="hint">Ultimo stato noto · servizio fermo</p>}
    <dl>
      <dt>Branch base</dt><dd>{project.baseBranch ?? 'Non configurato'}</dd>
      <dt>Stato del branch base</dt><dd>{baseStateLabel(project.baseState)}</dd>
    </dl>
    <button className="button subtle" disabled={!live} aria-expanded={editing} onClick={() => setEditing(value => !value)}>Modifica progetto</button>
    {editing && <EditProject project={project} desktop={desktop} live={live} onUpdated={onUpdated} onClose={() => setEditing(false)} />}
    <ProjectObservation project={project} desktop={desktop} live={live} onUpdated={onUpdated} />
    <details>
      <summary>Metadati del registro</summary>
      <dl><dt>ID progetto</dt><dd className="mono">{project.projectId}</dd>
        <dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd>
        <dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
    </details>
    <div className="detail-actions">
      <RemoveProjectDialog project={project} desktop={desktop} live={live} onRemoved={onRemoved} />
    </div>
  </article>;
}
