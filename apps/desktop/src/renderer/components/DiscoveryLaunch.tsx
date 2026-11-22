import { useEffect, useState } from 'react';
import type { Params } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
import { discoveryCanStart, parseDiscoveryScope } from '../state/discovery.ts';
import type { useDiscovery } from '../state/discovery.ts';
import { dateLabel } from '../format.ts';
export function DiscoveryLaunch({ view, live, checkingProvider, projectId, configRevision }: { view: ReturnType<typeof useDiscovery>; live: boolean; checkingProvider: boolean; projectId: string; configRevision: string }) {
  const [scope, setScope] = useState('.'), [consent, setConsent] = useState(false), [now, setNow] = useState(Date.now());
  const snapshot = view.snapshot, configuration = view.provider?.configuration ? record(view.provider.configuration) : null;
  useEffect(() => { setConsent(false); if (!snapshot) return; setNow(Date.now()); const timer = setTimeout(() => setNow(Date.now()), Math.max(0, snapshot.expiresAtMs - Date.now()) + 1); return () => clearTimeout(timer); }, [snapshot]);
  const canStart = !checkingProvider && discoveryCanStart(view.provider, snapshot, live, configRevision, now);
  function preview() { try { void view.preview(parseDiscoveryScope(scope)); } catch (error) { view.setError((error as Error).message); } }
  const source = (p: Params) => <tr key={String(p.sourceId)}><td className="mono">{String(p.relativePath)}</td><td>{String(p.byteLength)} B</td></tr>;
  return <section className="discovery-launch" aria-labelledby="launch-title"><h4 id="launch-title">Ambito dell’analisi</h4>
    <p className="hint">L’anteprima legge e conserva soltanto i file selezionati. Il provider riceve i contenuti solo dopo la conferma di avvio.</p>
    <form onSubmit={e => { e.preventDefault(); preview(); }}><label htmlFor="discovery-scope">Percorsi da analizzare</label>
      <textarea id="discovery-scope" rows={4} value={scope} disabled={view.busy} onChange={e => setScope(e.target.value)} aria-describedby="scope-help discovery-error" />
      <p id="scope-help" className="hint">Da 1 a 16 file o directory relativi al progetto, uno per riga. Il punto indica la cartella del progetto. Credenziali e file esclusi restano fuori dall’analisi.</p>
      <button className="button" disabled={!live || view.busy || view.loading}>Prepara anteprima</button>
    </form>
    {snapshot && <div className="discovery-preview"><h4>Anteprima dei contenuti</h4><p>{snapshot.fileCount} file · {snapshot.byteCount} byte · Copertura: {snapshot.selectors.join(', ')}</p>
      <p className="hint">Scadenza: {dateLabel(new Date(snapshot.expiresAtMs).toISOString())}. L’analisi coprirà solo questo ambito.</p>
      <p className="mono">Digest: {snapshot.contextDigest}</p>
      <table className="discovery-sources"><caption>Fonti selezionate</caption><thead><tr><th>Percorso relativo</th><th>Dimensione</th></tr></thead><tbody>{view.sources.map(source)}</tbody></table>
      {view.cursor && <button className="text-button" disabled={view.busy} onClick={() => void view.moreSources()}>Altre fonti</button>}
      <p className="hint">{snapshot.omissions.length ? `Omissioni: ${snapshot.omissions.join(', ')}` : 'Nessuna omissione segnalata nello scope.'}</p>
      <button className="text-button" disabled={!live || view.busy} onClick={() => void view.prepare('discovery.discard', { projectId, snapshotId: snapshot.snapshotId })}>Scarta anteprima</button>
    </div>}
    <label className="discovery-consent"><input type="checkbox" checked={consent} disabled={!canStart || view.busy} onChange={e => setConsent(e.target.checked)} />Autorizzo l’invio delle fonti selezionate a Codex{configuration ? ` (${String(configuration.modelId)})` : ''} per questa Discovery.</label>
    <button className="button primary" disabled={!canStart || !consent || view.busy} onClick={() => snapshot && configuration && void view.prepare('discovery.start', { projectId, snapshotId: snapshot.snapshotId, expectedConfigRevision: configRevision, expectedProviderRevision: configuration.revision, contextDigest: snapshot.contextDigest })}>Avvia Discovery</button>
    {!canStart && <p className="hint">Per avviare servono servizio attivo, anteprima corrente e verifica provider disponibile. Il core rivalida il contesto prima dell’invio.</p>}
  </section>;
}
