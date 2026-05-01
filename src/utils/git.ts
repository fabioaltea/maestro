import { execFileSync } from 'node:child_process';

function run(cwd: string, args: string[]): string {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git ${args[0]} failed in ${cwd}: ${msg}`);
  }
}

export function gitIsRepo(cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return true;
  } catch {
    return false;
  }
}

export function gitCurrentBranch(cwd: string): string {
  return run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

export function gitCreateBranch(cwd: string, name: string): void {
  run(cwd, ['checkout', '-b', name]);
}

export function gitCheckoutBranch(cwd: string, name: string): void {
  run(cwd, ['checkout', name]);
}

export function gitStatus(cwd: string): string {
  return run(cwd, ['status', '--short']);
}

export function gitDiff(cwd: string): string {
  return run(cwd, ['diff']);
}

export function gitCommit(cwd: string, message: string): void {
  run(cwd, ['add', '-A']);
  run(cwd, ['commit', '-m', message]);
}
