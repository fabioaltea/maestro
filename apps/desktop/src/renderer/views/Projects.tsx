import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorkspaceSource } from './Workspaces.tsx';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
import { decodeProject, type Project } from '../state/project-view.ts';
import { ProjectDetail } from './ProjectDetail.tsx';
import { RepositoryGeneral } from './RepositoryGeneral.tsx';
import type { DetailRoute } from '../components/RepositoryNavigation.tsx';

const recentKey = 'maestro.recent-projects';
const activeKey = 'maestro.active-project';

function recentIds(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(recentKey) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(0, 25) : [];
  } catch { return []; }
}
function remember(projectId: string, storeId: string) {
  try {
    localStorage.setItem(activeKey, JSON.stringify({ projectId, storeId }));
    localStorage.setItem(recentKey, JSON.stringify([projectId, ...recentIds().filter(id => id !== projectId)].slice(0, 25)));
  } catch { /* The registry is still available if preferences are unavailable. */ }
}
function rememberedProject(storeId: string) {
  try {
    const saved = record(JSON.parse(localStorage.getItem(activeKey) ?? '{}'));
    return saved.storeId === storeId && typeof saved.projectId === 'string' ? saved.projectId : null;
  } catch { return null; }
}
function forgetProject() {
  try { localStorage.removeItem(activeKey); } catch { /* Preference storage is optional. */ }
}

export function Projects({ desktop, onWorkspace, route, onNavigate, showGeneral }: {
  desktop: Desktop; onWorkspace(source: WorkspaceSource): void;
  route: DetailRoute; onNavigate(route: DetailRoute): void; showGeneral: boolean;
}) {
  const { context, core, invoke, setNotice } = desktop, projectId = context?.activeProjectId;
  const [projects, setProjects] = useState<Project[]>([]), [project, setProject] = useState<Project | null>(null);
  const [live, setLive] = useState(false), [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const revision = useRef(0), restored = useRef(false);

  const readRecent = useCallback(async (token: number) => {
    const page = await core('listProjects', { limit: 25 });
    if (revision.current !== token || page?.result !== 'OK') return;
    const items = (page.data.projects as unknown[]).map(decodeProject);
    for (const id of recentIds().filter(id => !items.some(item => item.projectId === id))) {
      const detail = await invoke('getProject', { projectId: id }) as PublicResult | null;
      if (revision.current !== token || !detail) return;
      if (detail.result === 'OK') items.push(decodeProject(detail.data.project));
    }
    setProjects(items);
    setCursor(typeof page.data.nextCursor === 'string' ? page.data.nextCursor : null);
  }, [core, invoke]);

  const refresh = useCallback(async () => {
    if (!context) return;
    const token = ++revision.current;
    try {
      const status = await core('status');
      if (revision.current !== token || status?.result !== 'OK') return;
      setLive(status.liveness === 'LIVE_VERIFIED');
      if (status.data.status === 'ABSENT') return;
      if (projectId) {
        const detail = await core('getProject', { projectId });
        if (revision.current !== token || detail?.result !== 'OK') return;
        setProject(decodeProject(detail.data.project));
        if (detail.storeId) remember(projectId, detail.storeId);
        return;
      }
      if (!projectId && !restored.current && status.storeId) {
        const saved = rememberedProject(status.storeId);
        if (saved) {
          const reply = await invoke('selectProject', { projectId: saved });
          if (revision.current !== token) return;
          if (reply && record(reply).context && record(record(reply).context).activeProjectId === saved) return;
          const result = reply ? record(record(reply).result) as unknown as PublicResult : null;
          if (result?.error?.code === 'PROJECT_NOT_FOUND') forgetProject();
        }
      }
      restored.current = true;
      await readRecent(token);
    } finally {
      if (revision.current === token) setLoading(false);
    }
  }, [context, projectId, core, invoke, readRecent]);
  useEffect(() => {
    void refresh();
    return () => { revision.current++; };
  }, [refresh]);

  async function select(method: 'openRepository' | 'createRepository' | 'selectProject', selected?: string) {
    setBusy(true);
    setNotice(null);
    try {
      const value = await invoke(method, selected ? { projectId: selected } : {});
      if (!value) return;
      const reply = record(value);
      if (!reply.result) return;
      const result = reply.result as PublicResult;
      if (result.error) {
        const recovery = method === 'createRepository' && typeof reply.path === 'string'
          ? ` Percorso scelto: ${reply.path}. Puoi riaprirlo con «Apri repository» se Git è già stato inizializzato.` : '';
        setNotice(`${result.error.message} ${result.error.nextAction}${recovery}`);
      } else if (reply.context) {
        const next = record(reply.context);
        if (typeof next.activeProjectId === 'string' && typeof next.storeId === 'string') {
          remember(next.activeProjectId, next.storeId);
        }
      }
    } finally { setBusy(false); }
  }
  async function close() {
    if (await invoke('closeProject')) forgetProject();
  }
  async function more() {
    if (!cursor || busy) return;
    setBusy(true);
    const token = revision.current;
    try {
      const page = await core('listProjects', {limit: 25, cursor});
      if (revision.current !== token || page?.result !== 'OK') return;
      const items = (page.data.projects as unknown[]).map(decodeProject);
      setProjects(old => [...old, ...items.filter(item => !old.some(previous => previous.projectId === item.projectId))]);
      setCursor(typeof page.data.nextCursor === 'string' ? page.data.nextCursor : null);
    } finally { setBusy(false); }
  }

  const order = recentIds();
  const rank = (id: string) => order.includes(id) ? order.indexOf(id) : order.length;
  const ordered = [...projects].sort((a, b) => rank(a.projectId) - rank(b.projectId));
  return <section className="repository-view" aria-label="Repository locali">
    {!context && desktop.runtimeReady && <p className="hint" role="status">Dati locali di Maestro non disponibili. Consulta Strumenti → Diagnostica.</p>}
    {projectId ? (project && project.projectId === projectId
        ? showGeneral
          ? <RepositoryGeneral key={project.projectId} project={project} desktop={desktop} live={live} onUpdated={refresh} onRemoved={close} />
          : <ProjectDetail key={project.projectId} project={project} desktop={desktop} live={live} onWorkspace={onWorkspace}
              route={route} onNavigate={onNavigate} onClose={close} />
        : <p className="hint" role="status">{loading ? 'Caricamento repository…' : 'Dettaglio repository non disponibile.'}</p>)
      : <div className="repository-start">
      <section className="repository-picker" aria-labelledby="recent-repositories-title">
        <h2 id="recent-repositories-title">Recenti</h2>
        {context && (loading ? <p className="hint" role="status">Caricamento repository…</p>
          : ordered.length === 0 && <p className="hint">Nessun repository recente.</p>)}
        {ordered.length > 0 && <ul className="repository-recent">
          {ordered.map(item => <li key={item.projectId}>
            <button disabled={busy} className="project-row" aria-current={item.projectId === projectId || undefined}
              title={item.referenceCheckout} onClick={() => void select('selectProject', item.projectId)}>
              <strong>{item.displayName}</strong><small>{item.referenceCheckout}</small>
            </button>
          </li>)}
        </ul>}
        {cursor && <button className="text-button" disabled={busy} onClick={() => void more()}>Altri repository</button>}
      </section>
      <div className="row-actions">
        <button className="button primary" disabled={busy || !context || loading} onClick={() => void select('openRepository')}>Apri repository</button>
        <button className="button subtle" disabled={busy || !context || loading} onClick={() => void select('createRepository')}>Crea repository</button>
      </div>
    </div>}
  </section>;
}
