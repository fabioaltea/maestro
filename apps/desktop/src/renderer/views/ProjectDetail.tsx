import type { WorkspaceSource } from './Workspaces.tsx';
import { useCallback, useEffect, useState } from 'react';
import { RemoveProjectDialog } from '../components/RemoveProjectDialog.tsx';
import { EditProject } from './EditProject.tsx';
import type { Project } from '../state/project-view.ts';
export { dateLabel, flagLabel } from '../format.ts';
import { dateLabel } from '../format.ts';
import { ProjectObservation } from '../components/ProjectObservation.tsx';
import { FeaturePlanning } from './FeaturePlanning.tsx';
import { Discovery } from './Discovery.tsx';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';

const baseStates: Record<string, string> = {
  UNCONFIGURED: 'Non configurata', VALID: 'Verificata nell’ultima osservazione',
  INVALID: 'Non valida nell’ultima osservazione', UNVERIFIED: 'Da verificare',
};

export function ProjectDetail({ project, desktop, live, onUpdated, onRemoved, onWorkspace, discoveryId }: {
  project: Project; desktop: Desktop; live: boolean;
  onUpdated(id: string): Promise<void>; onRemoved(id: string): Promise<void>;
  onWorkspace(source: WorkspaceSource): void; discoveryId?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<'overview' | 'discovery' | 'features'>(discoveryId ? 'discovery' : 'overview');
  const [editor, setEditor] = useState(0), [verification, setVerification] = useState(0);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);
  const { invoke } = desktop;
  const refreshEligibility = useCallback(() => setVerification(value => value + 1), []);
  useEffect(() => {
    const { projectId } = project;
    setEligibility(null);
    if (!live) return;
    let alive = true;
    async function check() {
      let response = await invoke('getDiscoveryEligibility', {projectId}) as PublicResult | null;
      const checkId = response?.data.checkId;
      for (let attempt = 0; alive && response?.data.reason === 'CHECKING' && typeof checkId === 'string' && attempt < 12; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        if (alive) response = await invoke('getDiscoveryEligibility', {projectId, checkId}) as PublicResult | null;
      }
      if (!alive) return;
      if (response?.result !== 'OK' || response.data.projectId !== projectId) {
        setEligibility({reason: 'UNKNOWN', eligible: false});
        return;
      }
      setEligibility({reason: String(response.data.reason),
        eligible: response.liveness === 'LIVE_VERIFIED' && response.data.freshness === 'CURRENT' && response.data.eligible === true});
    }
    void check();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [project, live, invoke, verification]);
  const canCreate = live && eligibility?.eligible === true;
  const next = !live ? 'Apri il repository per riattivare il servizio prima di creare una feature.'
    : eligibility?.reason === 'APPROVAL_STALE' ? 'Aggiorna e approva l’analisi della codebase.'
    : eligibility?.reason === 'APPROVAL_REQUIRED' ? 'Completa e approva l’analisi della codebase.'
    : 'Verifica lo stato dell’analisi prima di creare una feature.';

  return <article className="detail repository-detail" aria-label={`Dettaglio ${project.displayName}`}>
    <header className="repository-heading">
      <div>
        <h3>{project.displayName}</h3>
        <p className="repository-path mono muted">{project.referenceCheckout}</p>
        {!live && <p className="hint">Ultimo stato noto · servizio fermo</p>}
      </div>
      <button className="button primary" disabled={!canCreate} aria-describedby={canCreate ? undefined : 'feature-next-step'}
        onClick={() => { setEditor(value => value + 1); setSection('features'); }}>Nuova feature</button>
    </header>
    <nav className="repository-sections" aria-label="Sezioni repository">
      <button aria-current={section === 'overview' ? 'page' : undefined} onClick={() => setSection('overview')}>Panoramica</button>
      <button aria-current={section === 'discovery' ? 'page' : undefined} onClick={() => setSection('discovery')}>Analizza codebase</button>
      <button aria-current={section === 'features' ? 'page' : undefined} onClick={() => setSection('features')}>Feature</button>
    </nav>
    {!canCreate && <p className="hint repository-next-step" id="feature-next-step">{next} {live && <button className="text-button" onClick={refreshEligibility}>Verifica contesto</button>}</p>}
    {section === 'overview' && <>
      <div className="repository-overview">
        <ProjectObservation project={project} desktop={desktop} live={live} onUpdated={onUpdated} />
        <section className="repository-config" aria-label="Configurazione repository">
          <h4>Configurazione</h4>
          <dl><dt>Branch base</dt><dd>{project.baseBranch ?? 'Non configurato'}</dd>
            <dt>Stato del branch base</dt><dd>{baseStates[project.baseState] ?? 'Non verificata'}</dd></dl>
          <details><summary>Metadati del registro</summary>
            <dl><dt>ID progetto</dt><dd className="mono">{project.projectId}</dd>
              <dt>Revisione configurazione</dt><dd className="mono">{project.configRevision}</dd>
              <dt>Aggiornato</dt><dd>{dateLabel(project.updatedAt)}</dd></dl>
          </details>
          <div className="row-actions detail-actions">
            <button className="button subtle" disabled={!live} aria-expanded={editing} onClick={() => setEditing(value => !value)}>Modifica progetto</button>
            <RemoveProjectDialog project={project} desktop={desktop} live={live} onRemoved={onRemoved} />
          </div>
        </section>
      </div>
      {editing && <EditProject project={project} desktop={desktop} live={live} onUpdated={onUpdated} onClose={() => setEditing(false)} />}
    </>}
    {section === 'features' && <FeaturePlanning key={`${project.configRevision}:${editor}`} project={project} desktop={desktop} live={live} canCreate={canCreate} onWorkspace={onWorkspace} />}
    {section === 'discovery' && <Discovery key={project.configRevision} project={project} desktop={desktop} live={live} onApproved={refreshEligibility}
      {...(discoveryId ? { initialDiscoveryId: discoveryId } : {})} />}
  </article>;
}
