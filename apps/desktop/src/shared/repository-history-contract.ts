import { keys, record, revision, uuid } from './input.ts';

export const HISTORY_METHODS = ['openRepositoryHistory', 'listRepositoryCommits', 'getRepositoryCommit'] as const;
export type HistoryMethod = typeof HISTORY_METHODS[number];
export function historyMethod(value: string): value is HistoryMethod {
  return HISTORY_METHODS.some(method => method === value);
}

export function oid(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) throw new Error('INVALID_INPUT');
  return value;
}
export function validateHistoryRequest(method: HistoryMethod, p: Record<string, unknown>) {
  keys(p, ['bridgeVersion', 'callId', 'selectionEpoch', 'projectId',
    ...(method === 'openRepositoryHistory' ? [] : ['handle']),
    ...(method === 'getRepositoryCommit' ? ['oid', 'cursor'] : method === 'listRepositoryCommits' ? ['cursor'] : [])]);
  uuid(p.projectId);
  if (method !== 'openRepositoryHistory') uuid(p.handle);
  if (method === 'getRepositoryCommit') oid(p.oid);
  if (method === 'listRepositoryCommits' || p.cursor !== undefined) uuid(p.cursor);
}
function string(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw new Error('CLIENT_PROTOCOL_ERROR');
  return value;
}
function array<T>(value: unknown, max: number, item: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('CLIENT_PROTOCOL_ERROR');
  return value.map(item);
}
function bool(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('CLIENT_PROTOCOL_ERROR');
  return value;
}
function offset(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1_000_000) throw new Error('CLIENT_PROTOCOL_ERROR');
  return value;
}
function commit(value: unknown) {
  const p = record(value);
  return { oid: oid(p.oid), parents: array(p.parents, 128, oid), date: string(p.date, 40),
    author: string(p.author, 200), subject: string(p.subject, 300) };
}
export function validateHistoryData(value: unknown, projectId: unknown, query: Record<string, unknown>, configRevision?: unknown) {
  const p = record(value);
  if (uuid(p.projectId) !== projectId || (configRevision !== undefined && p.configRevision !== configRevision)) throw new Error('CLIENT_PROTOCOL_ERROR');
  const context = { projectId: uuid(p.projectId), configRevision: revision(p.configRevision), nextOffset: offset(p.nextOffset) };
  if (query.kind === 'commit') {
    const selected = commit(p.commit);
    if (selected.oid !== query.oid) throw new Error('CLIENT_PROTOCOL_ERROR');
    return { ...context, commit: selected, message: string(p.message, 6000), base: p.base === null ? null : oid(p.base),
      files: array(p.files, 50, path => string(path, 8192)) };
  }
  const page = { ...context, commits: array(p.commits, 50, commit) };
  if (query.kind !== 'open') return page;
  return { ...page, roots: array(p.roots, 128, oid), refs: array(p.refs, 256, value => {
    const ref = record(value);
    return { name: string(ref.name, 8192), oid: oid(ref.oid), commit: ref.commit === null ? null : oid(ref.commit) };
  }), worktrees: array(p.worktrees, 128, value => {
    const tree = record(value);
    return { path: string(tree.path, 16384), oid: tree.oid === null ? null : oid(tree.oid),
      branch: tree.branch === null ? null : string(tree.branch, 8192),
      detached: bool(tree.detached), locked: bool(tree.locked), unavailable: bool(tree.unavailable) };
  }) };
}
export type CommitSummary = ReturnType<typeof commit>;
