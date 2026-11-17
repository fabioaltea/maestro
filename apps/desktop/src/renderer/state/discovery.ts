import { useCallback, useEffect, useRef, useState } from 'react';
import type { Desktop } from './desktop.ts';
import type { Params, PublicResult } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
import type { PreparedAction } from '../components/ConfirmationDialog.tsx';
export interface DiscoverySnapshot {
  snapshotId: string; projectId: string; configRevision: string; contextDigest: string; state: string;
  selectors: string[]; fileCount: number; byteCount: number; omissions: string[]; expiresAtMs: number;
}
export interface DiscoverySummary { discoveryId: string; sessionId: string; currentRunId: string | null; state: string; updatedAt: string; error: string | null }
export function parseDiscoveryScope(value: string): string[] {
  const selectors = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!selectors.length || selectors.length > 16 || new Set(selectors).size !== selectors.length || selectors.some(s => s.normalize('NFC') !== s || s !== '.' && (s.startsWith('/') || /[\x00-\x1f\x7f\\]/.test(s) || s.split('/').some(p => !p || p === '.' || p === '..')))) throw new Error('Indica da 1 a 16 percorsi relativi distinti, uno per riga.');
  if (new TextEncoder().encode(JSON.stringify(selectors)).byteLength > 24000) throw new Error('L’ambito è troppo grande. Seleziona meno percorsi.');
  return selectors;
}
export function discoveryCanStart(provider: Params | null, snapshot: DiscoverySnapshot | null, live: boolean, configRevision: string, now: number) {
  if (!live || !provider || !snapshot || snapshot.state !== 'SEALED' || snapshot.configRevision !== configRevision || snapshot.expiresAtMs <= now) return false;
  const configuration = provider.configuration ? record(provider.configuration) : null, check = provider.check ? record(provider.check) : null;
  return Boolean(configuration && check?.state === 'AVAILABLE' && check.capabilities && record(check.capabilities).readOnlyAnalysis === true);
}
export function useDiscovery(desktop: Desktop, projectId: string, configRevision: string) {
  const [provider, setProvider] = useState<Params | null>(null), [items, setItems] = useState<DiscoverySummary[]>([]);
  const [snapshot, setSnapshot] = useState<DiscoverySnapshot | null>(null), [sources, setSources] = useState<Params[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedAction | null>(null), [busy, setBusy] = useState(false), [pending, setPending] = useState<{ id: string; action: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(true);
  const [requestId, setRequestId] = useState<string | null>(null);
  const active = useRef(false), working = useRef(false), reading = useRef(false), trigger = useRef<HTMLElement | null>(null);
  const { core, invoke } = desktop;
  const refresh = useCallback(async () => {
    const p = await core('getDiscoveryProvider'); if (!active.current) return;
    if (p?.result === 'OK') setProvider(p.data);
    const history: DiscoverySummary[] = []; let cursor: string | null = null;
    do { const list = await core('listDiscoveries', { projectId, ...(cursor ? { cursor } : {}) }); if (!active.current) return;
      if (!list || list.result !== 'OK') return; history.push(...list.data.items as DiscoverySummary[]); if (history.length > 100) throw new Error('CLIENT_PROTOCOL_ERROR'); cursor = list.data.nextCursor as string | null;
    } while (cursor);
    setItems(history);
    setLoading(false);
  }, [core, projectId]);
  useEffect(() => { active.current = true; void refresh(); return () => { active.current = false; }; }, [refresh]);
  async function readSources(id: string, next?: string) {
    const result = await core('getDiscoveryPreview', { snapshotId: id, sources: true, ...(next ? { cursor: next } : {}) });
    if (!active.current || result?.result !== 'OK') return;
    setSources(result.data.items as Params[]); setCursor(result.data.nextCursor as string | null);
  }
  const poll = useCallback(async (request: { id: string; action: string }) => {
    if (reading.current || !active.current) return; reading.current = true;
    try {
      const result = await core('getDiscoveryOperation', { requestId: request.id }); if (!active.current) return;
      if (!result?.data.operation) { setPending(null); setError('Esito incerto. Consulta la richiesta originale in Operazioni. Nessun nuovo invio automatico.'); return; }
      const operation = record(result.data.operation);
      if (operation.requestId !== request.id || operation.action !== request.action) { setPending(null); setError('L’esito non corrisponde alla richiesta originale. Consulta Operazioni.'); return; }
      if (operation.outcome === 'UNKNOWN') { setPending(null); setError('Esito incerto. Consulta la richiesta originale in Operazioni.'); await refresh(); return; }
      if (operation.phase !== 'FINALIZED') return;
      setPending(null); await invoke('reconcileOperation', { receiptId: request.id }); if (!active.current) return;
      if (operation.outcome !== 'SUCCEEDED') { setError(result.error?.message ?? 'Operazione bloccata. Consulta Operazioni per l’esito originale.'); return; }
      const output = operation.result ? record(operation.result) : {};
      if (request.action === 'preview' && typeof output.snapshotId === 'string') {
        const preview = await core('getDiscoveryPreview', { snapshotId: output.snapshotId }); if (!active.current) return;
        if (preview?.result === 'OK') { setSnapshot(preview.data.snapshot as DiscoverySnapshot); await readSources(output.snapshotId); }
        setMessage('Anteprima locale pronta. Rivedi le fonti prima di autorizzare l’invio.');
      } else if (request.action === 'discard') { setSnapshot(null); setSources([]); setCursor(null); setMessage('Anteprima scartata.'); }
      else setMessage(request.action === 'start' ? 'Richiesta accettata: la Discovery è stata avviata. L’analisi non è ancora completata.' : 'Operazione completata.');
      await refresh();
    } finally { reading.current = false; }
  }, [core, invoke, refresh]);
  useEffect(() => {
    if (!pending) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => { try { if (document.visibilityState === 'visible') await poll(pending); } finally { if (!disposed) timer = setTimeout(() => void tick(), 1000); } };
    timer = setTimeout(() => void tick(), 1000);
    return () => { disposed = true; clearTimeout(timer); };
  }, [pending, poll]);
  async function prepare(action: string, params: Params) {
    if (working.current || pending) return; working.current = true; setBusy(true); setError(null); setMessage(null); trigger.current = document.activeElement as HTMLElement | null;
    try { await invoke('releaseViewReads'); const result = await invoke('prepareDiscoveryAction', { action, params }); if (active.current && result) setPrepared(result as PreparedAction); }
    finally { working.current = false; if (active.current) setBusy(false); }
  }
  async function confirm() {
    if (working.current || !prepared) return; working.current = true; setBusy(true);
    const original = prepared;
    try {
      const value = await invoke('confirmDiscoveryAction', { confirmationId: original.confirmationId }); if (!active.current) return;
      setPrepared(null); if (!value) return;
      setRequestId(original.requestId);
      const result = record(value).result as PublicResult;
      if (result.result === 'UNKNOWN_OUTCOME') { setError('Esito incerto. Consulta la richiesta originale in Operazioni.'); return; }
      if (result.error) { setError(`${result.error.message} ${result.error.nextAction}`); return; }
      setMessage('Richiesta accettata. Verifica dell’esito in corso.');
      setPending({ id: original.requestId, action: original.action.replace('discovery.', '').replace('provider.configure', 'configure').replace('provider.check', 'check').replace('preview.discard', 'discard') });
    } finally { working.current = false; if (active.current) setBusy(false); }
  }
  async function cancel() { if (!prepared || working.current) return; const id = prepared.confirmationId; setPrepared(null); await invoke('cancelDiscoveryAction', { confirmationId: id }); }
  return { provider, items, snapshot, sources, cursor, prepared, busy: busy || pending !== null, loading, message, error, requestId, setError, refresh,
    prepare, confirm, cancel, newDiscovery: () => { setSnapshot(null); setSources([]); setCursor(null); setMessage('Prepara una nuova anteprima, poi autorizza esplicitamente la nuova Discovery. Lo storico resta conservato.'); document.getElementById('discovery-scope')?.focus(); }, returnFocus: () => trigger.current, moreSources: () => snapshot && cursor ? readSources(snapshot.snapshotId, cursor) : Promise.resolve(),
    preview: (selectors: string[]) => prepare('discovery.preview', { projectId, expectedConfigRevision: configRevision, selectors }) };
}

export interface DiscoveryRing { text: string; lastSeq: string; truncated: boolean }
export function appendDiscoveryOutput(current: DiscoveryRing, chunks: Params[], runId: string): DiscoveryRing {
  let { text, lastSeq, truncated } = current;
  for (const chunk of chunks) {
    if (chunk.runId !== runId || typeof chunk.seq !== 'string' || !/^[1-9][0-9]{0,18}$/.test(chunk.seq) || BigInt(chunk.seq) > 9223372036854775807n) throw new Error('CLIENT_PROTOCOL_ERROR');
    truncated ||= chunk.truncated === true;
    if (BigInt(chunk.seq) <= BigInt(lastSeq)) continue;
    if (BigInt(chunk.seq) !== BigInt(lastSeq) + 1n) throw new Error('CLIENT_PROTOCOL_ERROR');
    const bytes = Uint8Array.from(atob(String(chunk.data)), c => c.charCodeAt(0));
    if (bytes.byteLength !== chunk.byteLength || bytes.byteLength > 8192) throw new Error('CLIENT_PROTOCOL_ERROR');
    text += new TextDecoder('utf-8', { fatal: true }).decode(bytes); lastSeq = chunk.seq; truncated ||= chunk.truncated === true;
  }
  const lines = text.split('\n');
  if (lines.length > 500) { text = lines.slice(-500).join('\n'); truncated = true; }
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength > 1048576) { let start = encoded.byteLength - 1048576; while ((encoded[start]! & 0xc0) === 0x80) start++; text = new TextDecoder().decode(encoded.subarray(start)); truncated = true; }
  return { text, lastSeq, truncated };
}
export interface DiscoverySession extends DiscoverySummary { projectId: string; stateRevision: string; configRevision: string; snapshotId: string; latestDocumentRevisionId: string | null }
export interface InterviewQuestion { questionId: string; discoveryId: string; revision: string; text: string; reason: string; status: string; answer: { revision: string; kind: string; text: string } | null }
export function useDiscoverySession(desktop: Desktop, projectId: string, discoveryId: string, paused: boolean, live: boolean) {
  const [session, setSession] = useState<DiscoverySession | null>(null), [questions, setQuestions] = useState<InterviewQuestion[]>([]), [ring, setRing] = useState<DiscoveryRing>({ text: '', lastSeq: '0', truncated: false });
  const [failure, setFailure] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const state = useRef<{ runId: string | null; cursor: string | null; ring: DiscoveryRing }>({ runId: null, cursor: null, ring: { text: '', lastSeq: '0', truncated: false } });
  const { core, invoke } = desktop;
  useEffect(() => () => { void invoke('releaseViewReads'); }, [invoke]);
  useEffect(() => {
    if (paused) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const result = await core('getDiscovery', { discoveryId }); if (disposed || !result) return;
        if (result.result !== 'OK') { setFailure(result.error?.message ?? 'Stato non disponibile.'); return; }
        const d = result.data.discovery as DiscoverySession;
        if (d.discoveryId !== discoveryId || d.projectId !== projectId) throw new Error('STALE_CONTEXT'); setSession(d);
        if (state.current.runId !== d.currentRunId) { state.current = { runId: d.currentRunId, cursor: null, ring: { text: '', lastSeq: '0', truncated: false } }; setRing(state.current.ring); }
        if (d.currentRunId) {
          const page = await core('getDiscoveryOutput', { runId: d.currentRunId, ...(state.current.cursor ? { cursor: state.current.cursor } : {}) }); if (disposed) return;
          if (page?.result === 'OK') {
            const next = appendDiscoveryOutput(state.current.ring, page.data.items as Params[], d.currentRunId); state.current.ring = next; setRing(next);
            if (page.data.nextCursor) state.current.cursor = String(page.data.nextCursor);
          } else setFailure(page?.error?.message ?? 'Output non disponibile.');
        }
        if (d.state === 'WAITING_USER' || d.state === 'CANCELLED' || d.state === 'INTERRUPTED') {
          let cursor: string | null = null; const all: InterviewQuestion[] = [];
          do {
            const page = await core('getDiscoveryQuestions', { discoveryId, ...(cursor ? { cursor } : {}) }); if (disposed) return;
            if (!page || page.result !== 'OK') break; all.push(...page.data.items as InterviewQuestion[]); cursor = page.data.nextCursor as string | null;
            if (all.length > 20) throw new Error('CLIENT_PROTOCOL_ERROR');
          } while (cursor);
          setQuestions(all);
        }
      } catch { if (!disposed) setFailure('Dati non utilizzabili per questa sessione. Consulta lo stato originale.'); }
      finally { if (!disposed && live) timer = setTimeout(() => void tick(), 1000); }
    };
    timer = setTimeout(() => void tick(), 1000); return () => { disposed = true; clearTimeout(timer); };
  }, [core, projectId, discoveryId, paused, live, refresh]);
  return { session, questions, ring, failure, refresh: () => setRefresh(v => v + 1) };
}
