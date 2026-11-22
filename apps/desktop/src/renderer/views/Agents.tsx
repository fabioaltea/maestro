import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import { currentDiscovery, discoveryIsRunning, discoveryStateLabels, readDiscoveryHistory, useDiscoverySession, type DiscoverySummary } from '../state/discovery.ts';
import { DiscoveryTerminal } from '../components/DiscoveryTerminal.tsx';
import { dateLabel } from '../format.ts';

function DiscoveryActivity({ desktop, projectId, discovery, live, onDiscovery }: {
  desktop: Desktop; projectId: string; discovery: DiscoverySummary; live: boolean; onDiscovery(id: string): void;
}) {
  const view = useDiscoverySession(desktop, projectId, discovery.discoveryId, false, live, false);
  const session = view.session ?? discovery;
  const streaming = live && view.freshness !== 'LAST_KNOWN' && discoveryIsRunning(session.state);
  return <section className="agent-discovery" aria-label="Esecuzione Discovery">
    <div className="agent-run-heading">
      <div>
        <h3>Discovery del progetto</h3>
        <p className="hint" role="status">{discoveryStateLabels[session.state] ?? session.state}
          {(!live || view.freshness === 'LAST_KNOWN') && ' · Ultimo stato noto'}</p>
      </div>
      <button className="button subtle" onClick={() => onDiscovery(discovery.discoveryId)}>Apri Discovery</button>
    </div>
    {session.error && <p className="field-error">{session.error}</p>}
    {view.failure && <p className="field-error" role="alert">{view.failure}</p>}
    <DiscoveryTerminal key={session.currentRunId ?? 'pending'} ring={view.ring} live={streaming} />
    <details className="agent-run-details"><summary>Identificativi della sessione</summary>
      <dl><dt>Sessione</dt><dd className="mono">{session.sessionId}</dd>
        <dt>Esecuzione</dt><dd className="mono">{session.currentRunId ?? 'In attesa'}</dd></dl>
    </details>
  </section>;
}

export function Agents({ desktop, projectId, onRepository, onDiscovery }: {
  desktop: Desktop; projectId: string | undefined; onRepository(): void; onDiscovery(id: string): void;
}) {
  const { core } = desktop;
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readDiscoveryHistory>>>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const result = await readDiscoveryHistory(core, projectId, () => !disposed);
        if (!disposed) {
          if (result) setHistory(result);
          setUnavailable(!result);
          setLoading(false);
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void tick(), 5000);
      }
    };
    void tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, [core, projectId, retry]);

  if (!projectId) return <section className="repository-start" aria-label="Attività agenti">
    <p className="muted">Apri un repository per seguire le sue sessioni Discovery.</p>
    <button className="button primary" onClick={onRepository}>Vai a Repository</button>
  </section>;

  const items = history?.items ?? [];
  const discovery = items.find(item => item.discoveryId === selected) ?? currentDiscovery(items);
  return <section className="agents-view" aria-label="Attività agenti">
    <div className="agent-controls">
      {items.length > 1 && <label>Sessione Discovery
        <select value={selected ?? ''} onChange={event => setSelected(event.target.value || null)}>
          <option value="">Sessione corrente</option>
          {[...items].reverse().map(item => <option key={item.discoveryId} value={item.discoveryId}>
            {dateLabel(item.updatedAt)} · {discoveryStateLabels[item.state] ?? item.state}
          </option>)}
        </select>
      </label>}
      <button className="text-button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Aggiorna attività</button>
    </div>
    {unavailable && <p role="status" className="hint">Elenco Discovery non disponibile.</p>}
    {discovery && <DiscoveryActivity key={discovery.discoveryId} desktop={desktop} projectId={projectId}
      discovery={discovery} live={history?.live === true} onDiscovery={onDiscovery} />}
    {!discovery && (loading ? <p role="status" className="hint">Lettura delle sessioni…</p>
      : history && <p className="muted">Nessuna Discovery per questo repository.</p>)}
  </section>;
}
