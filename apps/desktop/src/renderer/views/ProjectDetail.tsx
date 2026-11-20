import type {WorkspaceSource} from './Workspaces.tsx';
import { useCallback, useEffect, useState } from 'react';
import { RemoveProjectDialog } from '../components/RemoveProjectDialog.tsx';
import { EditProject } from './EditProject.tsx';
import type { Project } from '../state/project-view.ts';
export { dateLabel, flagLabel } from '../format.ts';
import { dateLabel } from '../format.ts';
import { ProjectObservation } from '../components/ProjectObservation.tsx';
import {FeaturePlanning} from './FeaturePlanning.tsx';
import { Discovery } from './Discovery.tsx';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
export function ProjectDetail({ project, loading, desktop, live, onUpdated, onRemoved,onWorkspace }: { project: Project | null; loading: boolean; desktop: Desktop; live: boolean; onUpdated(id: string): Promise<void>; onRemoved(id: string): Promise<void>;onWorkspace(source:WorkspaceSource):void }) {
  const [editing, setEditing] = useState(false);
  const [discovery, setDiscovery] = useState(false);
  const [features,setFeatures]=useState(false);
  const [editor, setEditor] = useState(0), [verification, setVerification] = useState(0);
  const [eligibility, setEligibility] = useState<{projectId: string; eligible: boolean; reason: string} | null>(null);
  const { invoke } = desktop;
  const refreshEligibility = useCallback(() => setVerification(value => value + 1), []);
  useEffect(() => { setEditing(false); setDiscovery(false); setFeatures(false); }, [project?.projectId]);
  useEffect(() => {
    const projectId = project?.projectId;
    setEligibility(null);
    if (!projectId || !live) return;
    let alive = true;
    async function check() {
      const first = await invoke('getDiscoveryEligibility', {projectId}) as PublicResult | null;
      let response = first;
      const checkId = first?.data.checkId;
      for (let attempt = 0; alive && response?.data.reason === 'CHECKING' && typeof checkId === 'string' && attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (alive) response = await invoke('getDiscoveryEligibility', {projectId, checkId}) as PublicResult | null;
      }
      if (!alive) return;
      if (response?.result !== 'OK' || response.data.projectId !== projectId) {
        setEligibility({projectId: projectId!, reason: 'UNKNOWN', eligible: false});
        return;
      }
      setEligibility({projectId: projectId!, reason: String(response.data.reason),
        eligible: response.liveness === 'LIVE_VERIFIED' && response.data.freshness === 'CURRENT' && response.data.eligible === true});
    }
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [project, live, invoke, verification]);
  if (loading) return <div className="detail-empty" role="status">Caricamento dettaglio…</div>;
  if (!project) return <div className="detail-empty"><p>Seleziona un progetto<br />per consultarne i dettagli.</p></div>;
  const states: Record<string, string> = { UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione', INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare' };
  const canCreate = live && eligibility?.projectId === project.projectId && eligibility.eligible;
  const next = !live ? 'Apri il repository per riattivare il servizio prima di creare una feature.'
    : eligibility?.reason === 'APPROVAL_STALE' ? 'Aggiorna e approva l’analisi della codebase.'
    : eligibility?.reason === 'APPROVAL_REQUIRED' ? 'Completa e approva l’analisi della codebase.'
    : 'Verifica lo stato dell’analisi prima di creare una feature.';
  return <article className="detail" aria-label={`Dettaglio ${project.displayName}`}>
    <h3>{project.displayName}</h3><p className="mono muted">{project.projectId}</p>
    <div className="row-actions detail-actions">
      <button className={`button ${canCreate ? 'subtle' : 'primary'}`} aria-expanded={discovery} onClick={() => { setDiscovery(value => !value); setFeatures(false); }}>Analizza codebase</button>
      <button className={`button ${canCreate ? 'primary' : 'subtle'}`} disabled={!canCreate} aria-describedby={canCreate ? undefined : 'feature-next-step'}
        onClick={() => { setEditor(value => value + 1); setFeatures(true); setDiscovery(false); }}>Nuova feature</button>
      <button className="button subtle" aria-expanded={features} onClick={() => { setFeatures(value => !value); setDiscovery(false); }}>Feature</button>
    </div>
    {!canCreate && <p className="hint" id="feature-next-step">{next} {live && <button className="text-button" onClick={refreshEligibility}>Verifica contesto</button>}</p>}
    <dl><dt>Checkout di riferimento</dt><dd className="mono">{project.referenceCheckout}</dd><dt>Branch base configurato</dt><dd>{project.baseBranch ?? 'Non configurato'} <span className="muted">· {states[project.baseState] ?? 'Non verificata'}</span></dd><dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd><dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
    <div className="row-actions detail-actions"><button className="button subtle" disabled={!live} onClick={() => setEditing(v => !v)}>Modifica progetto</button><RemoveProjectDialog project={project} desktop={desktop} live={live} onRemoved={onRemoved} /></div>
    {editing && <EditProject key={project.projectId} project={project} desktop={desktop} live={live} onUpdated={onUpdated} onClose={() => setEditing(false)} />}
    {features&&<FeaturePlanning key={`${desktop.context?.selectionEpoch}:${project.projectId}:${project.configRevision}:${editor}`} project={project} desktop={desktop} live={live} canCreate={canCreate} onWorkspace={onWorkspace}/>}
    {discovery ? <Discovery key={`${desktop.context?.selectionEpoch}:${project.projectId}:${project.configRevision}`} project={project} desktop={desktop} live={live} onApproved={refreshEligibility} />
      : !features && <ProjectObservation project={project} desktop={desktop} live={live} onUpdated={onUpdated} />}
  </article>;
}
