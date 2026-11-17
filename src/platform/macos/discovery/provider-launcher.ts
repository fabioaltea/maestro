import type { ProviderInvocation } from '../../../ports/provider.js';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { CODEX_DISCOVERY_PIN, createCodexInvocation, type CodexInvocationInput } from '../../../providers/codex/argv.js';
import { createProviderProfile } from './provider-profile.js';

type LaunchCode = 'PROVIDER_UNSUPPORTED' | 'PROVIDER_UNSAFE' | 'PROVIDER_CONTEXT_LIMIT' | 'PROVIDER_OUTPUT_LIMIT' | 'PROVIDER_UNAVAILABLE' | 'TIMED_OUT';
export type ProviderLaunchResult = { readonly ok: false; readonly code: LaunchCode }
  | { readonly ok: true; readonly exitCode: number | null; readonly signal: NodeJS.Signals | null; readonly stdout: Buffer };

async function privateDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0
    || await realpath(path) !== path) throw new Error('PROVIDER_UNSAFE');
}
async function verifyInstallationMetadata(authHome: string) {
  const file = await open(join(authHome, 'installation_id'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0
      || info.size !== 36) throw new Error('PROVIDER_UNSAFE');
    const bytes = Buffer.alloc(37); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bytes.subarray(0, bytesRead).toString('ascii'))) throw new Error('PROVIDER_UNSAFE');
  } finally { await file.close(); }
}
async function verifyBinary(path: string) {
  if (await realpath(path) !== path) throw new Error('PROVIDER_UNSUPPORTED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || (before.mode & 0o022n) !== 0n) throw new Error('PROVIDER_UNSUPPORTED');
    const digest = createHash('sha256'); const chunk = Buffer.alloc(128 * 1024); let total = 0; let first = true;
    for (;;) {
      const { bytesRead } = await file.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > 512 * 1024 * 1024) throw new Error('PROVIDER_UNSUPPORTED');
      if (first) {
        if (bytesRead < 8 || chunk.readUInt32LE(0) !== 0xfeedfacf || chunk.readUInt32LE(4) !== 0x0100000c) throw new Error('PROVIDER_UNSUPPORTED');
        first = false;
      }
      digest.update(chunk.subarray(0, bytesRead));
    }
    const after = await file.stat({ bigint: true });
    if (digest.digest('hex') !== CODEX_DISCOVERY_PIN.sha256 || before.dev !== after.dev || before.ino !== after.ino
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size) throw new Error('PROVIDER_UNSUPPORTED');
  } finally { await file.close(); }
}
/** Closed production launch boundary reused by the owned Agent host. */
export async function prepareProviderInvocation(invocation: ProviderInvocation): Promise<ProviderInvocation> {
  const modelIndex = invocation.args.indexOf('--model');
  if (modelIndex < 0 || invocation.args.lastIndexOf('--model') !== modelIndex || typeof invocation.env.CODEX_HOME !== 'string') throw new Error('PROVIDER_UNSAFE');
  const input: CodexInvocationInput = { binary: invocation.executable, model: invocation.args[modelIndex + 1]!, runtime: invocation.cwd, authHome: invocation.env.CODEX_HOME, schema: join(invocation.cwd, 'result.schema.json') };
  const expected = createCodexInvocation(input);
  const sortedEnvironment = (env: ProviderInvocation['env']) => JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
  if (JSON.stringify(invocation.args) !== JSON.stringify(expected.args) || sortedEnvironment(invocation.env) !== sortedEnvironment(expected.env)) throw new Error('PROVIDER_UNSAFE');
  await verifyBinary(input.binary); await privateDirectory(input.runtime); await privateDirectory(input.authHome); await verifyInstallationMetadata(input.authHome);
  for (const name of ['scratch', 'scratch/home', 'scratch/tmp', 'scratch/config', 'scratch/cache', 'scratch/data', 'scratch/state']) {
    const directory = join(input.runtime, name); await mkdir(directory, { mode: 0o700, recursive: true }); await privateDirectory(directory);
  }
  const schema = await open(input.schema, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await schema.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > 64 * 1024) throw new Error('PROVIDER_UNSAFE');
  } finally { await schema.close(); }
  const profile = createProviderProfile({ executable: expected.executable, runtime: input.runtime, authHome: input.authHome });
  return { executable: profile.executable, args: [...profile.args, expected.executable, ...expected.args], cwd: expected.cwd, env: expected.env };
}
/** Minimal bounded launcher for qualification; not exposed by CLI/daemon before G0. */
export async function launchConfinedProvider(input: CodexInvocationInput, stdin: string): Promise<ProviderLaunchResult> {
  if (Buffer.byteLength(stdin) > 2 * 1024 * 1024) return { ok: false, code: 'PROVIDER_CONTEXT_LIMIT' };
  try {
    const invocation = await prepareProviderInvocation(createCodexInvocation(input));
    return await new Promise<ProviderLaunchResult>((resolve) => {
      const child = spawn(invocation.executable, [...invocation.args], {
        cwd: invocation.cwd, env: invocation.env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const chunks: Buffer[] = []; let bytes = 0; let lineBytes = 0; let stderrBytes = 0; let failure: LaunchCode | undefined;
      const stop = (code: LaunchCode) => { failure ??= code; child.kill('SIGKILL'); };
      const timer = setTimeout(() => stop('TIMED_OUT'), 10 * 60 * 1000);
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) return stop('PROVIDER_OUTPUT_LIMIT');
        for (const byte of chunk) { lineBytes = byte === 10 ? 0 : lineBytes + 1; if (lineBytes > 1024 * 1024) return stop('PROVIDER_OUTPUT_LIMIT'); }
        chunks.push(chunk);
      });
      // Stderr is drained and bounded but never returned or logged.
      child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 64 * 1024) stop('PROVIDER_OUTPUT_LIMIT'); });
      child.stdin.on('error', () => undefined); child.stdin.end(stdin);
      child.once('error', () => { clearTimeout(timer); resolve({ ok: false, code: 'PROVIDER_UNAVAILABLE' }); });
      child.once('close', (exitCode, signal) => {
        clearTimeout(timer);
        resolve(failure ? { ok: false, code: failure } : { ok: true, exitCode, signal, stdout: Buffer.concat(chunks) });
      });
    });
  } catch (error) {
    const code = error instanceof Error && error.message === 'PROVIDER_UNSUPPORTED' ? 'PROVIDER_UNSUPPORTED' : 'PROVIDER_UNSAFE';
    return { ok: false, code };
  }
}
