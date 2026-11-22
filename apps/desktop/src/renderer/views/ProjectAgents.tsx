import { useEffect, useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import type { PublicResult } from '../../shared/bridge-contract.ts';
import type { ExecutionAgentRun } from '../../shared/execution-contract.ts';
import { discoveryAgentStatus, discoveryIsRunning, readDiscoveryHistory } from '../state/discovery.ts';
import { DiscoveryActivity } from './Agents.tsx';
import { ExecutionActivity, executionAgentName, executionStatus, type ExecutionActivitySummary } from '../components/ExecutionActivity.tsx';

interface ExecutionEntry { session: ExecutionActivitySummary; agent: ExecutionAgentRun; live: boolean }
type Selection = { discoveryId: string } | ExecutionEntry;

export function ProjectAgents({ desktop, projectId, initialDiscoveryId, onDiscovery }: {
  desktop: Desktop; projectId: string; initialDiscoveryId: string | null; onDiscovery(id: string): void;
}) {
  const { invoke } = desktop;
  const [history, setHistory] = useState<Awaited<ReturnType<typeof readDiscoveryHistory>>>(null);
  const [execution, setExecution] = useState<ExecutionEntry | null>(null);
  const [selection, setSelection] = useState<Selection | null>(initialDiscoveryId ? { discoveryId: initialDiscoveryId } : null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const selectedDiscovery = selection && 'discoveryId' in selection
    ? history?.items.find(item => item.discoveryId === selection.discoveryId) : undefined;
  const selectedExecution = selection && 'session' in selection ? selection : null;
  const watching = Boolean(selectedDiscovery || selectedExecution);

  useEffect(() => {
    if (watching) return;
    let disposed = false, timer: ReturnType<typeof setTimeout>;
    const read: Desktop['core'] = async (method, params) => await invoke(method, params) as PublicResult | null;
    async function check() {
      try {
        if (document.visibilityState !== 'visible') return;
        const discovered = await readDiscoveryHistory(read, projectId, () => !disposed);
        if (disposed) return;
        if (discovered) setHistory(discovered);
        else setHistory(previous => previous && { ...previous, live: false });
        const reply = await read('listExecutionSessions', { projectId, activeOnly: true });
        if (disposed) return;
        if (reply?.result === 'OK') {
          const session = (reply.data.items as ExecutionActivitySummary[])[0];
          const agent = reply.data.agent as ExecutionAgentRun | null | undefined;
          setExecution(session?.projectId === projectId && agent?.runId === session.runId
            ? { session, agent, live: reply.liveness === 'LIVE_VERIFIED' } : null);
        } else setExecution(previous => previous && { ...previous, live: false });
        setLoading(false);
        setUnavailable(!discovered || reply?.result !== 'OK');
      } finally {
        if (!disposed) timer = setTimeout(() => void check(), 5000);
      }
    }
    void check();
    return () => { disposed = true; clearTimeout(timer); };
  }, [invoke, projectId, watching]);

  const discoveries = history?.items.filter(item =>
    discoveryIsRunning(item.state) || ['WAITING_USER', 'RECONCILING'].includes(item.state)) ?? [];
  const discoveryLive = history?.live === true;
  const sessionStatus = execution ? executionStatus(execution.session, execution.agent, execution.live) : null;
  return <section className="project-agents" aria-labelledby="project-agents-title">
    <div className="section-heading">
      <h3 id="project-agents-title">{watching ? 'Dettaglio agente' : 'Agenti attivi'}</h3>
      {watching && <button className="text-button" onClick={() => setSelection(null)}>Torna agli agenti</button>}
    </div>
    {selectedDiscovery ? <DiscoveryActivity key={selectedDiscovery.discoveryId} desktop={desktop}
      projectId={projectId} discovery={selectedDiscovery} live={discoveryLive} onDiscovery={onDiscovery} />
      : selectedExecution ? <ExecutionActivity key={selectedExecution.session.sessionId} desktop={desktop}
        summary={selectedExecution.session} agent={selectedExecution.agent} live={selectedExecution.live} />
      : <>
        {loading && <p className="hint" role="status">Lettura degli agenti…</p>}
        {unavailable && <p className="hint" role="status">Parte dello stato degli agenti non è disponibile.</p>}
        {!loading && !unavailable && !discoveries.length && !execution && <p className="hint">Nessun agente attivo per questo repository.</p>}
        {(discoveries.length > 0 || execution) && <ul className="project-agent-list">
          {discoveries.map(item => {
            const status = discoveryAgentStatus(item, discoveryLive);
            return <li key={item.discoveryId}>
              <button className="project-agent-row" onClick={() => setSelection({ discoveryId: item.discoveryId })}>
                <span><strong>Project Architect</strong><small>{item.agentRun?.providerId === 'codex' ? 'Codex · ' : item.agentRun?.providerId ? `${item.agentRun.providerId} · ` : ''}{item.agentRun?.modelId ?? 'Modello in attesa'}</small></span>
                <span className="agent-task">Discovery della codebase</span>
                <span className="agent-status" data-active={status === 'Attivo'}>{status}</span>
              </button>
            </li>;
          })}
          {execution && <li>
            <button className="project-agent-row" onClick={() => setSelection(execution)}>
              <span><strong>{executionAgentName(execution.agent)}</strong><small>{execution.agent.modelId ?? 'Modello non disponibile'}</small></span>
              <span className="agent-task">{execution.agent.featureTitle ?? 'Implementazione feature'}</span>
              <span className="agent-status" data-active={sessionStatus === 'Attivo'}>{sessionStatus}</span>
            </button>
          </li>}
        </ul>}
      </>}
  </section>;
}
