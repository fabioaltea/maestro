import type { RepositoryDocuments } from '../../shared/repository-documents.ts';
import { dateLabel } from '../format.ts';
import { RepositoryMarkdown } from './RepositoryMarkdown.tsx';

export function RepositoryReadme({ documents, loading }: {
  documents: RepositoryDocuments | null; loading: boolean;
}) {
  const readme = documents?.readme;
  const commit = documents?.lastCommit;
  return <section className="repository-document" aria-label="README">
    {readme?.status === 'READY' ? <>
      {readme.markdown.trim() ? <RepositoryMarkdown markdown={readme.markdown} /> : <p className="repository-document-note">Il README è vuoto.</p>}
      {readme.truncated && <p className="repository-document-note">Anteprima limitata ai primi 48 KiB.</p>}
    </> : <p className="repository-document-note" role="status">{loading ? 'Lettura del README…' : readme?.status === 'MISSING'
      ? 'Nessun README nella radice del repository.' : 'Impossibile leggere il README del repository.'}</p>}
    {readme?.status === 'READY' && <footer className="repository-document-footer">
      <dl className="repository-document-meta">
        <div><dt>Ultima modifica locale</dt><dd><time dateTime={readme.modifiedAt}>{dateLabel(readme.modifiedAt)}</time></dd></div>
        {commit && <div>
          <dt>Ultimo commit del README</dt>
          <dd><span className="mono" title={commit.oid}>{commit.oid.slice(0, 8)}</span> · <time dateTime={commit.date}>{dateLabel(commit.date)}</time>{commit.author && ` · ${commit.author}`}</dd>
          {commit.subject && <dd>{commit.subject}</dd>}
        </div>}
      </dl>
    </footer>}
  </section>;
}
