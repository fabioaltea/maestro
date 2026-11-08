import { spawn } from 'node:child_process';
import { mkdtemp, lstat, realpath, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { TestContext } from 'node:test';

export const cliFile = resolve('dist/cli/main.js');
export interface CliResult { code: number | null; stdout: string; stderr: string }

export function invokeCli(args: readonly string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliFile, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('CLI exceeded the 35s harness deadline; preserve its archive')), 35_000);
    child.stdout.on('data', chunk => { if (stdout.length < 65_536) stdout += String(chunk); });
    child.stderr.on('data', chunk => { if (stderr.length < 65_536) stderr += String(chunk); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

export async function createCliHarness(test: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'maestro-cli-')));
  const archive = join(directory, 'archive');
  const call = (command: string, ...args: string[]) => invokeCli(['daemon', command, '--state-dir', archive, '--json', ...args]);
  test.after(async () => {
    let initialized = false;
    try { initialized = (await lstat(join(archive, 'state.sqlite'))).isFile(); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (initialized) {
      const stopped = await call('stop');
      if (stopped.code !== 0) throw new Error(`Stop not verified; preserve ${archive}: ${stopped.stdout || stopped.stderr}`);
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
