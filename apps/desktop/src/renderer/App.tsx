import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
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
import { RepositoryNavigation, type DetailRoute, type RepositorySection } from './components/RepositoryNavigation.tsx';
import { isRepositorySetting, RepositorySettings, type RepositorySetting } from './views/RepositorySettings.tsx';
import { globalTools, isGlobalTool, type GlobalTool } from '../shared/tool-menu.ts';
import { useDesktop } from './state/desktop.ts';

type Section = Exclude<RepositorySection, 'settings'> | RepositorySetting | GlobalTool;
const overview: DetailRoute = { section: 'overview' };
function isDetailSection(section: Section) {
  return section === 'overview' || section === 'history' || section === 'code' || section === 'features' || section === 'discovery' || section === 'agents' || section === 'general';
}

export function App() {
  const desktop = useDesktop();
  const { invoke, setNotice } = desktop;
  const [location, setLocation] = useState<{ section: Section; epoch: number; detail?: DetailRoute }>({ section: 'overview', epoch: 0 });
  const epoch = desktop.context?.selectionEpoch ?? 0, projectId = desktop.context?.activeProjectId;
  const [workspaceSource, setWorkspaceSource] = useState<(WorkspaceSource & { epoch: number }) | null>(null);
  const [environmentSource, setEnvironmentSource] = useState<{workspaceId: string; epoch: number} | null>(null);
  const current = isGlobalTool(location.section) || (projectId && location.epoch === epoch) ? location.section : 'overview';
  const detail = projectId && location.epoch === epoch ? location.detail ?? overview : overview;
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [current, epoch, projectId]);
  const openTool = useEffectEvent((tool: GlobalTool) => navigate(tool));
  useEffect(() => window.maestro.onOpenTool(tool => openTool(tool)), []);
  function navigate(next: Section, detail?: DetailRoute) {
    if (next === current && !detail) return;
    if (next !== current && !(isDetailSection(next) && isDetailSection(current))) void invoke('releaseViewReads');
    setNotice(null);
    setLocation({ section: next, epoch, ...(detail ? { detail } : {}) });
  }
  function openRepositorySection(next: RepositorySection) {
    if (next === 'overview') navigate(next, overview);
    else if (!projectId) return;
    else if (next === 'history' || next === 'code' || next === 'features' || next === 'discovery' || next === 'agents') navigate(next, { section: next });
    else navigate('general');
  }
  const openWorkspace = (source: WorkspaceSource) => { setWorkspaceSource({...source, epoch}); navigate('workspaces'); };
  const openEnvironment = (workspaceId: string) => { setEnvironmentSource({workspaceId, epoch}); navigate('environments'); };
  const openDiscovery = (discoveryId: string) => {
    if (!projectId) return;
    navigate('discovery', { section: 'discovery', discoveryId });
  };
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigazione principale">
      <h1 className="brand-mark"><span aria-hidden="true">m</span><span className="visually-hidden">Maestro</span></h1>
      <RepositoryNavigation current={isGlobalTool(current) ? undefined : isRepositorySetting(current) ? 'settings' : current}
        hasRepository={Boolean(projectId)} onOpen={openRepositorySection} />
    </aside>
    <main className="workspace" ref={main}>
      {isGlobalTool(current) && <header className="workspace-header tool-header"><h2>{globalTools[current]}</h2></header>}
      {isRepositorySetting(current) && <RepositorySettings current={current} onOpen={navigate} />}
      {desktop.notice && <div className="notice" role="alert"><p>{desktop.notice}</p><button className="text-button" onClick={() => desktop.setNotice(null)}>Chiudi avviso</button></div>}
      {current === 'activity' ? <Activity desktop={desktop} />
        : current === 'diagnostics' ? <Diagnostics desktop={desktop} />
        : current === 'operations' ? <Operations desktop={desktop} />
        : current === 'service' ? <DaemonControls desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'monitor' ? <Agents key={epoch} desktop={desktop} projectId={projectId}
          onRepository={() => openRepositorySection('overview')} onDiscovery={openDiscovery} />
        : current === 'profiles' ? <AgentProfiles key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'review' ? <FeatureReview key={epoch} desktop={desktop} onEnvironment={openEnvironment} />
        : current === 'queue' ? <SessionQueue key={epoch} desktop={desktop} />
        : current === 'sessions' ? <Sessions key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'environments' ? <Environments key={epoch} desktop={desktop}
          workspaceId={environmentSource?.epoch === epoch ? environmentSource.workspaceId : null} onWorkspaces={() => navigate('workspaces')} onOperations={() => navigate('operations')} />
        : current === 'workspaces' ? <Workspaces key={epoch} desktop={desktop} onEnvironment={openEnvironment}
          source={workspaceSource?.epoch === epoch ? workspaceSource : null} onProjects={() => openRepositorySection('overview')} onOperations={() => navigate('operations')} />
        : <Projects key={epoch} desktop={desktop} onWorkspace={openWorkspace} route={detail} showGeneral={current === 'general'}
            onNavigate={route => navigate(route.section, route)} />}
    </main>
  </div>;
}
