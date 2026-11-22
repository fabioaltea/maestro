import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function RepositoryMarkdown({ markdown }: { markdown: string }) {
  return <div className="repository-markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    h1: 'h3', h2: 'h4', h3: 'h5', h4: 'h6',
    a: ({ children, href }) => <span className="markdown-reference" title={href || undefined}>{children}</span>,
    img: ({ alt }) => alt ? <span>{alt}</span> : null,
    table: ({ children }) => <div className="markdown-table"><table>{children}</table></div>,
  }}>{markdown}</Markdown></div>;
}
