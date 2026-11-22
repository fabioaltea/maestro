import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { createTestContext } from './test-context.js';

export async function createProcessSandbox(test: TestContext) {
  const context = await createTestContext(test);
  const owned = new WeakSet<ChildProcess>();
  function requireOwned(child: ChildProcess) {
    if (!owned.has(child)) throw new Error('UNOWNED_PROCESS');
  }
  return {
    directory: context.directory,
    cleanup: context.cleanup,
    spawnFixture(name: string, args: readonly string[] = []) {
      if (!/^[a-z0-9-]+\.js$/.test(name)) throw new Error('INVALID_FIXTURE');
      const path = fileURLToPath(new URL(name, import.meta.url));
      const child = context.spawnNode([path, ...args]);
      owned.add(child);
      return child;
    },
    waitForMessage(child: ChildProcess, type: string, timeoutMs = 2_000): Promise<void> {
      requireOwned(child);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { dispose(); reject(new Error('FIXTURE_MESSAGE_TIMEOUT')); }, timeoutMs);
        const exit = () => { dispose(); reject(new Error('FIXTURE_EXITED_BEFORE_MESSAGE')); };
        const message = (value: unknown) => {
          if (value && typeof value === 'object' && 'type' in value && value.type === type) { dispose(); resolve(); }
        };
        function dispose() { clearTimeout(timer); child.off('message', message); child.off('exit', exit); }
        child.on('message', message);
        child.once('exit', exit);
      });
    },
    async requestExit(child: ChildProcess, mode: 'shutdown' | 'crash'): Promise<number | null> {
      requireOwned(child);
      if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
      if (!child.connected) throw new Error('UNVERIFIABLE_OWNED_CHILD');
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { child.off('exit', exited); reject(new Error('FIXTURE_EXIT_TIMEOUT')); }, 2_000);
        const exited = (code: number | null) => { clearTimeout(timer); resolve(code); };
        child.once('exit', exited);
        child.send({ type: mode === 'crash' ? 'maestro-test-crash' : 'maestro-test-shutdown' }, error => {
          if (error) { clearTimeout(timer); child.off('exit', exited); reject(error); }
        });
      });
    },
  };
}
