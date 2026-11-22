import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { Params } from '../../shared/bridge-contract.ts';
import type { ExecutionAgentRun } from '../../shared/execution-contract.ts';
import { appendDiscoveryOutput, type DiscoveryRing } from '../state/discovery.ts';
import { AgentTerminal } from './AgentTerminal.tsx';

export interface ExecutionActivitySummary {
  sessionId: string; projectId: string; runId: string; state: string;
}

const states: Record<string, string> = {
  CREATED: 'In avvio', WAITING_USER: 'Attende risposta', PAUSING: 'Sospensione in corso', PAUSED: 'In pausa',
  CANCELLING: 'Annullamento in corso', CANCELLED: 'Annullata', READY_FOR_REVIEW: 'Da revisionare', FAILED: 'Non riuscita',
  INTERRUPTED: 'Interrotta', RECONCILING: 'Esito incerto',
};

export function executionStatus(session: ExecutionActivitySummary, agent: ExecutionAgentRun, live: boolean) {
  if (!live) return 'Ultimo stato noto';
  return session.state === 'RUNNING' && agent.phase === 'RUNNING' ? 'Attivo' : states[session.state] ?? 'In aggiornamento';
}

export function executionAgentName(agent: ExecutionAgentRun) {
  return agent.providerId === 'codex' ? 'Codex' : 'Claude';
}

const emptyRing: DiscoveryRing = { text: '', lastSeq: '0', truncated: false };

export function ExecutionActivity({ desktop, summary, agent, live }: {
  desktop: Desktop; summary: ExecutionActivitySummary; agent: ExecutionAgentRun; live: boolean;
}) {
  const { core } = desktop;
  const [current, setCurrent] = useState({ session: summary, agent, live });
  const [ring, setRing] = useState(emptyRing);
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    let runId = summary.runId, cursor: string | null = null, output = emptyRing;
    async function tick() {
      let more = false, active = live;
      try {
        if (document.visibilityState !== 'visible') return;
        const reply = await core('getExecutionSession', { sessionId: summary.sessionId });
        if (disposed) return;
        if (reply?.result !== 'OK') { setFailure(true); return; }
        const session = reply.data.session as ExecutionActivitySummary;
        const activity = reply.data.agent as ExecutionAgentRun | undefined;
        if (session.projectId !== summary.projectId || session.sessionId !== summary.sessionId || !activity || activity.runId !== session.runId) throw new Error('STALE_CONTEXT');
        active = reply.liveness === 'LIVE_VERIFIED';
        if (runId !== session.runId) { runId = session.runId; cursor = null; output = emptyRing; setRing(output); }
        setCurrent({ session, agent: activity, live: active });
        const page = await core('listExecutionOutput', { runId, ...(cursor ? { cursor } : {}) });
        if (disposed) return;
        if (page?.result !== 'OK' || page.data.runId !== runId) throw new Error('STALE_CONTEXT');
        for (const chunk of page.data.chunks as Params[]) {
          if (BigInt(String(chunk.seq)) <= BigInt(output.lastSeq)) continue;
          const read = await core('getExecutionArtifact', { artifactId: chunk.artifactId });
          if (disposed) return;
          if (read?.result !== 'OK' || read.data.artifactId !== chunk.artifactId || read.data.sha256 !== chunk.sha256 ||
              read.data.totalBytes !== chunk.bytes || read.data.offset !== 0 || read.data.nextCursor !== null) throw new Error('ARTIFACT_CORRUPT');
          output = appendDiscoveryOutput(output, [{ runId, seq: chunk.seq, data: read.data.base64, byteLength: chunk.bytes }], runId);
          setRing(output);
        }
        if (page.data.truncated === true) { output = { ...output, truncated: true }; setRing(output); }
        if (typeof page.data.nextCursor === 'string') cursor = page.data.nextCursor;
        more = output.lastSeq !== page.data.watermark;
        setFailure(false);
      } catch { if (!disposed) setFailure(true); }
      finally {
        if (!disposed && (active || more)) timer = setTimeout(() => void tick(), more ? 0 : 1000);
      }
    }
    void tick();
    return () => { disposed = true; clearTimeout(timer); };
  }, [core, summary.sessionId, summary.projectId, summary.runId, live]);

  return <section className="agent-discovery" aria-label="Dettaglio sessione agente">
    <div className="agent-run-heading"><div>
      <h3>{current.agent.featureTitle ?? 'Implementazione feature'}</h3>
      <p className="hint">{executionAgentName(current.agent)} · {current.agent.modelId ?? 'Modello non disponibile'}</p>
      <p role="status">{executionStatus(current.session, current.agent, current.live && !failure)}</p>
    </div></div>
    {failure && <p role="status" className="field-error">Output della sessione temporaneamente non disponibile.</p>}
    <AgentTerminal key={current.agent.runId} ring={ring} live={current.live && !failure && current.agent.phase === 'RUNNING' && current.session.state !== 'RECONCILING'} discovery={false} />
  </section>;
}
