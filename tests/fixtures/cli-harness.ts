import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, lstat, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';
import { openStorage } from '../../src/storage/worker.js';
import { createProcessIdentity } from '../../src/platform/macos/process-identity.js';

export const cliFile = resolve('dist/cli/main.js');
export interface CliResult { code: number | null; stdout: string; stderr: string }

export function invokeCli(args: readonly string[], observe?: (child: ChildProcess) => void): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    observe?.(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`CLI ${args[1] ?? args[0]} pid=${child.pid} exceeded 35s; preserve archive; stderr=${stderr.slice(0, 512)}`)), 35_000);
    child.stdout.on('data', chunk => { if (stdout.length < 65_536) stdout += String(chunk); });
    child.stderr.on('data', chunk => { if (stderr.length < 65_536) stderr += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export async function createCliHarness(test: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'maestro-cli-')));
  const archive = join(directory, 'archive');
  const active = new Set<ChildProcess>();
  const call = (command: string, ...args: string[]) => invokeCli(['daemon', command, '--state-dir', archive, '--json', ...args], child => {
    active.add(child);
    child.once('close', () => active.delete(child));
  });
  test.after(async () => {
    const callersDeadline = performance.now() + 5_000;
    while (active.size) {
      if (performance.now() >= callersDeadline) throw new Error(`CLI still active; preserve ${archive}`);
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    let initialized = false;
    try { initialized = (await lstat(join(archive, 'state.sqlite'))).isFile(); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (initialized) {
      const stopped = await call('stop');
      if (stopped.code !== 0) throw new Error(`Stop not verified; preserve ${archive}: ${stopped.stdout || stopped.stderr}`);
      const result = JSON.parse(stopped.stdout) as {requestId: string};
      const store = await openStorage({ path: join(archive, 'state.sqlite'), readonly: true });
      const attempt = await store.getControllerAttempt(result.requestId);
      await store.close();
      if (attempt) {
        const identity = createProcessIdentity();
        const deadline = performance.now() + 2_000;
        while (await identity.probeAbsent(attempt.pid) !== 'ABSENT') {
          if (performance.now() >= deadline) throw new Error(`Controller exit not verified; preserve ${archive}`);
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
      }
    }
    const runtime = `/private/tmp/m-${process.getuid!()}-${createHash('sha256').update(archive).digest('hex').slice(0, 16)}`;
    try {
      const info = await lstat(runtime);
      const marker = JSON.parse(await readFile(join(runtime, 'archive.json'), 'utf8')) as {directory: string};
      if (!info.isDirectory() || info.uid !== process.getuid!() || marker.directory !== archive) throw new Error('Unverified runtime directory');
      await rm(runtime, { recursive: true });
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    await rm(directory, { recursive: true });
  });
  return { directory, archive, call };
}
