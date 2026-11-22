import type { GitQuery, GitRunner, GitRunOptions } from './runner.js';

const maxSize = 1024 * 1024;
const chunkSize = 32 * 1024;
const oidPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
type CodeQuery = { kind: 'open' } | { kind: 'tree' | 'blob'; oid: string; path: string; offset: number };
type Entry = { name: string; path: string; type: 'directory' | 'file' | 'symlink' | 'gitlink'; oid: string };

export function parseRepositoryCode(value: unknown): CodeQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  const { kind, oid, path, offset } = value as Record<string, unknown>;
  const keys = Object.keys(value).sort().join(',');
  if (kind === 'open' && keys === 'kind') return { kind };
  if (keys !== 'kind,offset,oid,path' || (kind !== 'tree' && kind !== 'blob') ||
      typeof oid !== 'string' || !oidPattern.test(oid) || typeof path !== 'string' ||
      !path.isWellFormed() || Buffer.byteLength(path) > 4096 || path.includes('\0') ||
      (path === '' ? kind !== 'tree' : path.split('/').some(x => !x || x === '.' || x === '..')) ||
      typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0 || offset > maxSize) throw new Error('INVALID_REQUEST');
  return { kind, oid, path, offset };
}

function entries(text: string): Entry[] {
  const lines = text.split('\0');
  if (lines.pop() !== '') throw new Error('INSPECTION_UNAVAILABLE');
  return lines.map(line => {
    const tab = line.indexOf('\t');
    const [mode, , oid] = line.slice(0, tab).split(' ');
    const path = line.slice(tab + 1);
    const type = mode === '040000' ? 'directory' : mode === '120000' ? 'symlink'
      : mode === '160000' ? 'gitlink' : mode === '100644' || mode === '100755' ? 'file' : null;
    if (!type || !oid || !oidPattern.test(oid) || tab < 0 || !path) throw new Error('INSPECTION_UNAVAILABLE');
    return { type, oid, path, name: path.slice(path.lastIndexOf('/') + 1) };
  });
}

export async function readRepositoryCode(git: GitRunner, options: GitRunOptions, input: CodeQuery) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  async function run(command: GitQuery, missingExit?: number): Promise<Buffer | null> {
    const result = await git.run(command, options);
    if (!result.ok) throw new Error(result.error.code);
    if (missingExit !== undefined && result.exitCode === missingExit && !result.stderrBytes) return null;
    if (result.exitCode !== 0 || result.stderrBytes) throw new Error('INSPECTION_UNAVAILABLE');
    return Buffer.from(result.stdout);
  }
  const text = async (command: GitQuery) => decoder.decode((await run(command))!);
  const oid = input.kind === 'open'
    ? (await run({ kind: 'local-branch', branch: 'main' }, 1))?.toString('ascii').trim() ?? null : input.oid;
  if (!oid) return { status: 'MAIN_MISSING', oid: null, nextOffset: null } as const;
  if (!oidPattern.test(oid)) throw new Error('INSPECTION_UNAVAILABLE');
  const path = input.kind === 'open' ? '' : input.path;
  const offset = input.kind === 'open' ? 0 : input.offset;
  const selected = path ? entries(await text({ kind: 'code-tree', oid, path })).find(entry => entry.path === path) : undefined;
  const unavailable = (status: 'NOT_FOUND' | 'SYMLINK' | 'GITLINK' | 'NOT_TEXT' | 'TOO_LARGE', size?: number) =>
    ({ status, oid, nextOffset: null, ...(size === undefined ? {} : { size }) });
  if (path && !selected) return unavailable('NOT_FOUND');
  if (selected?.type === 'symlink') return unavailable('SYMLINK');
  if (selected?.type === 'gitlink') return unavailable('GITLINK');
  if (input.kind !== 'blob') {
    if (selected && selected.type !== 'directory') return unavailable('NOT_FOUND');
    const items = entries(await text({ kind: 'code-tree', oid: selected?.oid ?? oid }));
    const page: { name: string; path: string; type: Entry['type'] }[] = [];
    let bytes = 0;
    for (const entry of items.slice(offset, offset + 100)) {
      const row = { name: entry.name, type: entry.type, path: path ? `${path}/${entry.name}` : entry.name };
      bytes += Buffer.byteLength(JSON.stringify(row));
      if (bytes > 48 * 1024) {
        if (page.length === 0) throw new Error('OUTPUT_LIMIT');
        break;
      }
      page.push(row);
    }
    return { status: 'READY', oid, entries: page, nextOffset: offset + page.length < items.length ? offset + page.length : null } as const;
  }
  if (selected?.type !== 'file') return unavailable('NOT_FOUND');
  const size = Number((await text({ kind: 'code-size', oid: selected.oid })).trim());
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('INSPECTION_UNAVAILABLE');
  if (size > maxSize) return unavailable('TOO_LARGE', size);
  if (offset > size || offset % chunkSize !== 0) throw new Error('INVALID_REQUEST');
  const bytes = (await run({ kind: 'code-blob', oid: selected.oid }))!;
  if (bytes.length !== size) throw new Error('INSPECTION_UNAVAILABLE');
  if (offset === 0) {
    if (bytes.includes(0)) return unavailable('NOT_TEXT', size);
    try { decoder.decode(bytes); } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return unavailable('NOT_TEXT', size);
    }
  }
  return { status: 'READY', oid, size, offset, chunk: bytes.subarray(offset, offset + chunkSize).toString('base64'),
    nextOffset: offset + chunkSize < size ? offset + chunkSize : null } as const;
}
