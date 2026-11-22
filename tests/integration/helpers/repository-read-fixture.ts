import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function repositoryReadFixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'maestro-repository-read-')));
  const root = join(directory, 'repo');
  const detached = join(directory, 'detached');
  const gitAt = (cwd: string, ...args: string[]) => execFileSync('/usr/bin/git', [
    '--no-pager', '--no-optional-locks', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
    '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args,
  ], { cwd, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trimEnd();
  const git = (...args: string[]) => gitAt(root, ...args);
  const dispose = () => rmSync(directory, { recursive: true, force: true });
  try {
    gitAt(directory, 'init', '--initial-branch=main', 'repo');
    writeFileSync(join(root, 'code.ts'), 'export const branch = "main";\n');
    git('add', '--', 'code.ts');
    git('commit', '-m', 'Base');
    const base = git('rev-parse', 'HEAD');
    git('switch', '-c', 'topic');
    writeFileSync(join(root, 'topic.txt'), 'topic\n');
    git('add', '--', 'topic.txt');
    git('commit', '-m', 'Topic');
    git('switch', 'main');
    writeFileSync(join(root, 'main-only.txt'), 'main side\n');
    git('add', '--', 'main-only.txt');
    git('commit', '-m', 'Main side');
    const firstParent = git('rev-parse', 'HEAD');
    git('merge', '--no-ff', '-m', 'Merge topic', 'topic');
    const main = git('rev-parse', 'HEAD');
    git('tag', 'release', main);
    git('worktree', 'add', '--detach', detached, base);
    git('switch', 'topic');
    writeFileSync(join(root, 'code.ts'), 'dirty checkout\n');
    const snapshot = () => ({
      refs: git('show-ref', '--head'), status: git('status', '--porcelain=v2'),
      worktrees: git('worktree', 'list', '--porcelain'), file: readFileSync(join(root, 'code.ts')),
      index: readFileSync(join(root, '.git', 'index')),
      detachedIndex: readFileSync(gitAt(detached, 'rev-parse', '--path-format=absolute', '--git-path', 'index')),
    });
    return { root, detached, main, base, firstParent, git, snapshot, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
