import { useEffect, useRef, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { DiscoverySession, InterviewQuestion, useDiscovery } from '../state/discovery.ts';
import type { Params } from '../../shared/bridge-contract.ts';
import { record } from '../../shared/validation.ts';
import { createDiscoveryReadFence } from '../state/discovery-fence.ts';
import { dateLabel } from '../format.ts';
interface Claim { kind: string; text: string; reason: string | null; sources: { sourceId: string; startLine: number; endLine: number; quote: string | null }[]; answers: { answerId: string; revision: string }[] }
interface Section { id: string; title: string; claims: Claim[] }
export function DiscoveryReview({ desktop, session: d, live, actions }: { desktop: Desktop; session: DiscoverySession; live: boolean; actions: ReturnType<typeof useDiscovery> }) {
  const [sections, setSections] = useState<Section[]>([]), [revision, setRevision] = useState<Params | null>(null), [approval, setApproval] = useState<Params | null>(null), [sources, setSources] = useState<Params[]>([]), [required, setRequired] = useState<{ id: string; text: string }[]>([]), [accepted, setAccepted] = useState<string[]>([]), [correction, setCorrection] = useState(''), [error, setError] = useState<string | null>(null), [eligibility, setEligibility] = useState<Params | null>(null), [checking, setChecking] = useState(false);
  const identity = { epoch: desktop.context?.selectionEpoch ?? 0, storeId: desktop.context?.storeId ?? null, projectId: d.projectId, discoveryId: d.discoveryId, runId: d.currentRunId, revisionId: d.latestDocumentRevisionId };
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const loaded = useRef<string | null>(null);
  const { core } = desktop, revisionId = d.latestDocumentRevisionId;
  useEffect(() => {
    const fence = createDiscoveryReadFence(identity, () => currentIdentity.current);
    if (actions.busy || actions.prepared) return;
    if (loaded.current !== revisionId) { setRevision(null); setSections([]); setAccepted([]); setEligibility(null); } setError(null);
    async function load() {
      if (!revisionId || actions.busy || actions.prepared) return;
      const metadata = await core('getDiscoveryDocument', { revisionId }); if (!fence.current()) return;
      if (!metadata || metadata.result !== 'OK') throw new Error('Revisione non disponibile.');
      const r = record(metadata.data.revision); if (r.revisionId !== revisionId || r.discoveryId !== d.discoveryId) throw new Error('Revisione non corrispondente.');
      let cursor: string | null = null, offset = 0; const chunks: Uint8Array[] = [];
      do {
        const page = await core('getDiscoveryDocument', { revisionId, content: true, ...(cursor ? { cursor } : {}) }); if (!fence.current()) return;
        if (!page || page.result !== 'OK' || page.data.revisionId !== revisionId) throw new Error('Documento non disponibile.');
        const c = record(page.data.chunk), bytes = Uint8Array.from(atob(String(c.data)), x => x.charCodeAt(0));
        if (c.offset !== offset || c.totalBytes !== r.bytes || c.sha256 !== r.bundleDigest || bytes.length !== c.byteLength || bytes.length > 8192 || !bytes.length || offset + bytes.length > 262144) throw new Error('Documento incompleto.');
        chunks.push(bytes); offset += bytes.length; cursor = page.data.nextCursor as string | null;
      } while (cursor);
      if (offset !== r.bytes) throw new Error('Documento incompleto.');
      const body = new Uint8Array(offset); let start = 0; for (const chunk of chunks) { body.set(chunk, start); start += chunk.length; }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', body)), x => x.toString(16).padStart(2, '0')).join(''); if (!fence.current()) return;
      if (digest !== r.bundleDigest) throw new Error('Digest del documento non valido.');
      const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) as { kind: string; sections: Section[] };
      if (doc.kind !== 'DOCUMENT' || !Array.isArray(doc.sections) || doc.sections.length > 20 || doc.sections.reduce((n, s) => n + s.claims.length, 0) > 200) throw new Error('Documento non valido.');
      const unknowns = doc.sections.flatMap(s => s.claims.flatMap((c, i) => c.kind === 'UNKNOWN' ? [{ id: `${s.id}:${i}`, text: c.text }] : []));
      const qs = await core('getDiscoveryQuestions', { discoveryId: d.discoveryId }); if (!fence.current()) return;
      if (qs?.result !== 'OK') throw new Error('Domande non disponibili.');
      unknowns.push(...(qs.data.items as InterviewQuestion[]).filter(q => q.status === 'OPEN').map(q => ({ id: q.questionId, text: q.text })));
      const paths: Params[] = []; cursor = null;
      do { const page = await core('getDiscoveryPreview', { snapshotId: d.snapshotId, sources: true, ...(cursor ? { cursor } : {}) }); if (!fence.current()) return;
        if (!page || page.result !== 'OK') throw new Error('Fonti non disponibili.'); paths.push(...page.data.items as Params[]); if (paths.length > 200) throw new Error('Troppe fonti.'); cursor = page.data.nextCursor as string | null;
      } while (cursor);
      loaded.current = revisionId; setRevision(r); setApproval(metadata.data.approval as Params | null); setSections(doc.sections); setSources(paths); setRequired(unknowns);
    }
    void load().catch(e => { if (fence.current()) setError(e instanceof Error ? e.message : 'Documento non disponibile.'); });
    return () => { fence.close(); };
  }, [core, revisionId, d.discoveryId, d.snapshotId, d.stateRevision, actions.busy, actions.prepared]);
  useEffect(() => {
    if (!eligibility?.checkId || eligibility.reason !== 'CHECKING' || !live || actions.busy || actions.prepared) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { if (document.visibilityState === 'visible') { const result = await core('getDiscoveryEligibility', { projectId: d.projectId, checkId: eligibility.checkId }); if (!disposed && result?.result === 'OK') setEligibility(result.data); } }
      finally { if (!disposed) timer = setTimeout(() => void poll(), 1000); }
    };
    timer = setTimeout(() => void poll(), 1000); return () => { disposed = true; clearTimeout(timer); };
  }, [core, d.projectId, eligibility?.checkId, eligibility?.reason, live, actions.busy, actions.prepared]);
  async function check() { setChecking(true); try { const result = await core('getDiscoveryEligibility', { projectId: d.projectId }); if (result?.result === 'OK') setEligibility(result.data); } finally { setChecking(false); } }
  const base = revision ? { projectId: d.projectId, discoveryId: d.discoveryId, expectedStateRevision: d.stateRevision, revisionId: revision.revisionId, bundleDigest: revision.bundleDigest } : null;
  return <section className="discovery-review" aria-labelledby="review-title"><h4 id="review-title">Conoscenza del progetto</h4>
    <p className="hint">Le citazioni e le risposte sono verificate come riferimenti. La correttezza delle conclusioni richiede la tua revisione.</p>
    {error && <p role="alert" className="field-error">{error}</p>}
    {revision && <><p className="mono">Revisione {String(revision.revisionNumber)} · {revisionId}<br />Digest: {String(revision.bundleDigest)}<br />Contesto: {String(revision.contextDigest)}</p>
      {approval && <p className="hint">Approvazione storica: {dateLabel(String(approval.approvedAt))}. L’idoneità attuale richiede una nuova verifica.</p>}
      {sections.map(s => <section key={s.id}><h5>{s.title}</h5>{s.claims.map((c, i) => <article key={i}><p><strong>{c.kind}</strong> · {c.text}</p>{c.reason && <p className="hint">{c.reason}</p>}{c.sources.map((ref, j) => <p key={j} className="mono">{String(sources.find(p => p.sourceId === ref.sourceId)?.relativePath ?? ref.sourceId)}:{ref.startLine}–{ref.endLine}{ref.quote && <><br />{ref.quote}</>}</p>)}{c.answers.map((ref, j) => <p key={j} className="mono">Risposta confermata: {ref.answerId} · revisione {ref.revision}</p>)}</article>)}</section>)}
      {d.state === 'READY_FOR_REVIEW' && <fieldset disabled={!live || actions.busy}><legend>Informazioni ancora sconosciute</legend>{required.map(item => <label key={item.id}><input type="checkbox" checked={accepted.includes(item.id)} onChange={e => setAccepted(old => e.target.checked ? [...old, item.id] : old.filter(id => id !== item.id))} />Accetto UNKNOWN: {item.text}</label>)}</fieldset>}
      {['READY_FOR_REVIEW', 'APPROVED'].includes(d.state) && <form onSubmit={e => { e.preventDefault(); if (base && correction.trim() && new TextEncoder().encode(correction).length <= 4096) void actions.prepare('discovery.correct', { ...base, correction }); else setError('Scrivi una correzione entro 4 KiB.'); }}><label htmlFor="discovery-correction">Correzione alla revisione</label><textarea id="discovery-correction" rows={3} disabled={!live || actions.busy} value={correction} onChange={e => setCorrection(e.target.value)} /><button className="button subtle" disabled={!live || actions.busy}>Invia correzione</button></form>}
      {d.state === 'READY_FOR_REVIEW' && <button className="button primary" disabled={!live || actions.busy || accepted.length !== required.length} onClick={() => base && void actions.prepare('discovery.approve', { ...base, acceptedUnknownIds: required.map(r => r.id) })}>Approva questa revisione</button>}
      <button className="button subtle" disabled={!live || actions.busy || checking || eligibility?.reason === 'CHECKING'} onClick={() => void check()}>Verifica idoneità attuale</button>
      {eligibility && <p role="status">{eligibility.eligible ? 'Idonea nel contesto verificato' : eligibility.reason === 'CHECKING' ? 'Verifica in corso…' : 'Idoneità non confermata'} · {dateLabel(eligibility.checkedAt as string | null)}{eligibility.contextDigest ? ` · Contesto: ${eligibility.contextDigest}` : ''}</p>}
    </>}
  </section>;
}
