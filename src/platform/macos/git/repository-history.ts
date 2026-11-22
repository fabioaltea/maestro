import type { GitQuery, GitRunner, GitRunOptions } from './runner.js';

const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const isOid = (value: unknown): value is string => typeof value === 'string' && oidPattern.test(value);
const pageSize = 50;
type HistoryQuery = { kind: 'open' } | { kind: 'log'; roots: string[]; offset: number }
  | { kind: 'commit'; roots: string[]; offset: number; oid: string };
type Worktree = { path: string; oid: string | null; branch: string | null; detached: boolean; locked: boolean; unavailable: boolean };

export function parseRepositoryHistory(value: unknown): HistoryQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  const q = value as Record<string, unknown>;
  const keys = Object.keys(q).sort().join(',');
  if (q.kind === 'open' && keys === 'kind') return { kind: 'open' };
  const { roots, offset } = q;
  if (!Array.isArray(roots) || roots.length > 128 || !roots.every(isOid) || typeof offset !== 'number'
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error('INVALID_REQUEST');
  if (q.kind === 'log' && keys === 'kind,offset,roots') return { kind: 'log', roots, offset };
  if (q.kind === 'commit' && keys === 'kind,offset,oid,roots' && isOid(q.oid) && roots.length) return { kind: 'commit', roots, offset, oid: q.oid };
  throw new Error('INVALID_REQUEST');
}

function worktreeList(text: string): Worktree[] {
  const result: Worktree[] = [];
  for (const entry of text.split('\0\0').filter(Boolean)) {
    const [worktree, ...fields] = entry.split('\0');
    if (!worktree?.startsWith('worktree ')) throw new Error('INSPECTION_UNAVAILABLE');
    const oid = fields.find(field => field.startsWith('HEAD '))?.slice(5);
    result.push({ path: worktree.slice(9), oid: oid && isOid(oid) && !/^0+$/.test(oid) ? oid : null,
      branch: fields.find(field => field.startsWith('branch '))?.slice(7) ?? null,
      detached: fields.includes('detached'), locked: fields.some(field => /^locked(?: |$)/.test(field)),
      unavailable: fields.includes('bare') || !oid || /^0+$/.test(oid) || fields.some(field => /^prunable(?: |$)/.test(field)) });
  }
  return result;
}

function summary([oid, parents, date, author, subject]: string[]) {
  if (!isOid(oid) || !Number.isFinite(Date.parse(date ?? ''))) throw new Error('INSPECTION_UNAVAILABLE');
  const parentList = parents?.split(' ').filter(Boolean) ?? [];
  if (!parentList.every(isOid)) throw new Error('INSPECTION_UNAVAILABLE');
  return { oid, parents: parentList, date: date!, author: (author ?? '').slice(0, 200), subject: (subject ?? '').slice(0, 300) };
}

export async function readRepositoryHistory(git: GitRunner, options: GitRunOptions, input: HistoryQuery) {
  const query = async (command: GitQuery) => {
    const result = await git.run(command, options);
    if (!result.ok) throw new Error(result.error.code);
    if (result.exitCode !== 0 || result.stderrBytes) throw new Error('INSPECTION_UNAVAILABLE');
    return new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  };
  const log = async (roots: string[], offset: number) => {
    if (!roots.length) return { commits: [], nextOffset: null };
    const fields = (await query({ kind: 'history-log', roots, offset })).split('\0');
    if (fields.pop() !== '' || fields.length % 5) throw new Error('INSPECTION_UNAVAILABLE');
    const commits = [];
    for (let i = 0; i < Math.min(fields.length, pageSize * 5); i += 5) commits.push(summary(fields.slice(i, i + 5)));
    return { commits, nextOffset: fields.length > pageSize * 5 ? offset + pageSize : null };
  };
  if (input.kind === 'log') return log(input.roots, input.offset);
  if (input.kind === 'open') {
    const observe = () => Promise.all([query({ kind: 'history-refs' }), query({ kind: 'history-worktrees' })]);
    const [refText, worktreeText] = await observe();
    const refs = refText.split('\n').filter(Boolean).map(line => {
      const [name, oid, type, peeled, peeledType] = line.split('\0');
      if (!name || !isOid(oid)) throw new Error('INSPECTION_UNAVAILABLE');
      return { name, oid, commit: type === 'commit' ? oid : peeledType === 'commit' && isOid(peeled) ? peeled : null };
    });
    const worktrees = worktreeList(worktreeText);
    const roots = [...new Set([...refs.map(ref => ref.commit), ...worktrees.map(item => item.oid)].filter(isOid))];
    if (roots.length > 128 || refs.length > 256 || worktrees.length > 128) throw new Error('OUTPUT_LIMIT');
    const history = await log(roots, 0);
    const [latestRefs, latestWorktrees] = await observe();
    if (refText !== latestRefs || worktreeText !== latestWorktrees) throw new Error('REPOSITORY_UNSTABLE');
    return { ...history, refs, worktrees, roots };
  }
  if ((await query({ kind: 'history-member', roots: input.roots, oid: input.oid })).trim() !== '0') throw new Error('INVALID_REQUEST');
  const detail = await query({ kind: 'history-detail', oid: input.oid });
  const fields = detail.split('\0');
  if (fields.length !== 7 || fields[6] !== '') throw new Error('INSPECTION_UNAVAILABLE');
  const commit = summary(fields.slice(0, 5));
  if (commit.oid !== input.oid) throw new Error('INVALID_REQUEST');
  const base = commit.parents[0] ?? null;
  const fileList = await query({ kind: 'history-files', oid: input.oid, base });
  const files = fileList.split('\0');
  if (files.pop() !== '') throw new Error('INSPECTION_UNAVAILABLE');
  return { commit, message: fields[5]!.slice(0, 6000), base,
    files: files.slice(input.offset, input.offset + pageSize),
    nextOffset: input.offset + pageSize < files.length ? input.offset + pageSize : null };
}
