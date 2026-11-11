import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const execute = promisify(execFile);
export const repositoryRoot = resolve(import.meta.dirname, '../../../..');
export async function createScratch() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'maestro-desktop-')));
  const owner = randomUUID();
  await writeFile(join(directory, '.owner'), owner, { mode: 0o600 });
  const archive = join(directory, 'archive');
  const userData = join(directory, 'ui');
  async function cli(args: string[]) {
    const result = await execute(process.execPath, [join(repositoryRoot, 'dist/cli/main.js'), ...args, `--state-dir=${archive}`, '--json'],
      { cwd: repositoryRoot, timeout: 35_000, maxBuffer: 262_144, encoding: 'utf8' })
      .then(r => ({ code: 0, stdout: r.stdout }), (e: unknown) => {
        if (!(e instanceof Error) || !('stdout' in e) || typeof e.stdout !== 'string') throw e;
        return { code: 'code' in e ? e.code : null, stdout: e.stdout };
      });
    return { code: result.code, result: JSON.parse(result.stdout) as Record<string, any> };
  }
  async function repository(name = 'project', commit = true) {
    if (!/^[\p{L}\p{N} ._-]+$/u.test(name) || name === '..') throw new Error('UNOWNED_FIXTURE');
    const path = join(directory, name);
    await mkdir(path);
    const git = (args: string[]) => execute('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: path, timeout: 10_000, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' } });
    await git(['init', '--initial-branch=main']);
    if (commit) { await writeFile(join(path, 'file.txt'), 'initial\n'); await git(['add', '--', 'file.txt']); await git(['commit', '-m', 'fixture']); }
    return { path, git };
  }
  async function snapshot(path: string): Promise<Record<string, string>> {
    const entries: Record<string, string> = {};
    async function visit(dir: string) {
      for (const name of (await readdir(dir)).sort()) {
        const file = join(dir, name), info = await lstat(file);
        if (info.isSymbolicLink()) { entries[file.slice(path.length)] = 'symlink'; continue; }
        if (info.isDirectory()) await visit(file);
        else if (info.isFile()) entries[file.slice(path.length)] = `${info.mode}:${createHash('sha256').update(await readFile(file)).digest('hex')}`;
      }
    }
    await visit(path); return entries;
  }
  async function cleanup() {
    if (await readFile(join(directory, '.owner'), 'utf8') !== owner) throw new Error('UNOWNED_FIXTURE');
    try { await cli(['daemon', 'stop']); } catch { /* An archive absent or already stopped needs no stop. */ }
    await rm(directory, { recursive: true });
  }
  return { directory, archive, userData, cli, repository, snapshot, cleanup };
}
export function controlledClock() {
  let now = 0;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}
export function failAt(point: string) { return (at: string) => { if (point === at) throw new Error('FIXTURE_FAULT'); }; }
