import { keys, record, revision, uuid } from './validation.ts';

export type RepositoryDocument =
  | { status: 'MISSING' }
  | { status: 'UNAVAILABLE'; name: string }
  | { status: 'READY'; name: string; markdown: string; modifiedAt: string; truncated: boolean };

function document(value: unknown, names: RegExp): RepositoryDocument {
  const doc = record(value);
  if (doc.status === 'MISSING') {
    keys(doc, ['status']);
    return { status: 'MISSING' };
  }
  if (typeof doc.name !== 'string' || !names.test(doc.name)) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (doc.status === 'UNAVAILABLE') {
    keys(doc, ['status', 'name']);
    return { status: 'UNAVAILABLE', name: doc.name };
  }
  keys(doc, ['status', 'name', 'markdown', 'modifiedAt', 'truncated']);
  if (doc.status !== 'READY' || typeof doc.markdown !== 'string' || new TextEncoder().encode(doc.markdown).length > 48 * 1024 ||
      typeof doc.modifiedAt !== 'string' || !Number.isFinite(Date.parse(doc.modifiedAt)) || typeof doc.truncated !== 'boolean') throw new Error('CLIENT_PROTOCOL_ERROR');
  return { status: 'READY', name: doc.name, markdown: doc.markdown, modifiedAt: doc.modifiedAt, truncated: doc.truncated };
}

export function validateRepositoryDocuments(value: unknown, expectedId: unknown) {
  const data = record(value);
  keys(data, ['projectId', 'configRevision', 'readme', 'analysis', 'lastCommit', 'specifications']);
  const projectId = uuid(data.projectId), configRevision = revision(data.configRevision);
  if (projectId !== expectedId) throw new Error('CLIENT_PROTOCOL_ERROR');
  const readme = document(data.readme, /^readme(?:\.(?:md|markdown|txt))?$/i);
  const analysis = document(data.analysis, /^(?:codebase|codebase[-_]analysis)\.md$/i);
  const specs = data.specifications;
  if (specs !== null && (!Array.isArray(specs) || specs.length > 100 || specs.some(path =>
    typeof path !== 'string' || !/^specs\/\d{3,14}-[a-z0-9][a-z0-9-]{0,99}\/spec\.md$/.test(path)))) throw new Error('CLIENT_PROTOCOL_ERROR');
  let lastCommit: { oid: string; date: string; author: string; subject: string } | null = null;
  if (data.lastCommit !== null) {
    const commit = record(data.lastCommit);
    keys(commit, ['oid', 'date', 'author', 'subject']);
    const { oid, date, author, subject } = commit;
    if (readme.status !== 'READY' || typeof oid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid) ||
        typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || typeof author !== 'string' || author.length > 200 ||
        typeof subject !== 'string' || subject.length > 200) throw new Error('CLIENT_PROTOCOL_ERROR');
    lastCommit = { oid, date, author, subject };
  }
  return { projectId, configRevision, readme, analysis, lastCommit, specifications: specs as string[] | null };
}

export type RepositoryDocuments = ReturnType<typeof validateRepositoryDocuments>;
