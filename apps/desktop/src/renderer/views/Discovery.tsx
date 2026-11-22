import { useCallback, useEffect, useRef, useState } from 'react';
import { record } from '../../shared/validation.ts';
import type { Desktop } from '../state/desktop.ts';
import type { Project } from '../state/project-view.ts';
import { currentDiscovery, discoveryIsRunning, discoveryStateLabels, useDiscovery } from '../state/discovery.ts';
import { DiscoveryLaunch } from '../components/DiscoveryLaunch.tsx';
import { ConfirmationDialog } from '../components/ConfirmationDialog.tsx';
import { dateLabel } from '../format.ts';
import { CodexAccount } from '../components/CodexAccount.tsx';
import { DiscoveryInterview } from '../components/DiscoveryInterview.tsx';
export function Discovery({ desktop, project, live, onApproved, onFollow, initialDiscoveryId }: {
  desktop: Desktop; project: Project; live: boolean; onApproved(): void; onFollow(id: string): void; initialDiscoveryId?: string;
}) {
  const view = useDiscovery(desktop, project.projectId, project.configRevision, onApproved);
  const check = view.provider?.check ? record(view.provider.check) : null;
  const [showLaunch, setShowLaunch] = useState(false);
  useEffect(() => { if (showLaunch) document.getElementById('discovery-scope')?.focus(); }, [showLaunch]);
  const [selected, setSelected] = useState<string | null>(initialDiscoveryId ?? null);
  const current = view.items.find(item => item.discoveryId === selected) ?? currentDiscovery(view.items);
  const selectedId = current?.discoveryId;
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
  return <section className="discovery-view" aria-labelledby="discovery-title">
    <div className="section-heading">
      <h3 id="discovery-title">Discovery del progetto</h3>
      <div className="row-actions">
        <button className="text-button" disabled={view.busy || view.loading} onClick={() => void view.refresh()}>Aggiorna Discovery</button>
        {current && discoveryIsRunning(current.state) && <button className="button subtle" onClick={() => onFollow(current.discoveryId)}>Segui agente</button>}
        {selectedId && <button className="button subtle" disabled={!live || view.busy} onClick={() => { setShowLaunch(true); view.newDiscovery(); }}>Nuova Discovery</button>}
      </div>
    </div>
    {view.loading && <p role="status">Lettura dello stato Discovery…</p>}
    {!live && <p className="hint">Ultimo stato noto. Avvia il servizio per preparare o avviare una Discovery.</p>}
    <div id="discovery-error" role={view.error ? 'alert' : undefined} className="field-error">{view.error}</div>
    {view.message && <p role="status" className="hint">{view.message}</p>}
    {view.requestId && <details className="agent-run-details"><summary>Identificativo richiesta</summary><p className="mono">{view.requestId}</p></details>}
    {view.items.length > 1 && <label className="discovery-selector">Discovery salvate
      <select value={selected ?? ''} onChange={event => setSelected(event.target.value || null)}>
        <option value="">Sessione corrente</option>
        {[...view.items].reverse().map(item => <option key={item.discoveryId} value={item.discoveryId}>
          {dateLabel(item.updatedAt)} · {discoveryStateLabels[item.state] ?? item.state}
        </option>)}
      </select>
    </label>}
    {selectedId && <DiscoveryInterview key={selectedId} desktop={desktop} projectId={project.projectId} discoveryId={selectedId} live={live} actions={view} />}
    {(!selectedId || showLaunch) && <>
      {project.observation?.hasCommits === false && <p className="hint">Il repository non ha ancora commit. Aggiungi i file da analizzare e includili nell’anteprima delle fonti.</p>}
      <CodexAccount codex={codex} />
      {(connected || check || checking) && <section className="discovery-provider" aria-label="Disponibilità dell’analisi">
        <p role="status">{availabilityMessage}</p>
        {connected && !checking && <button className="button subtle" disabled={!live || view.busy || view.loading || codex.pending !== null} onClick={() => void verify()}>Verifica disponibilità</button>}
      </section>}
      <DiscoveryLaunch view={view} live={live} checkingProvider={checking || setupError !== null} projectId={project.projectId} configRevision={project.configRevision} />
    </>}
    {view.prepared && <ConfirmationDialog prepared={view.prepared} busy={view.busy} onConfirm={() => void view.confirm()} onCancel={() => void view.cancel()} returnFocus={view.returnFocus} />}
  </section>;
}
