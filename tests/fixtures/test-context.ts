import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

export interface LocalTestContext {
  readonly directory: string;
  spawnNode(args: readonly string[], options?: SpawnOptions): ChildProcess;
  cleanup(): Promise<void>;
}

export async function createTestContext(test: TestContext): Promise<LocalTestContext> {
  const directory = await mkdtemp(join(tmpdir(), 'maestro-test-'));
  const children = new Set<ChildProcess>();
  let cleaned = false;
  const context: LocalTestContext = {
    directory,
    spawnNode(args, options = {}) {
      if (cleaned) throw new Error('Test sandbox already cleaned');
      const child = spawn(process.execPath, [...args], {
        cwd: directory,
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        ...options,
      });
      children.add(child);
      child.once('exit', () => children.delete(child));
      child.once('error', () => { if (child.pid === undefined) children.delete(child); });
      return child;
    },
    async cleanup() {
      if (cleaned) return;
      for (const child of children) {
        if (child.exitCode !== null || child.signalCode !== null) {
          children.delete(child);
          continue;
        }
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.off('exit', onExit);
            reject(new Error(`Owned child has not exited; preserving sandbox ${directory}`));
          }, 2_000);
          const onExit = () => { clearTimeout(timer); resolve(); };
          child.once('exit', onExit);
          if (child.connected) {
            child.send({ type: 'maestro-test-shutdown' }, () => {});
          }
        });
      }
      await rm(directory, { recursive: true });
      cleaned = true;
    },
  };
  test.after(() => context.cleanup());
  return context;
}
