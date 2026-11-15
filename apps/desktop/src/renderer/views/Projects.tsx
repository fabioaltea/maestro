import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
import { decodeProject, initialProjectView, projectViewReducer } from '../state/project-view.ts';
import { ProjectDetail, dateLabel } from './ProjectDetail.tsx';
export function Projects({ desktop }: { desktop: Desktop }) {
  const { context, core, setNotice } = desktop;
  const epoch = context?.selectionEpoch ?? 0;
  const [view, dispatch] = useReducer(projectViewReducer, initialProjectView);
  const [loading, setLoading] = useState(false), [detailLoading, setDetailLoading] = useState(false);
  const [status, setStatus] = useState<PublicResult | null>(null), [freshness, setFreshness] = useState('');
  const [currentCursor, setCurrentCursor] = useState<string | undefined>(undefined);
  const detailGeneration = useRef(0);
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const polling = useRef(false);
  const updateStatus = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try { const result = await core('status'); if (result) setStatus(result); } finally { polling.current = false; }
  }, [core]);
  const loadPage = useCallback(async (cursor?: string, restart = true) => {
    setLoading(true);
    setCurrentCursor(cursor);
    try {
      const result = await core('listProjects', cursor ? { cursor, limit: 25 } : { limit: 25 });
      if (!result) return;
      if (result.error?.code === 'REGISTRY_CHANGED') {
        dispatch({ type: 'invalidated', epoch }); setHistory([]);
        if (restart) {
          const first = await core('listProjects', { limit: 25 });
          if (first?.result === 'OK') dispatch({ type: 'page', epoch, projects: (first.data.projects as unknown[]).map(decodeProject), cursor: typeof first.data.nextCursor === 'string' ? first.data.nextCursor : null });
        }
        return;
      }
      if (result.result !== 'OK') { dispatch({ type: 'page', epoch, projects: [], cursor: null }); return; }
      dispatch({ type: 'page', epoch, projects: (result.data.projects as unknown[]).map(decodeProject), cursor: typeof result.data.nextCursor === 'string' ? result.data.nextCursor : null });
      setFreshness(result.freshness);
    } catch { setNotice('Il registro ha restituito dati non utilizzabili. Aggiorna la vista.'); }
    finally { setLoading(false); }
  }, [core, epoch, setNotice]);
  useEffect(() => {
    dispatch({ type: 'context', epoch, storeId: context?.storeId ?? null }); detailGeneration.current++; setStatus(null); setHistory([]); setCurrentCursor(undefined);
    if (!context) return;
    void updateStatus(); void loadPage();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void updateStatus(); }, 5000);
    return () => clearInterval(timer);
  }, [epoch, core, loadPage, updateStatus]);
  async function select(projectId: string) {
    const generation = ++detailGeneration.current;
    setDetailLoading(true);
    try {
      const result = await core('getProject', { projectId });
      if (!result || generation !== detailGeneration.current) return;
      if (result.error?.code === 'PROJECT_REMOVED') { dispatch({ type: 'detail', epoch, project: null }); await loadPage(); return; }
      if (result.result === 'OK') dispatch({ type: 'detail', epoch, project: decodeProject(result.data.project) });
    } catch { setNotice('Dettaglio non disponibile. Aggiorna il registro.'); }
    finally { if (generation === detailGeneration.current) setDetailLoading(false); }
  }
  if (!context) return null;
  const labels: Record<string, string> = { LIVE_VERIFIED: 'Servizio attivo', ABSENT_VERIFIED: 'Servizio fermo', UNKNOWN: 'Servizio non verificato' };
  return <section aria-label="Registro progetti">
    <div className="status-strip"><div><span className="badge">{status ? labels[status.liveness] : 'Verifica stato…'}</span><p className="muted">{freshness === 'LAST_KNOWN' ? 'Ultimo stato noto · dati salvati localmente' : freshness === 'LIVE' ? 'Registro live · le osservazioni Git restano datate' : 'Consultazione del registro locale'}</p></div><button className="button subtle" disabled={loading} onClick={() => { setHistory([]); void updateStatus(); void loadPage(); }}>Aggiorna registro</button></div>
    <div className="toolbar"><p className="muted">{loading ? 'Caricamento progetti…' : `${view.projects.length} progetti in questa pagina`}</p>{history.length > 0 && <span className="hint">Pagina {history.length + 1}</span>}</div>
    {view.notice && <p role="status" className="hint">{view.notice}</p>}
    {!loading && !view.projects.length ? <div className="empty-state"><h3>Nessun progetto registrato</h3><p>{status?.data.status === 'ABSENT' ? 'Archivio non inizializzato. L’avvio esplicito del servizio creerà lo stato locale.' : 'Questo archivio non contiene progetti. Le registrazioni sono gestite dal servizio locale.'}</p></div> : <div className="project-grid"><div className="project-list"><div aria-label="Progetti registrati">{view.projects.map(project => <button key={project.projectId} className="project-row" aria-current={view.detail?.projectId === project.projectId} onClick={() => void select(project.projectId)}><strong>{project.displayName}</strong><small>{project.referenceCheckout}</small><small>Aggiornato {dateLabel(project.updatedAt)}</small></button>)}</div><div className="pagination"><button className="button subtle" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1); setHistory(h => h.slice(0, -1)); void loadPage(previous); }}>Precedente</button><button className="button subtle" disabled={loading || !view.cursor} onClick={() => { const cursor = view.cursor; if (cursor) { setHistory(h => [...h, currentCursor]); void loadPage(cursor); } }}>Successiva</button></div></div><ProjectDetail project={view.detail} loading={detailLoading} /></div>}
  </section>;
}
