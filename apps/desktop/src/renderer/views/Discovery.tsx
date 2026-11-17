import { useState } from 'react';
import { record } from '../../shared/validation.ts';
import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import { useDiscovery } from '../state/discovery.ts';
import { DiscoveryLaunch } from '../components/DiscoveryLaunch.tsx';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import { dateLabel } from '../format.ts';
export function Discovery({ desktop, project, live }: { desktop: Desktop; project: Project; live: boolean }) {
  const view = useDiscovery(desktop, project.projectId, project.configRevision), [binary, setBinary] = useState<{ providerBinaryHandle: string; displayName: string } | null>(null), [model, setModel] = useState(''), [choosing, setChoosing] = useState(false);
  const configuration = view.provider?.configuration ? record(view.provider.configuration) : null, check = view.provider?.check ? record(view.provider.check) : null;
  const labels: Record<string, string> = { RUNNING: 'In corso', WAITING_USER: 'Attende risposta', READY_FOR_REVIEW: 'Da approvare', APPROVED: 'Approvata', STALE: 'Da aggiornare', INTERRUPTED: 'Interrotta', RECONCILING: 'Esito incerto', FAILED: 'Non riuscita', CANCELLED: 'Annullata', CANCELLING: 'Annullamento in corso' };
  async function choose() { setChoosing(true); try { const result = await desktop.invoke('chooseProviderBinary'); if (result) setBinary(record(result).provider as typeof binary); } finally { setChoosing(false); } }
  return <section className="discovery-view" aria-labelledby="discovery-title"><div className="section-heading"><h3 id="discovery-title">Discovery del progetto</h3><button className="text-button" disabled={view.busy || view.loading} onClick={() => void view.refresh()}>Aggiorna Discovery</button></div>
    <p className="hint">Analisi in sola lettura per conoscere scopo, architettura e convenzioni di {project.displayName}.</p>
    {view.loading && <p role="status">Lettura dello stato Discovery…</p>}
    {!live && <p className="hint">Ultimo stato noto. Avvia esplicitamente il servizio per preparare o avviare una Discovery.</p>}
    <section className="discovery-provider" aria-labelledby="provider-title"><h4 id="provider-title">Provider</h4><p>{configuration ? `Codex · ${configuration.modelId}` : 'Provider non configurato'}</p>
      {configuration && <p className="hint">Versione: {String(configuration.binaryVersion)} · Revisione {String(configuration.revision)}</p>}
      <p className="hint">{check ? `Stato: ${check.state} · Verificato: ${dateLabel(String(check.checkedAt))}` : 'Disponibilità e login non ancora verificati.'}</p>
      {Boolean(check?.code) && <p className="field-error">{String(check?.code)}</p>}
      <details><summary>Configura Codex e login ufficiale</summary><p className="hint">Seleziona il binario nativo qualificato e il modello del tuo account. Esegui il login nella CLI ufficiale con il CODEX_HOME dedicato a Maestro e archivio credenziali Keychain. Maestro non installa il provider e non richiede token.</p>
        <p className="hint">Il profilo dedicato è in ~/Library/Application Support/Maestro/providers/codex-discovery/. Un login dell’installazione ordinaria potrebbe non essere disponibile qui.</p>
        <button className="button subtle" disabled={!live || view.busy || choosing} onClick={() => void choose()}>Scegli binario Codex</button>{binary && <p className="hint">Selezionato: {binary.displayName}</p>}
        <form onSubmit={e => { e.preventDefault(); if (binary) void view.prepare('discovery.configure', { providerBinaryHandle: binary.providerBinaryHandle, modelId: model, expectedProviderRevision: configuration?.revision ?? null }); }}>
          <label htmlFor="discovery-model">Modello Codex</label><input id="discovery-model" required maxLength={128} pattern="[a-zA-Z0-9][a-zA-Z0-9._:/-]*" value={model} disabled={view.busy} onChange={e => setModel(e.target.value)} />
          <button className="button" disabled={!live || view.busy || !binary || !model}>Configura provider</button>
        </form>
      </details>
      <button className="button subtle" disabled={!live || view.busy || !configuration} onClick={() => void view.prepare('discovery.check', { expectedProviderRevision: configuration?.revision })}>Verifica provider e login</button>
    </section>
    <DiscoveryLaunch view={view} live={live} projectId={project.projectId} configRevision={project.configRevision} />
    <div id="discovery-error" role={view.error ? 'alert' : undefined} className="field-error">{view.error}</div>{view.message && <p role="status" className="hint">{view.message}</p>}{view.requestId && <p className="mono">Richiesta: {view.requestId}</p>}
    <section className="discovery-history" aria-labelledby="discovery-history-title"><h4 id="discovery-history-title">Discovery salvate</h4>{!view.loading && !view.items.length && <p className="muted">Non avviata</p>}
      {view.items.map(item => <article key={item.discoveryId}><p>{labels[item.state] ?? 'Stato non verificato'} · {dateLabel(item.updatedAt)}</p><p className="mono">Discovery: {item.discoveryId}<br />Sessione: {item.sessionId}{item.currentRunId && <><br />Esecuzione: {item.currentRunId}</>}</p>{item.error && <p className="field-error">{item.error}</p>}</article>)}
    </section>
    {view.prepared && <ConfirmationDialog prepared={view.prepared} busy={view.busy} onConfirm={() => void view.confirm()} onCancel={() => void view.cancel()} returnFocus={view.returnFocus} />}
  </section>;
}
