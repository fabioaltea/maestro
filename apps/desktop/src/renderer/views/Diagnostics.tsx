import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
export function Diagnostics({ desktop }: { desktop: Desktop }) {
  const [result, setResult] = useState<PublicResult | null>(null), [loading, setLoading] = useState(false);
  const { core, context } = desktop;
  async function refresh() { setLoading(true); try { const value = await core('diagnostics'); if (value) setResult(value); } finally { setLoading(false); } }
  useEffect(() => { setResult(null); if (context) void refresh(); }, [context?.selectionEpoch, core]);
  if (!context) return <section className="empty-state"><h3>Scegli un archivio</h3><p>La diagnostica usa i dati locali disponibili senza avviare il servizio.</p></section>;
  return <section aria-label="Diagnostica locale"><div className="section-heading"><div><h3>Diagnostica</h3><p className="muted">Stato e limiti esposti dal core, senza credenziali o output grezzo.</p></div><button className="button subtle" disabled={loading} onClick={() => void refresh()}>Aggiorna diagnostica</button></div>
    {loading && <p role="status">Lettura diagnostica…</p>}{result && <><p className="hint">{result.freshness === 'LAST_KNOWN' ? 'Ultimo stato noto' : 'Stato locale verificato'} · {result.liveness === 'LIVE_VERIFIED' ? 'Servizio attivo' : result.liveness === 'ABSENT_VERIFIED' ? 'Servizio fermo' : 'Liveness non verificata'}</p>{result.error && <p role="alert" className="field-error">{result.error.code}: {result.error.message}</p>}<pre className="diagnostics-data">{JSON.stringify(result.data, null, 2)}</pre></>}
  </section>;
}
