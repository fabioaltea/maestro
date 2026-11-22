import { useLayoutEffect, useRef, useState } from 'react';
import { FeatureReview } from './views/FeatureReview.tsx';
import { SessionQueue } from './views/SessionQueue.tsx';
import { Sessions } from './views/Sessions.tsx';
import { AgentProfiles } from './views/AgentProfiles.tsx';
import { Activity } from './views/Activity.tsx';
import { Diagnostics } from './views/Diagnostics.tsx';
import { DaemonControls } from './views/DaemonControls.tsx';
import { Operations } from './views/Operations.tsx';
import { Environments } from './views/Environments.tsx';
import { Workspaces, type WorkspaceSource } from './views/Workspaces.tsx';
import { Projects } from './views/Projects.tsx';
import { Agents } from './views/Agents.tsx';
import { useDesktop } from './state/desktop.ts';

const sections = [
  { id: 'projects', label: 'Repository', scoped: false },
  { id: 'agents', label: 'Agenti', scoped: false },
  { id: 'workspaces', label: 'Workspace', scoped: true },
  { id: 'environments', label: 'Ambiente', scoped: true },
  { id: 'profiles', label: 'Profili agente', scoped: false },
  { id: 'sessions', label: 'Sessioni', scoped: true },
  { id: 'queue', label: 'Coda', scoped: true },
  { id: 'review', label: 'Revisioni', scoped: true },
  { id: 'operations', label: 'Operazioni', scoped: false },
  { id: 'activity', label: 'Attività', scoped: false },
  { id: 'diagnostics', label: 'Diagnostica', scoped: false },
  { id: 'service', label: 'Servizio', scoped: false },
] as const;

export function App() {
  const desktop = useDesktop();
  const [section, setSection] = useState<(typeof sections)[number]['id']>('projects');
  const epoch = desktop.context?.selectionEpoch ?? 0, projectId = desktop.context?.activeProjectId;
  const [workspaceSource, setWorkspaceSource] = useState<(WorkspaceSource & { epoch: number }) | null>(null);
  const [environmentSource, setEnvironmentSource] = useState<{workspaceId: string; epoch: number} | null>(null);
  const [discoverySource, setDiscoverySource] = useState<{ discoveryId: string; epoch: number } | null>(null);
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [section, epoch]);
  function navigate(next: typeof section) {
    if (next === section) return;
    void desktop.invoke('releaseViewReads');
    desktop.setNotice(null);
    setSection(next);
  }
  const openWorkspace = (source: WorkspaceSource) => { setWorkspaceSource({...source, epoch}); navigate('workspaces'); };
  const openEnvironment = (workspaceId: string) => { setEnvironmentSource({workspaceId, epoch}); navigate('environments'); };
  const openDiscovery = (discoveryId: string) => { setDiscoverySource({ discoveryId, epoch }); navigate('projects'); };
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigazione principale">
      <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><h1>Maestro</h1></div>
      <nav aria-label="Sezioni workspace">{sections.filter(item => !item.scoped || projectId).map(item =>
        <button key={item.id} className={`nav-item ${section === item.id ? 'selected' : ''}`} aria-current={section === item.id ? 'page' : undefined}
          onClick={() => navigate(item.id)}>{item.label}</button>)}</nav>
    </aside>
    <main className="workspace" ref={main}>
      <header className="workspace-header"><h2>{sections.find(item => item.id === section)?.label}</h2></header>
      {desktop.notice && <div className="notice" role="alert"><p>{desktop.notice}</p><button className="text-button" onClick={() => desktop.setNotice(null)}>Chiudi avviso</button></div>}
      {section === 'activity' ? <Activity desktop={desktop} />
        : section === 'diagnostics' ? <Diagnostics desktop={desktop} />
        : section === 'operations' ? <Operations desktop={desktop} />
        : section === 'service' ? <DaemonControls desktop={desktop} onOperations={() => navigate('operations')} />
        : section === 'agents' ? <Agents key={epoch} desktop={desktop} projectId={projectId} onRepository={() => navigate('projects')} onDiscovery={openDiscovery} />
        : section === 'profiles' ? <AgentProfiles key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : section === 'review' && projectId ? <FeatureReview key={epoch} desktop={desktop} onEnvironment={openEnvironment} />
        : section === 'queue' && projectId ? <SessionQueue key={epoch} desktop={desktop} />
        : section === 'sessions' && projectId ? <Sessions key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : section === 'environments' && projectId ? <Environments key={epoch} desktop={desktop}
          workspaceId={environmentSource?.epoch === epoch ? environmentSource.workspaceId : null} onWorkspaces={() => navigate('workspaces')} onOperations={() => navigate('operations')} />
        : section === 'workspaces' && projectId ? <Workspaces key={epoch} desktop={desktop} onEnvironment={openEnvironment}
          source={workspaceSource?.epoch === epoch ? workspaceSource : null} onProjects={() => navigate('projects')} onOperations={() => navigate('operations')} />
        : <Projects key={epoch} desktop={desktop} onWorkspace={openWorkspace}
            {...(discoverySource?.epoch === epoch ? { discoveryId: discoverySource.discoveryId } : {})} />}
    </main>
  </div>;
}
