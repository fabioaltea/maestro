import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightIcon, CommitIcon, FileTextIcon, LockClosedIcon, ReloadIcon, StackIcon } from '@radix-ui/react-icons';
import type { CommitSummary } from '../../shared/repository-history-contract.ts';
import type { Desktop } from '../state/desktop.ts';

type Page = { handle: string; nextCursor: string | null; commits: CommitSummary[] };
type History = Page & { refs: { name: string; oid: string; commit: string | null }[];
  worktrees: { path: string; oid: string | null; branch: string | null; detached: boolean; locked: boolean; unavailable: boolean }[] };
type Detail = { commit: CommitSummary; files: string[]; base: string | null; message: string; nextCursor: string | null };

function lanesFor(commits: CommitSummary[]) {
  let active: string[] = [];
  return commits.map(commit => {
    const lane = active.includes(commit.oid) ? active.indexOf(commit.oid) : active.length;
    const before = [...active];
    const next = before.filter(item => item !== commit.oid);
    let insert = lane;
    for (const parent of commit.parents) if (!next.includes(parent)) next.splice(insert++, 0, parent);
    active = next;
    return { lane, before, next };
  });
}
export function RepositoryHistory({ desktop, projectId }: { desktop: Desktop; projectId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedWorktree, setSelectedWorktree] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const pending = useRef(false);
  const { core } = desktop;

  async function action(work: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    const ticket = ++version.current;
    const current = () => ticket === version.current;
    setBusy(true); setError(null);
    try { await work(current); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  const refresh = () => action(async current => {
    const response = await core('openRepositoryHistory', { projectId });
    if (!current()) return;
    if (response?.result !== 'OK') { setError(response?.error?.message ?? 'Storico non disponibile. Riprova.'); return; }
    setHistory(response.data as History); setDetail(null); setSelectedWorktree(null);
  });
  useEffect(() => {
    void refresh();
    return () => { version.current++; pending.current = false; };
  }, [core, projectId]);
  const showCommit = (oid: string, cursor?: string, worktree: string | null = null) => action(async current => {
    if (!history) return;
    const response = await core('getRepositoryCommit', { projectId, handle: history.handle, oid, ...(cursor ? { cursor } : {}) });
    if (!current()) return;
    if (response?.result !== 'OK') { setError(response?.error?.message ?? 'Dettaglio non disponibile.'); return; }
    const page = response.data as Detail;
    setDetail(cursor && detail ? { ...page, files: [...detail.files, ...page.files] } : page);
    if (!cursor) setSelectedWorktree(worktree);
  });
  const more = () => action(async current => {
    if (!history?.nextCursor) return;
    const response = await core('listRepositoryCommits', { projectId, handle: history.handle, cursor: history.nextCursor });
    if (!current()) return;
    if (response?.result !== 'OK') { setError(response?.error?.message ?? 'Pagina non disponibile.'); return; }
    const page = response.data as Page;
    setHistory({ ...history, ...page, commits: [...history.commits, ...page.commits] });
  });
  const lanes = useMemo(() => lanesFor(history?.commits ?? []), [history?.commits]);
  const graphWidth = 10 + 14 * lanes.reduce((width, row) => Math.max(width, row.before.length, row.next.length, row.lane + 1), 1);
  const selectedPath = history?.worktrees.find(item => item.path === selectedWorktree);
  return <section className="repository-read repository-history" aria-label="Storico Git">
    <header className="repository-read-header"><div className="repository-read-title"><CommitIcon aria-hidden="true" /><h3>Storico Git</h3></div>
      <button className="repository-read-action" disabled={busy} onClick={() => void refresh()}><ReloadIcon aria-hidden="true" />Aggiorna storico</button></header>
    {busy && <span className={history ? 'visually-hidden' : 'repository-pane-message'} role="status">Lettura in corso…</span>}
    {error && <p className="repository-read-alert" role="alert">{error}{history && ' I dati mostrati appartengono all’ultima lettura riuscita.'}</p>}
    {history && <>
      <section className="repository-worktree-deck" aria-labelledby="repository-worktree-title">
        <header className="repository-panel-heading"><StackIcon aria-hidden="true" /><h4 id="repository-worktree-title">Worktree</h4><span>{history.worktrees.length}</span></header>
        {history.worktrees.length ? <ul className="repository-worktrees">{history.worktrees.map(item => <li key={item.path}>
          <button className="repository-worktree" aria-pressed={selectedWorktree === item.path}
            disabled={busy || !item.oid || item.unavailable} title={item.path}
            onClick={() => item.oid && void showCommit(item.oid, undefined, item.path)}>
            <span className="repository-worktree-top"><strong>{item.path.split('/').filter(Boolean).at(-1) ?? item.path}</strong>
              {item.locked ? <LockClosedIcon aria-label="Bloccato" /> : item.oid && !item.unavailable ? <ArrowRightIcon aria-hidden="true" /> : null}</span>
            <span className="repository-worktree-path">{item.path}</span>
            <span className="repository-worktree-meta"><span>{item.detached ? 'HEAD scollegato' : item.branch?.replace(/^refs\/heads\//, '') ?? 'Branch non disponibile'}</span>
              {item.oid && <code>{item.oid.slice(0, 8)}</code>}</span>
            {item.unavailable && <small>Non verificabile</small>}
          </button>
        </li>)}</ul> : <p className="repository-pane-message">Nessun worktree rilevato.</p>}
      </section>
      <div className="repository-read-columns">
      <div className="repository-read-primary">
        <header className="repository-panel-heading"><CommitIcon aria-hidden="true" /><h4>Cronologia</h4><span>{history.commits.length} commit mostrati</span></header>
        {!history.commits.length ? <p className="hint">Nessun commit nel repository.</p> : <ol className="repository-commits" aria-label="Grafo dei commit">
          {history.commits.map((commit, i) => {
            const { before, next, lane } = lanes[i]!;
            const x = (n: number) => 10 + n * 14;
            return <li key={commit.oid}>
              <svg width={graphWidth} height="44" aria-hidden="true">
                {before.map((oid, from) => <path key={oid} className="repository-lane-context"
                  d={oid === commit.oid ? `M ${x(from)} 0 V 22` : `M ${x(from)} 0 C ${x(from)} 25 ${x(next.indexOf(oid))} 21 ${x(next.indexOf(oid))} 44`} />)}
                {commit.parents.map((parent, index) => <path key={parent} className={index ? 'repository-lane-context' : undefined}
                  d={`M ${x(lane)} 22 C ${x(lane)} 35 ${x(next.indexOf(parent))} 28 ${x(next.indexOf(parent))} 44`} />)}
                <circle cx={x(lane)} cy="22" r={commit.parents.length > 1 ? 5 : 3.5} data-selected={detail?.commit.oid === commit.oid} />
              </svg>
              <button className="repository-commit" disabled={busy} aria-pressed={detail?.commit.oid === commit.oid}
                onClick={() => void showCommit(commit.oid)} title={`Genitori: ${commit.parents.join(', ') || 'nessuno'}`}>
                <span className="repository-commit-copy"><strong>{commit.subject || 'Commit senza titolo'}</strong>
                  <span>{commit.author}</span></span><code>{commit.oid.slice(0, 8)}</code>
                {history.refs.filter(ref => ref.commit === commit.oid).map(ref => <span className="repository-ref" title={ref.name} key={ref.name}>{ref.name.replace(/^refs\/(?:heads|tags|remotes)\//, '')}</span>)}
              </button>
            </li>;
          })}
        </ol>}
        {history.nextCursor && <button className="button subtle" disabled={busy} onClick={() => void more()}>Altri commit</button>}
      </div>
      <aside className="repository-read-side">
        <header className="repository-panel-heading"><FileTextIcon aria-hidden="true" /><h4>{detail ? 'Commit selezionato' : 'Dettaglio commit'}</h4></header>
        {detail ? <section className="repository-commit-detail" aria-label="Dettaglio commit">
          {selectedPath && <p className="repository-history-origin">Worktree <strong>{selectedPath.path}</strong></p>}
          <code className="repository-oid">{detail.commit.oid}</code>
          <p className="hint">{detail.commit.author} · <time dateTime={detail.commit.date}>{new Intl.DateTimeFormat('it-IT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.commit.date))}</time></p>
          <pre className="repository-message">{detail.message || detail.commit.subject}</pre>
          {detail.commit.parents.length > 1 && <p className="hint">File rispetto al primo genitore <code>{detail.base?.slice(0, 10)}</code></p>}
          <h4>File modificati</h4>
          {detail.files.length ? <ul>{detail.files.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p>Nessun file modificato.</p>}
          {detail.nextCursor && <button className="button subtle" disabled={busy}
            onClick={() => void showCommit(detail.commit.oid, detail.nextCursor!)}>Altri file</button>}
        </section> : <p className="repository-pane-message">Seleziona un commit nel grafo o apri quello di un worktree.</p>}
      </aside>
      </div>
    </>}
  </section>;
}
