import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CodeIcon, Cross2Icon, FileIcon, FileTextIcon, Link2Icon, LockClosedIcon, MagnifyingGlassIcon, ReloadIcon, RowsIcon } from '@radix-ui/react-icons';
import { parser as javascript } from '@lezer/javascript';
import { parser as json } from '@lezer/json';
import { parser as css } from '@lezer/css';
import { parser as html } from '@lezer/html';
import { parser as markdown } from '@lezer/markdown';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import type { TreeEntry } from '../../shared/repository-code-contract.ts';
import type { Desktop } from '../state/desktop.ts';

type Directory = { entries: TreeEntry[]; nextCursor: string | null };
type Snapshot = Directory & { handle: string; oid: string };
type Tab = { path: string; text?: string; error?: string };
const statuses: Record<string, string> = {
  MAIN_MISSING: 'Il branch locale main non esiste o non contiene commit.',
  TOO_LARGE: 'Il file supera il limite di 1 MiB.',
  NOT_TEXT: 'Il file non è testo UTF-8 visualizzabile.',
  NOT_FOUND: 'Il percorso non è presente nello snapshot.',
  SYMLINK: 'Collegamento simbolico: destinazione non consultata.',
  GITLINK: 'Riferimento a un sottomodulo: contenuto non consultato.',
};
const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

function CodeViewer({ tab }: { tab: Tab }) {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(0);
  const [limit, setLimit] = useState(500);
  const hit = useRef<HTMLElement>(null);
  const source = useRef<HTMLDivElement>(null);
  const text = tab.text ?? '';
  const lines = useMemo(() => text.split('\n'), [text]);
  const colors = useMemo(() => {
    const extension = tab.path.split('.').pop()?.toLowerCase() ?? '';
    const parser = ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'].includes(extension)
      ? javascript.configure({ dialect: `${['ts', 'tsx', 'mts', 'cts'].includes(extension) ? 'ts' : ''}${['jsx', 'tsx'].includes(extension) ? ' jsx' : ''}`.trim() })
      : extension === 'json' ? json : extension === 'css' ? css : ['html', 'htm'].includes(extension) ? html : extension === 'md' ? markdown : null;
    const spans: { from: number; to: number; style: string }[] = [];
    if (parser) highlightTree(parser.parse(text), classHighlighter, (from, to, style) => spans.push({ from, to, style }));
    return spans;
  }, [tab.path, text]);
  const matches = useMemo(() => {
    const items: { line: number; from: number; to: number }[] = [];
    if (!search) return items;
    let start = 0;
    lines.forEach((line, index) => {
      let cursor = 0;
      for (let found = line.indexOf(search, cursor); found !== -1; found = line.indexOf(search, cursor)) {
        cursor = found + search.length;
        items.push({ line: index, from: start + found, to: start + cursor });
      }
      start += line.length + 1;
    });
    return items;
  }, [lines, search]);
  useEffect(() => {
    const pane = source.current, match = hit.current;
    if (!search || !pane || !match) return;
    const viewport = pane.getBoundingClientRect(), rect = match.getBoundingClientRect();
    if (rect.top < viewport.top || rect.bottom > viewport.bottom) pane.scrollTop += rect.top - viewport.top - pane.clientHeight / 3;
    if (rect.left < viewport.left + 60 || rect.right > viewport.right) pane.scrollLeft += rect.left - viewport.left - 64;
  }, [search, selected]);
  if (tab.error !== undefined) return <p className="repository-pane-message">{tab.error}</p>;
  if (tab.text === undefined) return <p className="repository-pane-message" role="status">Lettura file…</p>;
  const current = matches[selected];
  const startLine = current && current.line >= limit ? current.line : 0;
  let position = 0, colorIndex = 0;
  for (let index = 0; index < startLine; index++) position += lines[index]!.length + 1;
  return <>
    <div className="repository-code-search">
      <div className="repository-code-search-field"><MagnifyingGlassIcon aria-hidden="true" />
        <input type="search" aria-label="Cerca nel file" placeholder="Cerca nel file" value={search}
          onChange={event => { setSearch(event.target.value); setSelected(0); }}
          onKeyDown={event => {
            if (event.key !== 'Enter' || !matches.length) return;
            event.preventDefault(); setSelected((selected + (event.shiftKey ? -1 : 1) + matches.length) % matches.length);
          }} /></div>
      {search && <><span role="status">{matches.length} {matches.length === 1 ? 'corrispondenza' : 'corrispondenze'}</span>
        <button className="repository-icon-action" aria-label="Corrispondenza precedente" disabled={!matches.length} onClick={() => setSelected((selected + matches.length - 1) % matches.length)}><ChevronUpIcon /></button>
        <button className="repository-icon-action" aria-label="Corrispondenza successiva" disabled={!matches.length} onClick={() => setSelected((selected + 1) % matches.length)}><ChevronDownIcon /></button></>}
    </div>
    <div ref={source} className="repository-code-source" tabIndex={0} aria-label="Contenuto del file">
      {lines.slice(startLine, startLine + limit).map((line, index) => {
        const from = position, to = from + line.length;
        position = to + 1;
        const boundaries = new Set([from, to]);
        while (colors[colorIndex] && colors[colorIndex]!.to <= from) colorIndex++;
        const spans: typeof colors = [];
        for (let i = colorIndex; colors[i] && colors[i]!.from < to; i++) {
          const span = colors[i]!;
          spans.push(span); boundaries.add(Math.max(from, span.from)); boundaries.add(Math.min(to, span.to));
        }
        const match = current?.line === index + startLine ? current : null;
        if (match) { boundaries.add(match.from); boundaries.add(match.to); }
        const cuts = [...boundaries].sort((a, b) => a - b);
        let spanIndex = 0;
        return <div className="repository-code-line" key={index + startLine} data-match={Boolean(match)}>
          <span className="repository-line-number" aria-hidden="true">{index + startLine + 1}</span>
          <code>{cuts.slice(0, -1).map((begin, i) => {
            while (spans[spanIndex] && spans[spanIndex]!.to <= begin) spanIndex++;
            const style = spans[spanIndex] && spans[spanIndex]!.from <= begin ? spans[spanIndex]!.style : undefined;
            const marked = match && begin >= match.from && begin < match.to;
            return <span key={begin} className={[style, marked ? 'repository-code-match' : ''].filter(Boolean).join(' ')}
              ref={marked && begin === match.from ? hit : undefined}>{text.slice(begin, cuts[i + 1])}</span>;
          })}</code>
        </div>;
      })}
      {startLine + limit < lines.length && <button className="button subtle" onClick={() => setLimit(startLine + limit + 500)}>Mostra altre righe</button>}
    </div>
  </>;
}

export function RepositoryCode({ desktop, projectId }: { desktop: Desktop; projectId: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [directories, setDirectories] = useState<Record<string, Directory>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [explorer, setExplorer] = useState(true);
  const [loadingFolder, setLoadingFolder] = useState<string | null>(null);
  const [folderError, setFolderError] = useState<{ path: string; message: string } | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const pending = useRef(false);
  const { core } = desktop;
  async function perform(work: (current: () => boolean) => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    const ticket = ++sequence.current;
    const current = () => ticket === sequence.current;
    setBusy(true); setError('');
    try { await work(current); }
    finally { if (current()) { pending.current = false; setBusy(false); } }
  }
  const refresh = () => perform(async current => {
    const response = await core('openRepositoryCode', { projectId });
    if (!current()) return;
    if (response?.result !== 'OK' || response.data.status !== 'READY') {
      setError(response?.error?.message ?? statuses[String(response?.data.status)] ?? 'Codice non disponibile. Riprova.');
      return;
    }
    const next = response.data as Snapshot;
    setSnapshot(next); setDirectories({ '': next }); setExpanded(new Set()); setTabs([]); setActive(null); setFolderError(null);
  });
  useEffect(() => {
    void refresh();
    return () => { sequence.current++; pending.current = false; };
  }, [projectId, core]);
  const readDirectory = (path: string, cursor?: string) => perform(async current => {
    if (!snapshot) return;
    setLoadingFolder(path); setFolderError(null);
    const response = await core('listRepositoryTree', { projectId, handle: snapshot.handle, path, ...(cursor ? { cursor } : {}) });
    if (!current()) return;
    setLoadingFolder(null);
    if (response?.result !== 'OK' || response.data.status !== 'READY') {
      setFolderError({ path, message: response?.error?.message ?? statuses[String(response?.data.status)] ?? 'Cartella non disponibile.' });
      return;
    }
    const page = response.data as Directory;
    setDirectories(old => ({ ...old, [path]: cursor ? { ...page, entries: [...(old[path]?.entries ?? []), ...page.entries] } : page }));
  });
  function open(entry: TreeEntry) {
    if (!snapshot) return;
    const existing = tabs.find(tab => tab.path === entry.path);
    if (existing) { setActive(entry.path); return; }
    if (pending.current) return;
    if (tabs.length >= 20) { setError('Chiudi una scheda prima di aprirne un’altra.'); return; }
    setActive(entry.path);
    const append = (tab: Tab) => setTabs(old => old.some(item => item.path === tab.path)
      ? old.map(item => item.path === tab.path ? tab : item) : [...old, tab]);
    if (entry.type === 'symlink' || entry.type === 'gitlink') {
      append({ path: entry.path, error: entry.type === 'symlink' ? statuses.SYMLINK! : statuses.GITLINK! }); return;
    }
    append({ path: entry.path });
    void perform(async current => {
      const response = await core('readRepositoryBlob', { projectId, handle: snapshot.handle, path: entry.path });
      if (!current()) return;
      if (response?.result === 'OK' && response.data.status === 'READY' && typeof response.data.text === 'string') {
        append({ path: entry.path, text: response.data.text });
      } else append({ path: entry.path, error: response?.error?.message ?? statuses[String(response?.data.status)] ?? 'Lettura interrotta. Chiudi la scheda e riprova.' });
    });
  }
  const renderDirectory = (path: string) => {
    const directory = Object.hasOwn(directories, path) ? directories[path] : undefined;
    const entries = directory?.entries ?? [];
    const next = directory?.nextCursor;
    return <ul className="repository-code-tree">
      {[...entries.filter(item => item.type === 'directory'), ...entries.filter(item => item.type !== 'directory')].map(entry => {
        const folder = entry.type === 'directory';
        const isExpanded = expanded.has(entry.path);
        const Icon = folder ? (isExpanded ? ChevronDownIcon : ChevronRightIcon) : entry.type === 'file' ? FileIcon : Link2Icon;
        return <li key={entry.path}><button className="repository-tree-row" title={entry.path}
          aria-expanded={folder ? isExpanded : undefined} aria-current={!folder && active === entry.path ? 'true' : undefined}
          disabled={folder ? !isExpanded && !Object.hasOwn(directories, entry.path) && busy : busy && !tabs.some(item => item.path === entry.path)}
          onClick={() => {
            if (!folder) { open(entry); return; }
            setExpanded(old => isExpanded ? new Set([...old].filter(item => item !== entry.path)) : new Set([...old, entry.path]));
            if (!isExpanded && !Object.hasOwn(directories, entry.path)) void readDirectory(entry.path);
          }}><Icon aria-hidden="true" /><span>{entry.name}</span></button>
          {folder && isExpanded && renderDirectory(entry.path)}
        </li>;
      })}
      {loadingFolder === path && <li className="repository-tree-note" role="status">Lettura cartella…</li>}
      {folderError?.path === path && <li className="repository-tree-note" role="alert">{folderError.message}{!next &&
        <button className="text-button" disabled={busy} onClick={() => void readDirectory(path)}>Riprova</button>}</li>}
      {directory && !entries.length && <li className="repository-tree-note">Nessun file</li>}
      {next && <li><button className="text-button repository-tree-note" disabled={busy} onClick={() => void readDirectory(path, next)}>Altri file</button></li>}
    </ul>;
  };
  const tab = tabs.find(item => item.path === active);
  return <section className="repository-read repository-code" aria-label="Codice">
    <header className="repository-read-header"><div className="repository-read-title"><CodeIcon aria-hidden="true" /><h3>Codice</h3></div>
      <button className="repository-read-action" disabled={busy} onClick={() => void refresh()}><ReloadIcon aria-hidden="true" />Aggiorna main</button></header>
    {error && <p className="repository-read-alert" role="alert">{error}{snapshot && ' Lo snapshot mostrato non è cambiato.'}</p>}
    {!snapshot && busy && <p className="repository-pane-message" role="status">Lettura di main…</p>}
    {snapshot && <div className="repository-code-frame">
      <div className="repository-code-toolbar">
        <button className="repository-read-action" aria-expanded={explorer} aria-controls="repository-code-explorer"
          onClick={() => setExplorer(current => !current)}><RowsIcon aria-hidden="true" />Esplora file</button>
        <span className="repository-branch-label">main</span>
        <code className="repository-code-revision" title={snapshot.oid}>{snapshot.oid}</code>
        <span className="repository-code-readonly"><LockClosedIcon aria-hidden="true" />Sola lettura</span>
      </div>
      <div className="repository-code-layout" data-explorer={explorer}>
      <nav id="repository-code-explorer" className="repository-code-explorer" aria-label="File di main" hidden={!explorer}>{renderDirectory('')}</nav>
      <div className="repository-code-editor">
        <div className="repository-code-tabs" role="tablist" aria-label="File aperti">{tabs.map(item =>
          <div className="repository-code-tab" key={item.path}>
            <button role="tab" aria-selected={active === item.path}
              title={item.path} onClick={() => setActive(item.path)}><FileIcon aria-hidden="true" /><span>{fileName(item.path)}</span></button>
            <button className="repository-icon-action" disabled={busy} aria-label={`Chiudi ${item.path}`} onClick={() => {
              const remaining = tabs.filter(other => other.path !== item.path);
              setTabs(remaining); if (active === item.path) setActive(remaining.at(-1)?.path ?? null);
            }}><Cross2Icon aria-hidden="true" /></button>
          </div>)}</div>
        {tab ? <div className="repository-code-document" role="tabpanel" aria-label={tab.path}>
          <p className="repository-code-path mono" title={tab.path}>{tab.path.split('/').map((part, index) =>
            <span key={index}>{index > 0 && <ChevronRightIcon aria-hidden="true" />}{part}</span>)}</p>
          <CodeViewer key={tab.path} tab={tab} /></div> : <div className="repository-code-empty"><FileTextIcon aria-hidden="true" />
          <strong>Nessun file aperto</strong><p>{explorer ? 'Scegli un file dall’esploratore.' : 'Mostra l’esploratore per scegliere un file.'}</p></div>}
      </div>
      </div>
    </div>}
  </section>;
}
