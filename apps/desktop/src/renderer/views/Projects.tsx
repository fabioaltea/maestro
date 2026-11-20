import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceSource } from './Workspaces.tsx';
import type { Desktop } from '../state/desktop.ts';
import { record } from '../../shared/validation.ts';
import { decodeProject, type Project } from '../state/project-view.ts';
import { ProjectDetail } from './ProjectDetail.tsx';

function recentIds(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem('maestro.recent-projects') ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 25) : [];
  } catch { return []; }
}
function remember(projectId: string) {
  try { localStorage.setItem('maestro.recent-projects', JSON.stringify([projectId, ...recentIds().filter(id => id !== projectId)].slice(0, 25))); }
  catch { /* Recent registry data remains available if preferences are unavailable. */ }
}

export function Projects({ desktop, onWorkspace }: { desktop: Desktop; onWorkspace(source: WorkspaceSource): void }) {
  const { context, core, invoke, setNotice } = desktop, projectId = context?.activeProjectId;
  const [projects, setProjects] = useState<Project[]>([]), [project, setProject] = useState<Project | null>(null);
  const [live, setLive] = useState(false), [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (!context) return;
    const status = await invoke('status');
    if (!status) return;
    setLive(record(status).liveness === 'LIVE_VERIFIED');
    if (record(status).result !== 'OK') {
      setNotice('Dati locali di Maestro non disponibili. Riprova o consulta Diagnostica.');
      return;
    }
    if (record(record(status).data).status === 'ABSENT') return;
    if (projectId) {
      const detail = await core('getProject', {projectId});
      if (detail?.result === 'OK') setProject(decodeProject(detail.data.project));
    }
    const page = await core('listProjects', {limit: 25});
    if (page?.result === 'OK') {
      const first = (page.data.projects as unknown[]).map(decodeProject);
      setProjects(first);
      setCursor(typeof page.data.nextCursor === 'string' ? page.data.nextCursor : null);
      for (const id of recentIds().filter(id => !first.some(item => item.projectId === id)).slice(0, 10)) {
        const detail = await invoke('getProject', {projectId: id}) as import('../../shared/bridge-contract.ts').PublicResult | null;
        if (!detail) break;
        if (detail.result === 'OK') setProjects(items => items.some(item => item.projectId === id) ? items : [...items, decodeProject(detail.data.project)]);
      }
    }
  }, [context, core, invoke, projectId, setNotice]);
  useEffect(() => {
    setProject(null);
    setProjects([]);
    setCursor(null);
    if (projectId) remember(projectId);
    void refresh();
  }, [refresh]);
  async function select(method: 'openRepository' | 'createRepository' | 'selectProject', selected?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const value = await invoke(method, selected ? {projectId: selected} : {});
      if (!value) return;
      const reply = record(value);
      if (!reply.result) return;
      const result = record(reply.result);
      if (result.error) {
        const error = record(result.error);
        const recovery = method === 'createRepository' && typeof reply.path === 'string'
          ? ` Percorso scelto: ${reply.path}. Puoi riaprirlo con «Apri repository» se Git è già stato inizializzato.` : '';
        setNotice(`${String(error.message)} ${String(error.nextAction)}${recovery}`);
      }
    } finally { setBusy(false); }
  }
  async function more() {
    if (!cursor) return;
    const page = await core('listProjects', {limit: 25, cursor});
    if (page?.result === 'OK') {
      setProjects(old => [...old, ...(page.data.projects as unknown[]).map(decodeProject).filter(item => !old.some(previous => previous.projectId === item.projectId))]);
      setCursor(typeof page.data.nextCursor === 'string' ? page.data.nextCursor : null);
    }
  }
  const order = recentIds();
  const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
  const ordered = [...projects].sort((a, b) => rank(a.projectId) - rank(b.projectId));
  return <section aria-label="Repository locali">
    <div className="row-actions toolbar">
      <button className="button primary" disabled={busy || !context} onClick={() => void select('openRepository')}>Apri repository</button>
      <button className="button subtle" disabled={busy || !context} onClick={() => void select('createRepository')}>Crea repository</button>
      {ordered.length > 0 && <button className="text-button" disabled={busy} onClick={() => void refresh()}>Aggiorna repository</button>}
      {projectId && <button className="text-button" disabled={busy} onClick={() => void invoke('closeProject')}>Chiudi repository</button>}
    </div>
    {busy && <p role="status">Apertura repository…</p>}
    {!context && desktop.runtimeReady && <p role="status">Dati locali di Maestro non disponibili. Consulta Diagnostica.</p>}
    {context && !busy && ordered.length === 0 && <p className="hint">Nessun repository recente.</p>}
    <div className={ordered.length > 0 ? 'project-grid' : undefined}>
      {ordered.length > 0 && <aside className="project-list" aria-label="Repository recenti">
        <h3>Recenti</h3>
        {ordered.map(item => <button key={item.projectId} disabled={busy} className="project-row" aria-current={item.projectId === projectId}
          onClick={() => void select('selectProject', item.projectId)}><strong>{item.displayName}</strong><small>{item.referenceCheckout}</small></button>)}
        {cursor && <button className="button subtle" onClick={() => void more()}>Altri repository</button>}
      </aside>}
      {project?.projectId === projectId && project && <div className="project-detail-column">
        {!live && <p className="hint">Ultimo stato noto · servizio fermo</p>}
        <ProjectDetail project={project} loading={false} desktop={desktop} live={live} onWorkspace={onWorkspace}
          onUpdated={refresh} onRemoved={async () => { await invoke('closeProject'); }} />
      </div>}
    </div>
  </section>;
}
