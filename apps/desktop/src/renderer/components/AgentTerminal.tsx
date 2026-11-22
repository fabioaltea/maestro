import { useLayoutEffect, useRef } from 'react';
import type { DiscoveryRing } from '../state/discovery.ts';

export function AgentTerminal({ ring, live, discovery = true }: { ring: DiscoveryRing; live: boolean; discovery?: boolean }) {
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const panel = output.current;
    if (panel && following.current) panel.scrollTop = panel.scrollHeight;
  }, [ring.text]);

  return <section className="discovery-terminal" aria-label={discovery ? 'Terminale Discovery' : 'Terminale sessione agente'}>
    <header><h4>{discovery ? 'Output dell’analisi' : 'Output della sessione'}</h4><span>{live ? 'In diretta' : 'Archivio'}</span></header>
    <pre ref={output} className="discovery-output" tabIndex={0} aria-label={discovery ? 'Output Discovery' : 'Output sessione agente'}
      onScroll={({ currentTarget: panel }) => { following.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24; }}>
      {ring.text || (live ? 'In attesa dell’output del provider…' : 'Nessun output disponibile.')}
    </pre>
    {ring.truncated && <p className="hint">Output parziale. La vista mostra fino a 500 righe e 1 MiB.</p>}
  </section>;
}
