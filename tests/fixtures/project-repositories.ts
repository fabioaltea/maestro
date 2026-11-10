import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, readlink, realpath, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import { createTestContext } from './test-context.js';

const execute = promisify(execFile);
export interface TreeEntry { readonly kind: string; readonly mode: number; readonly value: string }
export type TreeSnapshot = Readonly<Record<string, TreeEntry>>;

/** Setup only. These mutating Git commands are never used by application inspection. */
export async function createProjectRepositories(test: TestContext) {
  const context = await createTestContext(test);
  const directory = await realpath(context.directory);
  async function requireOwned(path: string): Promise<string> {
    const canonical = await realpath(path);
    const suffix = relative(directory, canonical);
    if (isAbsolute(suffix) || suffix === '..' || suffix.startsWith('../')) throw new Error('UNOWNED_FIXTURE');
    return canonical;
  }
  function requireName(name: string): string {
    if (!name || name === '.' || name === '..' || name !== basename(name) || name.includes('\0')) {
      throw new Error('INVALID_FIXTURE_NAME');
    }
    return name;
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(GIT_|DYLD_|LD_)/.test(key) && !['SSH_ASKPASS', 'GIT_ASKPASS'].includes(key)));
  Object.assign(env, { HOME: directory, XDG_CONFIG_HOME: directory, LC_ALL: 'C', LANG: 'C',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file' });

  async function git(cwd: string, args: readonly string[], expectedCode = 0): Promise<string> {
    cwd = await requireOwned(cwd);
    if (args.some(arg => arg === '-C' || /^--(?:git-dir|work-tree)(?:=|$)/.test(arg))) {
      throw new Error('UNOWNED_FIXTURE');
    }
    const result = await execute('/usr/bin/git', ['--no-pager', '-c', 'core.hooksPath=/dev/null',
      '-c', 'user.name=Maestro Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, env, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
      .then(value => ({ ...value, code: 0 }), (error: unknown) => {
        if (!(error instanceof Error) || !('code' in error) || typeof error.code !== 'number'
          || !('stdout' in error) || typeof error.stdout !== 'string') throw error;
        return { stdout: error.stdout, code: error.code };
      });
    if (result.code !== expectedCode) throw new Error(`FIXTURE_GIT_EXIT:${result.code}`);
    return result.stdout;
  }

  async function createRepository(name: string, options: {
    commit?: boolean; bare?: boolean; parent?: string; objectFormat?: 'sha1' | 'sha256';
  } = {}): Promise<string> {
    const parent = await requireOwned(options.parent ?? directory);
    const path = join(parent, requireName(name));
    await mkdir(path); // Existing files/symlinks are never followed or overwritten.
    await git(path, ['init', '--initial-branch=fixture-base',
      `--object-format=${options.objectFormat ?? 'sha1'}`, ...(options.bare ? ['--bare'] : [])]);
    if (!options.bare && options.commit !== false) {
      await writeFile(join(path, 'tracked.txt'), 'base\n');
      await git(path, ['add', '--', 'tracked.txt']);
      await git(path, ['commit', '-m', 'fixture initial']);
    }
    return path;
  }

  async function snapshotTree(path: string): Promise<TreeSnapshot> {
    const root = await requireOwned(path);
    const entries: Record<string, TreeEntry> = {};
    async function visit(current: string) {
      for (const name of (await readdir(current)).sort()) {
        const absolute = join(current, name);
        const info = await lstat(absolute);
        const key = relative(root, absolute);
        if (info.isSymbolicLink()) entries[key] = { kind: 'symlink', mode: info.mode, value: await readlink(absolute) };
        else if (info.isDirectory()) {
          entries[key] = { kind: 'directory', mode: info.mode, value: '' };
          await visit(absolute);
        } else if (info.isFile()) entries[key] = { kind: 'file', mode: info.mode,
          value: createHash('sha256').update(await readFile(absolute)).digest('hex') };
        else throw new Error('UNSUPPORTED_FIXTURE_ENTRY');
      }
    }
    await visit(root);
    return entries;
  }

  return {
    directory, git, createRepository, snapshotTree,
    async addWorktree(repository: string, name: string, branch = 'fixture-linked') {
      const path = join(directory, requireName(name));
      // Git must reject an existing checkout rather than adopting or repairing it.
      await git(repository, ['worktree', 'add', '-b', branch, '--', path]);
      return path;
    },
    async makeDirty(repository: string) {
      repository = await requireOwned(repository);
      await writeFile(join(repository, 'tracked.txt'), 'local change\n');
      await writeFile(join(repository, 'untracked.txt'), 'untracked content\n');
    },
    async makeConflicted(repository: string) {
      repository = await requireOwned(repository);
      await git(repository, ['checkout', '-b', 'fixture-other']);
      await writeFile(join(repository, 'tracked.txt'), 'other\n');
      await git(repository, ['commit', '-am', 'other side']);
      await git(repository, ['checkout', 'fixture-base']);
      await writeFile(join(repository, 'tracked.txt'), 'ours\n');
      await git(repository, ['commit', '-am', 'our side']);
      await git(repository, ['merge', '--no-edit', 'fixture-other'], 1);
    },
    async createSentinel(name: string) {
      requireName(name);
      const marker = join(directory, `${name}.executed`);
      const script = join(directory, `${name}.sh`);
      const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
      await writeFile(script, `#!/bin/sh\nprintf executed > ${quote(marker)}\nexit 77\n`, { mode: 0o700, flag: 'wx' });
      return { script, marker, command: quote(script) };
    },
  };
}
