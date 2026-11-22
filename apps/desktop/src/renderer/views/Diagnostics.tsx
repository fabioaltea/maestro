import { useEffect, useState } from 'react';
import { DiscoveryProviderSettings } from '../components/DiscoveryProviderSettings.tsx';
import { CodexAccount } from '../components/CodexAccount.tsx';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
export function Diagnostics({ desktop }: { desktop: Desktop }) {
  const [result, setResult] = useState<PublicResult | null>(null), [loading, setLoading] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const { core, context, invoke, setNotice } = desktop;
  async function refresh() { setLoading(true); try { const value = await core('diagnostics'); if (value) setResult(value); } finally { setLoading(false); } }
  useEffect(() => { setResult(null); if (context) void refresh(); }, [context?.selectionEpoch, core]);
  async function recover() {
    setRecovering(true); setNotice(null);
    try {
      const value = await invoke('recoverArchive') as { canceled?: boolean } | null;
      if (value?.canceled === false) setNotice('Storico recuperato. Apri Repository per ritrovare i tuoi progetti.');
    } finally { setRecovering(false); }
  }
  return <section aria-label="Diagnostica locale"><div className="section-heading"><div><h3>Diagnostica</h3><p className="muted">Stato e limiti esposti dal core, senza credenziali o output grezzo.</p></div><button className="button subtle" disabled={loading || !context} onClick={() => void refresh()}>Aggiorna diagnostica</button></div>
    <details><summary>Recupero dello storico</summary><p className="hint">Puoi recuperare un archivio compatibile e fermo prima di registrare dati in questo profilo. Lo storico resta nella sua cartella originale.</p><button className="button subtle" disabled={recovering || !desktop.runtimeReady} onClick={() => void recover()}>Recupera storico</button></details>
    {desktop.runtimeReady && <CodexAccount codex={desktop.codex} diagnostics />}
    {context && <DiscoveryProviderSettings key={context.selectionEpoch} desktop={desktop} />}
    {loading && <p role="status">Lettura diagnostica…</p>}{result && <><p className="hint">{result.freshness === 'LAST_KNOWN' ? 'Ultimo stato noto' : 'Stato locale verificato'} · {result.liveness === 'LIVE_VERIFIED' ? 'Servizio attivo' : result.liveness === 'ABSENT_VERIFIED' ? 'Servizio fermo' : 'Liveness non verificata'}</p>{result.error && <p role="alert" className="field-error">{result.error.code}: {result.error.message}</p>}<pre className="diagnostics-data">{JSON.stringify(result.data, null, 2)}</pre></>}
  </section>;
}
