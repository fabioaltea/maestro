import { useState } from 'react';
import { record } from '../../shared/validation.ts';
import type { Params } from '../../shared/bridge-contract.ts';
import type { Desktop } from '../state/desktop.ts';
import { ConfirmationDialog, type PreparedAction } from './ConfirmationDialog.tsx';

export function DiscoveryProviderSettings({ desktop }: { desktop: Desktop }) {
  const { context, core, invoke } = desktop;
  const [provider, setProvider] = useState<Params | null>(null);
  const [binary, setBinary] = useState<{ providerBinaryHandle: string; displayName: string } | null>(null);
  const [model, setModel] = useState('');
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<PreparedAction | null>(null);
  const configuration = provider?.configuration ? record(provider.configuration) : null;
  const check = provider?.check ? record(provider.check) : null;

  async function refresh() {
    const result = await core('getDiscoveryProvider');
    setLive(result?.liveness === 'LIVE_VERIFIED');
    if (result?.result === 'OK') setProvider(result.data);
    else setProvider(null);
  }
  async function choose() {
    setBusy(true);
    try {
      const result = await invoke('chooseProviderBinary');
      if (result) setBinary(record(result).provider as typeof binary);
    } finally { setBusy(false); }
  }
  async function prepare(action: 'discovery.configure' | 'discovery.check') {
    setBusy(true);
    try {
      const params = { expectedProviderRevision: configuration?.revision ?? null,
        ...(action === 'discovery.configure' ? { providerBinaryHandle: binary?.providerBinaryHandle, modelId: model } : {}) };
      setPrepared(await invoke('prepareDiscoveryAction', { action, params }) as PreparedAction | null);
    } finally { setBusy(false); }
  }
  async function finish(confirmed: boolean) {
    if (!prepared) return;
    setBusy(true);
    try {
      const result = await invoke(confirmed ? 'confirmDiscoveryAction' : 'cancelDiscoveryAction', { confirmationId: prepared.confirmationId });
      if (confirmed && result) {
        const outcome = record(record(result).result);
        if (outcome.error) desktop.setNotice(String(record(outcome.error).message));
        await refresh();
      }
    } finally { setPrepared(null); setBusy(false); }
  }

  return <details className="discovery-provider" onToggle={event => {
    if (event.currentTarget.open && context && !provider) void refresh();
  }}>
    <summary>Configurazione avanzata di Codex</summary>
    <p>{configuration ? `Codex CLI ${configuration.binaryVersion} · ${configuration.modelId}` : 'Provider non configurato'}</p>
    {check && <p className="hint">{String(check.state)}{check.code ? ` · ${String(check.code)}` : ''}</p>}
    <button className="button subtle" disabled={!context || busy} onClick={() => void refresh()}>Aggiorna stato provider</button>
    <button className="button subtle" disabled={!live || busy} onClick={() => void choose()}>Scegli binario Codex</button>
    {binary && <p className="hint">Selezionato {binary.displayName}</p>}
    <form onSubmit={event => { event.preventDefault(); if (binary) void prepare('discovery.configure'); }}>
      <label htmlFor="discovery-model">Modello Codex</label>
      <input id="discovery-model" required maxLength={128} pattern="[a-zA-Z0-9][a-zA-Z0-9._:/-]*"
        value={model} disabled={busy} onChange={event => setModel(event.target.value)} />
      <button className="button" disabled={!live || busy || !binary || !model}>Configura provider</button>
    </form>
    <button className="button subtle" disabled={!live || busy || !configuration} onClick={() => void prepare('discovery.check')}>Verifica provider e login</button>
    {prepared && <ConfirmationDialog prepared={prepared} busy={busy} onConfirm={() => void finish(true)} onCancel={() => void finish(false)} />}
  </details>;
}
