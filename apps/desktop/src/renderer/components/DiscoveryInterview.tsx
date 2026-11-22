import { DiscoveryTerminal } from './DiscoveryTerminal.tsx';
import { DiscoveryReview } from '../views/DiscoveryReview.tsx';
import { useState } from 'react';
import type { Desktop } from '../state/desktop.ts';
import { discoveryIsRunning, discoveryStateLabels, useDiscoverySession } from '../state/discovery.ts';
import type { InterviewQuestion, useDiscovery } from '../state/discovery.ts';
function Question({ question, canAnswer, onAnswer }: { question: InterviewQuestion; canAnswer: boolean; onAnswer(kind: 'ANSWER' | 'UNKNOWN', text: string): void }) {
  const [answer, setAnswer] = useState(question.answer?.text ?? ''), [error, setError] = useState<string | null>(null);
  const id = `answer-${question.questionId}`;
  function send(kind: 'ANSWER' | 'UNKNOWN') {
    const text = kind === 'UNKNOWN' ? '' : answer;
    if (kind === 'ANSWER' && !text.trim() || new TextEncoder().encode(text).byteLength > 4096) { setError('Scrivi una risposta entro 4 KiB, oppure scegli Non so.'); return; }
    setError(null); onAnswer(kind, text);
  }
  return <article className="discovery-question"><h5>{question.text}</h5><p className="hint">{question.reason}</p>
    {question.answer && <p className="hint">{question.answer.kind === 'UNKNOWN' ? 'UNKNOWN confermato' : `Risposta confermata · revisione ${question.answer.revision}`}</p>}
    <form onSubmit={e => { e.preventDefault(); send('ANSWER'); }}><label htmlFor={id}>Risposta a: {question.text}</label>
      <textarea id={id} rows={3} disabled={!canAnswer} value={answer} onChange={e => setAnswer(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={`${id}-help ${id}-error`} />
      <p id={`${id}-help`} className="hint">Massimo 4 KiB. L’invio continua l’analisi con le fonti già autorizzate.</p><p id={`${id}-error`} role={error ? 'alert' : undefined} className="field-error">{error}</p>
      <div className="row-actions"><button className="button primary" disabled={!canAnswer}>{question.answer ? 'Aggiorna risposta e continua' : 'Invia e continua'}</button><button type="button" className="button subtle" disabled={!canAnswer} onClick={() => send('UNKNOWN')}>Non so</button></div>
    </form></article>;
}
export function DiscoveryInterview({ desktop, projectId, discoveryId, live, actions }: { desktop: Desktop; projectId: string; discoveryId: string; live: boolean; actions: ReturnType<typeof useDiscovery> }) {
  const view = useDiscoverySession(desktop, projectId, discoveryId, actions.busy || actions.prepared !== null, live), d = view.session;
  return <section className="discovery-session" aria-labelledby="session-title"><div className="section-heading"><h4 id="session-title">Analisi e intervista</h4><button className="text-button" disabled={actions.busy} onClick={view.refresh}>Aggiorna sessione</button></div>
    {d ? <><p role="status">{discoveryStateLabels[d.state] ?? d.state}</p>{d.error && <p className="field-error">{d.error}</p>}</> : <p role="status" className="hint">Lettura della sessione…</p>}
    {view.failure && <p role="alert" className="field-error">{view.failure}</p>}
    <DiscoveryTerminal key={d?.currentRunId ?? 'pending'} ring={view.ring}
      live={live && view.freshness !== 'LAST_KNOWN' && d !== null && discoveryIsRunning(d.state)} />
    {view.questions.map(question => <Question key={`${question.questionId}:${question.answer?.revision ?? '0'}`} question={question} canAnswer={live && d?.state === 'WAITING_USER' && !actions.busy && !actions.prepared} onAnswer={(kind, text) => d && void actions.prepare('discovery.answer', { projectId, discoveryId, questionId: question.questionId, expectedStateRevision: d.stateRevision, expectedQuestionRevision: question.revision, expectedAnswerRevision: question.answer?.revision ?? '0', kind, text })} />)}
    {d && ['RUNNING', 'WAITING_USER', 'READY_FOR_REVIEW', 'CANCELLING', 'RECONCILING'].includes(d.state) && <button className="button subtle" disabled={!live || actions.busy} onClick={() => void actions.prepare('discovery.cancel', { projectId, discoveryId, expectedStateRevision: d.stateRevision })}>Annulla Discovery</button>}
    {d?.latestDocumentRevisionId && <DiscoveryReview key={`${d.discoveryId}:${d.latestDocumentRevisionId}`} desktop={desktop} session={d} live={live} actions={actions} />}
    {d && <details className="agent-run-details"><summary>Identificativi della sessione</summary>
      <dl><dt>Sessione</dt><dd className="mono">{d.sessionId}</dd>
        <dt>Esecuzione</dt><dd className="mono">{d.currentRunId ?? 'In attesa'}</dd></dl>
    </details>}
  </section>;
}
