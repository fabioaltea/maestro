import { useLayoutEffect, useRef } from 'react';
import type { DiscoveryRing } from '../state/discovery.ts';

export function DiscoveryTerminal({ ring, live }: { ring: DiscoveryRing; live: boolean }) {
  const output = useRef<HTMLPreElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    const panel = output.current;
    if (panel && following.current) panel.scrollTop = panel.scrollHeight;
  }, [ring.text]);

  return <section className="discovery-terminal" aria-label="Terminale Discovery">
    <header><h4>Output dell’analisi</h4><span>{live ? 'In diretta' : 'Archivio'}</span></header>
    <pre ref={output} className="discovery-output" tabIndex={0} aria-label="Output Discovery"
      onScroll={({ currentTarget: panel }) => { following.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24; }}>
      {ring.text || (live ? 'In attesa dell’output del provider…' : 'Nessun output disponibile.')}
    </pre>
    {ring.truncated && <p className="hint">Output parziale. La vista mostra fino a 500 righe e 1 MiB.</p>}
  </section>;
}
