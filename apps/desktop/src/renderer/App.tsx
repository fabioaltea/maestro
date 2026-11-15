import { useState } from 'react';
import { Activity } from './views/Activity.tsx';
import { Diagnostics } from './views/Diagnostics.tsx';
import { DaemonControls } from './views/DaemonControls.tsx';
import { Operations } from './views/Operations.tsx';
import { Projects } from './views/Projects.tsx';
import { useDesktop } from './state/desktop.ts';
export function App() {
  const desktop = useDesktop();
  const [section, setSection] = useState<'projects' | 'service' | 'operations' | 'activity' | 'diagnostics'>('projects');
  function navigate(next: typeof section) { if(next===section)return; void desktop.invoke('releaseViewReads'); desktop.setNotice(null); setSection(next); }
  const [choosing, setChoosing] = useState(false);
  const [newName, setNewName] = useState('maestro-state');
  const [create, setCreate] = useState(false);
  async function choose(fresh = false) {
    setChoosing(true); desktop.setNotice(null);
    try { await desktop.invoke('chooseArchive', fresh ? { newArchiveName: newName } : {}); }
    finally { setChoosing(false); }
  }
  return <div className="app-shell">
    <aside className="sidebar" aria-label="Navigazione principale">
      <div className="brand"><span className="brand-mark" aria-hidden="true">m</span><h1>Maestro</h1></div>
      <p className="sidebar-caption">Il tuo workspace locale</p>
      <nav aria-label="Sezioni workspace">{([{ id: 'projects', label: 'Progetti' }, { id: 'service', label: 'Servizio' }, { id: 'operations', label: 'Operazioni' }, { id: 'activity', label: 'Attività' }, { id: 'diagnostics', label: 'Diagnostica' }] as const).map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'selected' : ''}`} aria-current={section === item.id ? 'page' : undefined} onClick={() => void navigate(item.id)}>{item.label}</button>)}</nav>
      <div className="archive-card"><span className="eyebrow">Archivio</span>
        <p className="archive-path" title={desktop.context?.displayPath}>{desktop.context?.displayPath ?? 'Nessun archivio selezionato'}</p>
        <button className="button subtle" disabled={choosing || !desktop.runtimeReady} onClick={() => void choose()}>Scegli archivio</button>
        <button className="text-button" disabled={choosing || !desktop.runtimeReady} onClick={() => setCreate(v => !v)}>Nuovo archivio</button>
        {create && <form onSubmit={e => { e.preventDefault(); void choose(true); }}><label htmlFor="archive-name">Nome archivio</label><input id="archive-name" required maxLength={80} value={newName} onChange={e => setNewName(e.target.value)} /><p className="hint">La selezione non crea dati. Sarà necessario avviare esplicitamente il servizio.</p><button className="button" disabled={choosing}>Scegli cartella contenitore</button></form>}
      </div><p className="sidebar-foot">I tuoi progetti, su questa macchina.</p>
    </aside>
    <main className="workspace">
      <header className="workspace-header"><div><p className="eyebrow">Workspace</p><h2>{section === 'projects' ? 'Progetti' : section === 'service' ? 'Servizio' : section === 'activity' ? 'Attività' : section === 'diagnostics' ? 'Diagnostica' : 'Operazioni'}</h2></div><span className="connection-label">{desktop.context ? 'Archivio selezionato' : 'Nessun archivio'}</span></header>
      {desktop.notice && <div className="notice" role="alert"><p>{desktop.notice}</p><button className="text-button" onClick={() => desktop.setNotice(null)}>Chiudi avviso</button></div>}
      {section === 'activity' ? <Activity desktop={desktop} /> : section === 'diagnostics' ? <Diagnostics desktop={desktop} /> : section === 'operations' ? <Operations desktop={desktop} /> : section === 'service' ? <DaemonControls desktop={desktop} onOperations={() => setSection('operations')} /> : desktop.context ? <Projects desktop={desktop} /> : <section className="empty-state"><span className="empty-symbol" aria-hidden="true">↗</span><h3>{desktop.context ? 'Archivio pronto per la consultazione' : 'Uno spazio per i tuoi progetti'}</h3><p>{desktop.context ? 'Consulta il registro locale senza modificare i repository.' : 'Scegli un archivio Maestro. Puoi leggere gli ultimi dati salvati anche quando il servizio è fermo.'}</p>{!desktop.context && <button className="button primary" disabled={!desktop.runtimeReady || choosing} onClick={() => void choose()}>Scegli archivio locale</button>}</section>}
    </main>
  </div>;
}
