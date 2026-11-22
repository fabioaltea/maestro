import type { WorkspaceSource } from './Workspaces.tsx';
import { useCallback, useEffect, useState } from 'react';
import type { DetailRoute } from '../components/RepositoryNavigation.tsx';
import type { Project } from '../state/project-view.ts';
export { dateLabel, flagLabel } from '../format.ts';
import { baseStateLabel, dateLabel } from '../format.ts';
import { FeaturePlanning, type InterviewExchange } from './FeaturePlanning.tsx';
import { Discovery } from './Discovery.tsx';
import { ProjectAgents } from './ProjectAgents.tsx';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
import type { RepositoryDocuments } from '../../shared/repository-documents.ts';
import { RepositoryReadme } from '../components/RepositoryReadme.tsx';
import { RepositoryHistory } from './RepositoryHistory.tsx';
import { RepositoryCode } from './RepositoryCode.tsx';

export function ProjectDetail({ project, desktop, live, onClose, onWorkspace, route, onNavigate }: {
  project: Project; desktop: Desktop; live: boolean;
  onClose(): Promise<void>;
  onWorkspace(source: WorkspaceSource): void; route: DetailRoute; onNavigate(route: DetailRoute): void;
}) {
  const { section } = route;
  const inFeatures = section === 'features';
  const [verification, setVerification] = useState(0);
  const [documents, setDocuments] = useState<RepositoryDocuments | null>(null);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [eligibility, setEligibility] = useState<{ eligible: boolean; reason: string } | null>(null);
  const [interviews, setInterviews] = useState<Record<string, InterviewExchange[]>>({});
  const { invoke } = desktop;
  useEffect(() => {
    let current = true;
    setDocumentsLoading(true);
    void invoke('getRepositoryDocuments', { projectId: project.projectId }).then(value => {
      if (!current) return;
      const response = value as PublicResult | null;
      setDocuments(response?.result === 'OK' && response.data.projectId === project.projectId && response.data.configRevision === project.configRevision
        ? response.data as RepositoryDocuments : null);
      setDocumentsLoading(false);
    });
    return () => { current = false; };
  }, [invoke, project, verification]);
  const refreshEligibility = useCallback(() => setVerification(value => value + 1), []);
  useEffect(() => {
    const { projectId } = project;
    setEligibility(null);
    if (!live || !inFeatures) return;
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
  }, [project, live, invoke, inFeatures]);
  const canCreate = live && eligibility?.eligible === true;
  const next = !live ? 'Avvia il servizio per creare una feature.'
    : eligibility?.reason === 'APPROVAL_STALE' ? 'Aggiorna e approva l’analisi della codebase.'
    : eligibility?.reason === 'APPROVAL_REQUIRED' ? 'Completa e approva l’analisi della codebase.'
    : eligibility ? 'Controlla lo stato nella sezione Analizza codebase.' : 'Controllo dell’analisi in corso…';
  const observation = project.observation;
  return <article className="detail repository-detail" aria-label={`Dettaglio ${project.displayName}`}>
    <header className="repository-heading">
      <div>
        <h2>{project.displayName}</h2>
        <p className="repository-path mono muted">{project.referenceCheckout}</p>
        {!live && <p className="hint">Ultimo stato noto · servizio fermo</p>}
      </div>
      {section === 'overview' && <button className="button subtle" onClick={() => void onClose()}>Chiudi repository</button>}
    </header>
    {section === 'history' && <RepositoryHistory key={`${project.projectId}:${project.configRevision}`} desktop={desktop} projectId={project.projectId} />}
    {section === 'code' && <RepositoryCode key={`${project.projectId}:${project.configRevision}`} desktop={desktop} projectId={project.projectId} />}
    {section === 'agents' && <ProjectAgents key={route.discoveryId ?? ''}
      desktop={desktop} projectId={project.projectId} initialDiscoveryId={route.discoveryId ?? null}
      onDiscovery={id => onNavigate({ section: 'discovery', discoveryId: id })}
      onFeature={id => onNavigate({ section: 'features', featureId: id, conversation: true })} />}
    {section === 'overview' && <div className="repository-overview">
        <RepositoryReadme documents={documents} loading={documentsLoading} />
        <aside className="repository-summary" aria-labelledby="repository-status-title">
          <h3 id="repository-status-title">Stato repository</h3>
          <dl><dt>Branch base</dt><dd>{project.baseBranch ?? 'Non configurato'}</dd>
            <dt>Stato del branch base</dt><dd>{baseStateLabel(project.baseState)}</dd></dl>
          {!observation ? <p className="hint">Nessuna verifica del repository salvata.</p> : <>
            <p className="hint">Ultimo stato noto · <time dateTime={observation.completedAt}>{dateLabel(observation.completedAt)}</time></p>
            {observation.observedConfigRevision !== project.configRevision
              ? <p className="hint">La verifica riguarda una configurazione precedente.</p>
              : observation.repositoryIdentityStatus === 'CHANGED'
                ? <p className="hint">L’identità del repository è cambiata.</p>
                : observation.checkoutAvailability === 'UNAVAILABLE' && <p className="hint">Checkout non disponibile all’ultima verifica.</p>}
          </>}
        </aside>
      </div>}
    {section === 'features' && <FeaturePlanning key={`${project.configRevision}:${route.featureId ?? ''}`} project={project} desktop={desktop} live={live}
      canCreate={canCreate} creationHint={next} initialFeatureId={route.featureId ?? null} conversation={route.conversation === true}
      interviews={interviews} onExchange={(id, exchange) => setInterviews(previous => {
        const exchanges = previous[id] ?? [];
        return exchanges.some(item => item.turnId === exchange.turnId) ? previous : { ...previous, [id]: [...exchanges, exchange] };
      })}
      onConversation={id => onNavigate({section: 'features', featureId: id, conversation: true})} onWorkspace={onWorkspace} />}
    {section === 'discovery' && <Discovery key={`${project.configRevision}:${route.discoveryId ?? ''}`} project={project} desktop={desktop} live={live} onApproved={refreshEligibility}
      localAnalysis={documents?.analysis} documentsLoading={documentsLoading}
      onFollow={id => onNavigate({ section: 'agents', discoveryId: id })}
      {...(route.discoveryId ? { initialDiscoveryId: route.discoveryId } : {})} />}
  </article>;
}
