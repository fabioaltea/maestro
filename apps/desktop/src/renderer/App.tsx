import { useEffect, useState } from 'react';
export function App() {
  const [message, setMessage] = useState('Connessione al client locale…');
  useEffect(() => { void window.maestro.context({ bridgeVersion: 1, callId: crypto.randomUUID(), selectionEpoch: 0 }).then(r => setMessage(r.error?.message ?? 'Scegli un archivio per consultare i progetti locali.')).catch(() => setMessage('Client locale non disponibile.')); }, []);
  return <main><h1>Maestro</h1><p role="status">{message}</p></main>;
}
