import { keys, record, revision, uuid } from './input.ts';
import { oid } from './repository-history-contract.ts';

export const CODE_METHODS = ['openRepositoryCode', 'listRepositoryTree', 'readRepositoryBlob'] as const;
type Method = typeof CODE_METHODS[number];
export function codeMethod(method: string): method is Method { return CODE_METHODS.some(item => item === method); }
export function gitPath(path: unknown, root = false) {
  if (typeof path !== 'string' || !path.isWellFormed() || new TextEncoder().encode(path).length > 4096 || path.includes('\0')
      || (path === '' ? !root : path.split('/').some(part => !part || part === '.' || part === '..'))) throw new Error('INVALID_INPUT');
  return path;
}
export function validateCodeRequest(method: Method, p: Record<string, unknown>) {
  keys(p, ['bridgeVersion', 'callId', 'selectionEpoch', 'projectId',
    ...(method === 'openRepositoryCode' ? [] : ['handle', 'path']), ...(method === 'listRepositoryTree' ? ['cursor'] : [])]);
  uuid(p.projectId);
  if (method === 'openRepositoryCode') return;
  uuid(p.handle);
  gitPath(p.path, method === 'listRepositoryTree');
  if (p.cursor !== undefined) uuid(p.cursor);
}
export type TreeEntry = { name: string; path: string; type: 'directory' | 'file' | 'symlink' | 'gitlink' };
export function validateCodeData(value: unknown, projectId: unknown, query: Record<string, unknown>, configRevision?: unknown): Record<string, unknown> {
  const p = record(value);
  if (uuid(p.projectId) !== projectId || configRevision !== undefined && p.configRevision !== configRevision) throw new Error('CLIENT_PROTOCOL_ERROR');
  const context = { projectId: uuid(p.projectId), configRevision: revision(p.configRevision) };
  if (p.status === 'MAIN_MISSING' && query.kind === 'open' && p.oid === null) return { ...context, status: p.status, oid: null, nextOffset: null };
  const hash = oid(p.oid);
  if (query.kind !== 'open' && hash !== query.oid) throw new Error('CLIENT_PROTOCOL_ERROR');
  if (p.status !== 'READY') {
    if (query.kind === 'open' || !['NOT_FOUND', 'SYMLINK', 'GITLINK', 'NOT_TEXT', 'TOO_LARGE'].includes(String(p.status))) throw new Error('CLIENT_PROTOCOL_ERROR');
    return { ...context, status: p.status, oid: hash, nextOffset: null };
  }
  const start = typeof query.offset === 'number' ? query.offset : 0;
  const next = p.nextOffset;
  if (next !== null && (typeof next !== 'number' || !Number.isSafeInteger(next) || next <= start || next > 1024 * 1024)) throw new Error('CLIENT_PROTOCOL_ERROR');
  const base = { ...context, status: p.status, oid: hash, nextOffset: next };
  if (query.kind === 'blob') {
    if (typeof p.size !== 'number' || !Number.isSafeInteger(p.size) || p.size < start || p.size > 1024 * 1024 || p.offset !== start
      || typeof p.chunk !== 'string' || p.chunk.length > 43692 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(p.chunk)
      || next !== (p.size > start + 32768 ? start + 32768 : null)) throw new Error('CLIENT_PROTOCOL_ERROR');
    return { ...base, size: p.size, offset: p.offset, chunk: p.chunk };
  }
  if (!Array.isArray(p.entries) || p.entries.length > 100 || next !== null && next !== start + p.entries.length) throw new Error('CLIENT_PROTOCOL_ERROR');
  const parent = query.kind === 'open' ? '' : gitPath(query.path, true);
  return { ...base, entries: p.entries.map(value => {
    const item = record(value), path = gitPath(item.path), name = gitPath(item.name);
    if (name.includes('/') || path !== (parent ? `${parent}/${name}` : name) || !['directory', 'file', 'symlink', 'gitlink'].includes(String(item.type))) throw new Error('CLIENT_PROTOCOL_ERROR');
    return { name, path, type: item.type };
  }) };
}
