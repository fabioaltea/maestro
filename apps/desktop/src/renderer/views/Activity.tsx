import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import { appendActivity, emptyActivity } from '../state/activity.ts';
import type { ActivityState } from '../state/activity.ts';
import { decodeHistoryPage } from '../../shared/activity-contract.ts';
import type { HistoryPage } from '../../shared/activity-contract.ts';
import { dateLabel } from '../format.ts';
export function Activity({ desktop }: { desktop: Desktop }) {
  const [state, setState] = useState<ActivityState>(emptyActivity), [page, setPage] = useState<HistoryPage | null>(null), [loading, setLoading] = useState(false);
  const [freshness, setFreshness] = useState(''), [error, setError] = useState<string | null>(null);
  const applied = useRef<ActivityState>(emptyActivity), generation = useRef(0);
  const { core, context } = desktop;
  useLayoutEffect(() => { applied.current = state; }, [state]);
  async function load(reset = false) {
    const id = ++generation.current; setLoading(true); setError(null);
    const after = reset ? undefined : applied.current.cursor;
    try {
      const result = await core('readEvents', { limit: 100, ...(after ? { after } : {}) });
      if (id !== generation.current) return;
      if (!result) { setError('Storia non disponibile. Rileggi senza assumere che sia vuota.'); return; }
      if (result.result !== 'OK') { setError(result.error?.message ?? 'Storia non disponibile.'); return; }
      if (!result.data.events || !result.storeId) { setError('Nessuna storia disponibile per questo archivio.'); return; }
      const nextPage = decodeHistoryPage(result.data.events, result.storeId);
      const old = reset ? emptyActivity : applied.current;
      if (!nextPage.records.length && old.appliedSeq !== null && old.appliedSeq !== nextPage.nextAfter) throw new Error('STREAM_GAP');
      const updated = appendActivity(old, nextPage.records);
      setState({ ...updated, storeId: result.storeId, appliedSeq: updated.appliedSeq ?? nextPage.nextAfter, cursor: nextPage.cursor });
      setPage(nextPage); setFreshness(result.freshness);
    } catch { setError('Continuità della storia non verificata. Rileggi lo stato prima di ripartire.'); }
    finally { if (id === generation.current) setLoading(false); }
  }
  useEffect(() => { setState(emptyActivity); setPage(null); if (context) void load(true); return () => { generation.current++; }; }, [context?.selectionEpoch, core]);
  if (!context) return <section className="empty-state"><h3>Scegli un archivio</h3><p>Gli eventi persistiti si consultano anche quando il servizio è fermo.</p></section>;
  return <section className="activity-view" aria-label="Attività locale"><div className="section-heading"><div><h3>Attività</h3><p className="muted">Storia persistita del core · {freshness === 'LAST_KNOWN' ? 'Ultimo stato noto' : 'Archivio locale'}</p></div><div className="row-actions"><button className="button subtle" disabled={loading} onClick={() => void load(true)}>Rileggi storia</button>{page?.truncated && <button className="button" disabled={loading} onClick={() => void load()}>Carica altri eventi</button>}</div></div>
    {loading && <p role="status" className="hint">Lettura storia…</p>}{error && <p role="alert" className="field-error">{error}</p>}
    {page && <p className="hint">Storia disponibile dall’evento {page.firstAvailable}; letti fino a {state.appliedSeq ?? '0'} di {page.highWater}. {page.truncated ? 'Sono disponibili altri eventi.' : 'Storia disponibile caricata.'}</p>}
    {state.omitted > 0 && <p className="hint" role="status">{state.omitted} eventi precedenti non mantenuti nella vista. La finestra conserva al massimo 500 eventi.</p>}
    {page && !loading && !error && !state.events.length && <p className="hint">Nessun evento conservato.</p>}
    <div className="event-list" aria-label="Eventi del core">{[...state.events].reverse().map(event => <article key={event.eventId} className="event-row" data-event-seq={event.seq}><div className="section-heading"><strong>{event.type === 'lifecycle.changed' ? 'Stato del servizio cambiato' : event.type === 'operation.completed' ? 'Operazione completata' : event.type === 'operation.failed' ? 'Operazione non riuscita' : event.type === 'operation.accepted' ? 'Operazione accettata' : event.type === 'operation.blocked' ? 'Operazione bloccata' : event.type}</strong><time dateTime={event.occurredAt}>{dateLabel(event.occurredAt)}</time></div><p className="mono muted">#{event.seq} · {event.type}{event.operationId ? ` · ${event.operationId}` : ''}</p><details><summary>Dettagli evento</summary><pre>{JSON.stringify(event.payload, null, 2)}</pre></details></article>)}</div>
  </section>;
}
