import { useCallback, useEffect, useRef, useState } from 'react';
import { record } from '../../shared/validation.ts';
import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import { useDiscovery } from '../state/discovery.ts';
import { DiscoveryLaunch } from '../components/DiscoveryLaunch.tsx';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import { dateLabel } from '../format.ts';
import { CodexAccount } from '../components/CodexAccount.tsx';
import { DiscoveryInterview } from '../components/DiscoveryInterview.tsx';
export function Discovery({ desktop, project, live, onApproved }: { desktop: Desktop; project: Project; live: boolean; onApproved: () => void }) {
  const view = useDiscovery(desktop, project.projectId, project.configRevision, onApproved);
  const check = view.provider?.check ? record(view.provider.check) : null;
  const labels: Record<string, string> = { RUNNING: 'In corso', WAITING_USER: 'Attende risposta', READY_FOR_REVIEW: 'Da approvare', APPROVED: 'Approvata', STALE: 'Da aggiornare', INTERRUPTED: 'Interrotta', UPDATING: 'Aggiornamento in corso', RECONCILING: 'Esito incerto', FAILED: 'Non riuscita', CANCELLED: 'Annullata', CANCELLING: 'Annullamento in corso' };
  const [selected, setSelected] = useState<string | null>(null);
  const current = view.items.findLast(item => ['RUNNING', 'WAITING_USER', 'READY_FOR_REVIEW', 'RECONCILING'].includes(item.state));
  const selectedId = selected ?? current?.discoveryId ?? view.items.at(-1)?.discoveryId;
  const { codex, invoke } = desktop;
  const connected = codex.account?.state === 'CONNECTED';
  const [checking, setChecking] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const attempted = useRef(false);
  const { refresh } = view;
  const { refresh: refreshAccount } = codex;
  const available = check?.state === 'AVAILABLE';
  const verify = useCallback(async () => {
    setChecking(true);
    setSetupError(null);
    try {
      const checked = await invoke('checkCodexDiscovery') as { state: string; code: string | null } | null;
      setSetupError(checked?.state === 'READY' ? null : checked?.code ?? 'PROVIDER_UNAVAILABLE');
      if (checked?.code === 'PROVIDER_AUTH_REQUIRED') void refreshAccount();
      await refresh();
    } finally { setChecking(false); }
  }, [invoke, refresh, refreshAccount]);
  useEffect(() => {
    if (!connected) attempted.current = false;
    if (live && connected && !view.loading && !available && !attempted.current) {
      attempted.current = true;
      void verify();
    }
  }, [live, connected, view.loading, available, verify]);
  const providerError = setupError ?? check?.code;
  let availabilityMessage = 'Verifica di Codex per l’analisi in attesa.';
  if (checking) availabilityMessage = 'Verifica di Codex per l’analisi…';
  else if (available && !setupError) availabilityMessage = 'Codex è disponibile per l’analisi.';
  else if (providerError === 'PROVIDER_UNSAFE') {
    availabilityMessage = connected
      ? 'Account Codex collegato. Il controllo di sicurezza di Maestro blocca l’analisi.'
      : 'Il controllo di sicurezza di Maestro blocca l’analisi con Codex.';
  } else if (providerError === 'PROVIDER_AUTH_REQUIRED' && !connected) {
    availabilityMessage = 'Collega il tuo account Codex per avviare l’analisi.';
  } else if (check || setupError) {
    availabilityMessage = 'Impossibile verificare la disponibilità di Codex per l’analisi. Consulta Diagnostica.';
  }
  return <section className="discovery-view" aria-labelledby="discovery-title"><div className="section-heading"><h3 id="discovery-title">Discovery del progetto</h3><button className="text-button" disabled={view.busy || view.loading} onClick={() => void view.refresh()}>Aggiorna Discovery</button></div>
    <p className="hint">Analisi in sola lettura per conoscere scopo, architettura e convenzioni di {project.displayName}.</p>
    {project.observation?.hasCommits === false && <p className="hint">Il repository non ha ancora commit. Aggiungi i file da analizzare e includili nell’anteprima delle fonti.</p>}
    {view.loading && <p role="status">Lettura dello stato Discovery…</p>}
    {!live && <p className="hint">Ultimo stato noto. Avvia esplicitamente il servizio per preparare o avviare una Discovery.</p>}
    <CodexAccount codex={codex} />
    {(connected || check || checking) && <section className="discovery-provider" aria-label="Disponibilità dell’analisi">
      <p role="status">{availabilityMessage}</p>
      {connected && !checking && <button className="button subtle" disabled={!live || view.busy || view.loading || codex.pending !== null} onClick={() => void verify()}>Verifica disponibilità</button>}
    </section>}
    <button className="button subtle" disabled={!live || view.busy} onClick={view.newDiscovery}>Nuova Discovery</button>
    <p className="hint">Una nuova analisi richiede una nuova anteprima e conferma. Le approvazioni storiche restano legate al loro contesto.</p>
    <DiscoveryLaunch view={view} live={live} checkingProvider={checking || setupError !== null} projectId={project.projectId} configRevision={project.configRevision} />
    <div id="discovery-error" role={view.error ? 'alert' : undefined} className="field-error">{view.error}</div>{view.message && <p role="status" className="hint">{view.message}</p>}{view.requestId && <p className="mono">Richiesta: {view.requestId}</p>}
    <section className="discovery-history" aria-labelledby="discovery-history-title"><h4 id="discovery-history-title">Discovery salvate</h4>{!view.loading && !view.items.length && <p className="muted">Non avviata</p>}
      {view.items.map(item => <article key={item.discoveryId}><p>{labels[item.state] ?? 'Stato non verificato'} · {dateLabel(item.updatedAt)}</p><p className="mono">Discovery: {item.discoveryId}<br />Sessione: {item.sessionId}{item.currentRunId && <><br />Esecuzione: {item.currentRunId}</>}</p>{item.error && <p className="field-error">{item.error}</p>}<button className="text-button" onClick={() => setSelected(item.discoveryId)}>Apri sessione</button></article>)}
    </section>
    {selectedId && <DiscoveryInterview key={`${desktop.context?.selectionEpoch}:${selectedId}`} desktop={desktop} projectId={project.projectId} discoveryId={selectedId} live={live} actions={view} />}
    {view.prepared && <ConfirmationDialog prepared={view.prepared} busy={view.busy} onConfirm={() => void view.confirm()} onCancel={() => void view.cancel()} returnFocus={view.returnFocus} />}
  </section>;
}
