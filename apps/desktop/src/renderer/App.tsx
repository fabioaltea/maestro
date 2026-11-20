import {FeatureReview} from './views/FeatureReview.tsx';
import {SessionQueue} from './views/SessionQueue.tsx';
import {Sessions} from './views/Sessions.tsx';
import {AgentProfiles} from './views/AgentProfiles.tsx';
import { record } from '../shared/validation.ts';
import { useState } from 'react';
import { Activity } from './views/Activity.tsx';
import { Diagnostics } from './views/Diagnostics.tsx';
import { DaemonControls } from './views/DaemonControls.tsx';
import { Operations } from './views/Operations.tsx';
import {Environments} from './views/Environments.tsx';
import {Workspaces,type WorkspaceSource} from './views/Workspaces.tsx';
import { Projects } from './views/Projects.tsx';
import { useDesktop } from './state/desktop.ts';
export function App() {
  const desktop = useDesktop();
  const [section, setSection] = useState<'projects' | 'workspaces' | 'environments' | 'profiles' | 'sessions' | 'queue' | 'review' | 'service' | 'operations' | 'activity' | 'diagnostics'>('projects');
  function navigate(next: typeof section) { setCreate(false); if(next===section)return; void desktop.invoke('releaseViewReads'); desktop.setNotice(null); setSection(next); }
  const [workspaceSource,setWorkspaceSource]=useState<(WorkspaceSource&{epoch:number})|null>(null);
  const [environmentSource,setEnvironmentSource]=useState<{workspaceId:string;epoch:number}|null>(null);
  const epoch=desktop.context?.selectionEpoch??0;
  const openWorkspace=(source:WorkspaceSource)=>{setWorkspaceSource({...source,epoch});navigate('workspaces');};
  const openEnvironment=(workspaceId:string)=>{setEnvironmentSource({workspaceId,epoch});navigate('environments');};
  const [choosing, setChoosing] = useState(false);
  const [newName, setNewName] = useState('maestro-state');
  const [create, setCreate] = useState(false);
  async function choose(fresh = false) {
    setChoosing(true); desktop.setNotice(null);
    try { const result=await desktop.invoke('chooseArchive', fresh ? { newArchiveName: newName } : {}); if(result&&record(result).canceled===false){setCreate(false);if(fresh)navigate('service');} }
    finally { setChoosing(false); }
  }
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigazione principale">
      <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><h1>Maestro</h1></div>
      <p className="sidebar-caption">Progetti e stato locale</p>
      <nav aria-label="Sezioni workspace">{([{ id: 'projects', label: 'Progetti' }, { id:'workspaces',label:'Workspace' }, {id:'environments',label:'Ambiente'}, {id:'profiles',label:'Profili agente'}, {id:'sessions',label:'Sessioni'}, {id:'queue',label:'Coda'}, {id:'review',label:'Revisioni'}, { id: 'service', label: 'Servizio' }, { id: 'operations', label: 'Operazioni' }, { id: 'activity', label: 'Attività' }, { id: 'diagnostics', label: 'Diagnostica' }] as const).map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'selected' : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => void navigate(item.id)}>{item.label}</button>)}</nav>
      <div className="archive-card"><span className="eyebrow">Archivio dati Maestro</span>
        <p className="archive-path" title={desktop.context?.displayPath}>{desktop.context?.displayPath ?? 'Non ancora configurato'}</p>
        <button className="button subtle" disabled={choosing || !desktop.runtimeReady} onClick={() => void choose()}>Apri archivio</button>
        <button className="text-button" disabled={choosing || !desktop.runtimeReady} onClick={() => setCreate(v => !v)}>Nuovo archivio</button>
        <p className="hint archive-help">Un archivio può raccogliere più progetti. Ogni progetto è un repository Git.</p>
      </div><p className="sidebar-foot">I tuoi progetti, su questa macchina.</p>
    </aside>
    <main className="workspace">
      <header className="workspace-header"><div><p className="eyebrow">Maestro locale</p><h2>{create ? 'Configura archivio' : section === 'projects' ? 'Progetti' : section==='workspaces' ? 'Workspace' : section==='environments'?'Ambiente':section==='profiles'?'Profili agente':section==='sessions'?'Sessioni':section==='queue'?'Coda sessioni':section==='review'?'Revisioni': section === 'service' ? 'Servizio' : section === 'activity' ? 'Attività' : section === 'diagnostics' ? 'Diagnostica' : 'Operazioni'}</h2></div><span className="connection-label">{desktop.context ? 'Archivio selezionato' : 'Nessun archivio'}</span></header>
      {desktop.notice && <div className="notice" role="alert"><p>{desktop.notice}</p><button className="text-button" onClick={() => desktop.setNotice(null)}>Chiudi avviso</button></div>}
      {create ? <section className="archive-setup" aria-labelledby="archive-setup-title">
        <h3 id="archive-setup-title">Prepara un archivio dati Maestro</h3>
        <p className="muted">Una cartella dedicata al registro dei progetti, alle operazioni e agli eventi del servizio.</p>
        <form onSubmit={e => { e.preventDefault(); void choose(true); }}>
          <label htmlFor="archive-name">Nome archivio</label><input id="archive-name" required maxLength={80} value={newName} onChange={e => setNewName(e.target.value)} aria-describedby="archive-location-help" autoFocus />
          <p id="archive-location-help" className="hint">Scegli una cartella contenitore: Maestro userà una sottocartella con questo nome. La selezione prepara il percorso; i dati vengono creati solo quando confermi Avvia servizio.</p>
          <div className="row-actions form-actions"><button className="button primary" disabled={choosing || !desktop.runtimeReady}>Scegli cartella contenitore</button><button className="button subtle" type="button" disabled={choosing} onClick={() => setCreate(false)}>Annulla configurazione</button></div>
        </form><p className="hint">Dopo l’avvio, usa Progetti → Importa progetto per collegare i tuoi repository Git.</p>
      </section> : section === 'activity' ? <Activity desktop={desktop} /> : section === 'diagnostics' ? <Diagnostics desktop={desktop} /> : section === 'operations' ? <Operations desktop={desktop} /> : section === 'service' ? <DaemonControls desktop={desktop} onOperations={() => navigate('operations')} /> : desktop.context ? section==='review'?<FeatureReview key={epoch} desktop={desktop}/>:section==='queue'?<SessionQueue key={epoch} desktop={desktop}/>:section==='sessions'?<Sessions key={epoch} desktop={desktop} onOperations={()=>navigate('operations')}/>:section==='profiles'?<AgentProfiles key={epoch} desktop={desktop} onOperations={()=>navigate('operations')}/>:section==='environments'?<Environments key={`${epoch}:${environmentSource?.workspaceId??''}`} desktop={desktop} workspaceId={environmentSource?.epoch===epoch?environmentSource.workspaceId:null} onWorkspaces={()=>navigate('workspaces')} onOperations={()=>navigate('operations')}/>:section==='workspaces' ? <Workspaces onEnvironment={openEnvironment} key={epoch} desktop={desktop} source={workspaceSource?.epoch===epoch?workspaceSource:null} onProjects={()=>navigate('projects')} onOperations={()=>navigate('operations')}/> : <Projects desktop={desktop} onWorkspace={openWorkspace}/> : <section className="empty-state archive-intro" aria-labelledby="archive-intro-title">
        <span className="empty-symbol" aria-hidden="true">↗</span><h3 id="archive-intro-title">Un archivio, più progetti</h3>
        <p>Configura l’archivio dati di Maestro, poi collega i repository Git su cui lavori.</p>
        <dl className="archive-model"><div><dt>Archivio Maestro</dt><dd>Conserva il registro dei progetti, le operazioni e gli eventi del servizio.</dd></div><div><dt>Progetti</dt><dd>Sono i repository Git locali che importi nello stesso archivio.</dd></div></dl>
        <p>I file dei repository restano nelle loro cartelle.</p>
        <div className="row-actions"><button className="button primary" disabled={!desktop.runtimeReady || choosing} onClick={() => setCreate(true)}>Configura archivio Maestro</button><button className="button subtle" disabled={!desktop.runtimeReady || choosing} onClick={() => void choose()}>Ho già un archivio Maestro</button></div>
      </section>}
    </main>
  </div>;
}
