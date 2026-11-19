import type {WorkspaceSource} from './Workspaces.tsx';
import { useEffect, useState } from 'react';
import { RemoveProjectDialog } from '../components/RemoveProjectDialog.tsx';
import { EditProject } from './EditProject.tsx';
import type { Project } from '../state/project-view.ts';
export { dateLabel, flagLabel } from '../format.ts';
import { dateLabel } from '../format.ts';
import { ProjectObservation } from '../components/ProjectObservation.tsx';
import {FeaturePlanning} from './FeaturePlanning.tsx';
import { Discovery } from './Discovery.tsx';
import type { Desktop } from '../state/desktop.ts';
export function ProjectDetail({ project, loading, desktop, live, onUpdated, onRemoved,onWorkspace }: { project: Project | null; loading: boolean; desktop: Desktop; live: boolean; onUpdated(id: string): Promise<void>; onRemoved(id: string): Promise<void>;onWorkspace(source:WorkspaceSource):void }) {
  const [editing, setEditing] = useState(false);
  const [discovery, setDiscovery] = useState(false);
  const [features,setFeatures]=useState(false);
  useEffect(() => { setEditing(false); setDiscovery(false); setFeatures(false); }, [project?.projectId]);
  if (loading) return <div className="detail-empty" role="status">Caricamento dettaglio…</div>;
  if (!project) return <div className="detail-empty"><p>Seleziona un progetto<br />per consultarne i dettagli.</p></div>;
  const states: Record<string, string> = { UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione', INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare' };
  return <article className="detail" aria-label={`Dettaglio ${project.displayName}`}>
    <h3>{project.displayName}</h3><p className="mono muted">{project.projectId}</p>
    <dl><dt>Checkout di riferimento</dt><dd className="mono">{project.referenceCheckout}</dd><dt>Branch base configurato</dt><dd>{project.baseBranch ?? 'Non configurato'} <span className="muted">· {states[project.baseState] ?? 'Non verificata'}</span></dd><dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd><dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
    <div className="row-actions detail-actions"><button className="button subtle" disabled={!live} onClick={() => setEditing(v => !v)}>Modifica progetto</button><RemoveProjectDialog project={project} desktop={desktop} live={live} onRemoved={onRemoved} /></div>
    {editing && <EditProject key={project.projectId} project={project} desktop={desktop} live={live} onUpdated={onUpdated} onClose={() => setEditing(false)} />}
    <div className="row-actions detail-actions"><button className="button subtle" aria-expanded={discovery} onClick={() => setDiscovery(value => !value)}>Discovery</button></div>
    <button className="button subtle" aria-expanded={features} onClick={()=>setFeatures(v=>!v)}>Feature</button>
    {features&&<FeaturePlanning key={`${desktop.context?.selectionEpoch}:${project.projectId}:${project.configRevision}`} project={project} desktop={desktop} live={live} onWorkspace={onWorkspace}/>}
    {discovery ? <Discovery key={`${desktop.context?.selectionEpoch}:${project.projectId}:${project.configRevision}`} project={project} desktop={desktop} live={live} /> : <ProjectObservation project={project} desktop={desktop} live={live} onUpdated={onUpdated} />}
  </article>;
}
