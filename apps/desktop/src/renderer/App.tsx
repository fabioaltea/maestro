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
import { settingSections, Settings, type SettingSection } from './views/Settings.tsx';
import { useDesktop } from './state/desktop.ts';

type Section = 'projects' | 'settings' | SettingSection;
const mainSections = [{ id: 'projects', label: 'Repository' }, { id: 'settings', label: 'Impostazioni' }] as const;

export function App() {
  const desktop = useDesktop();
  const [section, setSection] = useState<Section>('projects');
  const epoch = desktop.context?.selectionEpoch ?? 0, projectId = desktop.context?.activeProjectId;
  const current = section !== 'projects' && section !== 'settings' && settingSections[section].scoped && !projectId
    ? 'settings' : section;
  const [workspaceSource, setWorkspaceSource] = useState<(WorkspaceSource & { epoch: number }) | null>(null);
  const [environmentSource, setEnvironmentSource] = useState<{workspaceId: string; epoch: number} | null>(null);
  const [discoverySource, setDiscoverySource] = useState<{ discoveryId: string; epoch: number } | null>(null);
  const [repositoryHomeEpoch, setRepositoryHomeEpoch] = useState<number | null>(null);
  const repositoryHome = !projectId || repositoryHomeEpoch === epoch;
  const main = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (main.current) main.current.scrollTop = 0; }, [current, epoch, repositoryHome]);
  function navigate(next: Section) {
    if (next === section) return;
    void desktop.invoke('releaseViewReads');
    desktop.setNotice(null);
    setSection(next);
  }
  const openWorkspace = (source: WorkspaceSource) => { setWorkspaceSource({...source, epoch}); navigate('workspaces'); };
  const openEnvironment = (workspaceId: string) => { setEnvironmentSource({workspaceId, epoch}); navigate('environments'); };
  function openRepositoryHome() {
    void desktop.invoke('releaseViewReads');
    desktop.setNotice(null);
    setDiscoverySource(null);
    setRepositoryHomeEpoch(epoch);
  }
  const openDiscovery = (discoveryId: string) => {
    setDiscoverySource({ discoveryId, epoch });
    setRepositoryHomeEpoch(null);
    navigate('projects');
  };
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigazione principale">
      <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><h1>Maestro</h1></div>
      <nav aria-label="Sezioni principali">{mainSections.map(item => {
        const selected = item.id === 'projects' ? current === 'projects' : current !== 'projects';
        return <button key={item.id} className={`nav-item ${selected ? 'selected' : ''}`}
          aria-current={item.id === current ? 'page' : selected ? 'location' : undefined} onClick={() => navigate(item.id)}>{item.label}</button>;
      })}</nav>
    </aside>
    <main className="workspace" ref={main}>
      {current !== 'projects' && <header className="workspace-header settings-header">
        {current === 'settings' ? <h2>Impostazioni</h2> : <nav aria-label="Percorso impostazioni">
          <ol className="settings-breadcrumb">
            <li><button className="text-button" onClick={() => navigate('settings')}>Impostazioni</button></li>
            <li aria-hidden="true">›</li>
            <li aria-current="page"><h2>{settingSections[current].label}</h2></li>
          </ol>
        </nav>}
      </header>}
      {desktop.notice && <div className="notice" role="alert"><p>{desktop.notice}</p><button className="text-button" onClick={() => desktop.setNotice(null)}>Chiudi avviso</button></div>}
      {current === 'settings' ? <Settings hasRepository={Boolean(projectId)} onOpen={navigate} />
        : current === 'activity' ? <Activity desktop={desktop} />
        : current === 'diagnostics' ? <Diagnostics desktop={desktop} />
        : current === 'operations' ? <Operations desktop={desktop} />
        : current === 'service' ? <DaemonControls desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'agents' ? <Agents key={epoch} desktop={desktop} projectId={projectId} onRepository={() => navigate('projects')} onDiscovery={openDiscovery} />
        : current === 'profiles' ? <AgentProfiles key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'review' ? <FeatureReview key={epoch} desktop={desktop} onEnvironment={openEnvironment} />
        : current === 'queue' ? <SessionQueue key={epoch} desktop={desktop} />
        : current === 'sessions' ? <Sessions key={epoch} desktop={desktop} onOperations={() => navigate('operations')} />
        : current === 'environments' ? <Environments key={epoch} desktop={desktop}
          workspaceId={environmentSource?.epoch === epoch ? environmentSource.workspaceId : null} onWorkspaces={() => navigate('workspaces')} onOperations={() => navigate('operations')} />
        : current === 'workspaces' ? <Workspaces key={epoch} desktop={desktop} onEnvironment={openEnvironment}
          source={workspaceSource?.epoch === epoch ? workspaceSource : null} onProjects={() => navigate('projects')} onOperations={() => navigate('operations')} />
        : <Projects key={`${epoch}:${repositoryHome}`} desktop={desktop} onWorkspace={openWorkspace} home={repositoryHome}
            onHome={openRepositoryHome} onOpened={() => setRepositoryHomeEpoch(null)}
            {...(discoverySource?.epoch === epoch ? { discoveryId: discoverySource.discoveryId } : {})} />}
    </main>
  </div>;
}
