import { spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CODEX_DISCOVERY_PIN } from '../../../providers/codex/argv.js';
import { normalizeCodexLoginStatus } from '../../../providers/codex/capabilities.js';
import { codexAuthHome, noFileCredentials, prepareCodexAuthHome } from './provider-inspection.js';
import { privateDirectory, verifyCodexBinary, verifyInstallationMetadata } from './provider-launcher.js';

export interface CodexAccountStatus {
  state: 'CONNECTED' | 'AUTH_REQUIRED' | 'MISSING_CLI' | 'INCOMPATIBLE_CLI' | 'UNAVAILABLE' | 'LOGIN_FAILED' | 'CANCELLED';
  binary: string | null;
  version: string | null;
}

const cwd = '/private/var/empty';
const outputLimit = 8192;
const options = ['-c', 'cli_auth_credentials_store="keyring"', '-c', 'forced_login_method="chatgpt"',
  '-c', 'check_for_update_on_startup=false', '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false'];

type Command = (binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, status: boolean,
  signal: AbortSignal) => Promise<{ code: number | null; output: Buffer }>;

function runCommand(binary: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, status: boolean, signal: AbortSignal) {
  return new Promise<{ code: number | null; output: Buffer }>((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(binary, args, { cwd, env, shell: false, stdio: ['ignore', status ? 'pipe' : 'ignore', status ? 'pipe' : 'ignore'] });
    const chunks: Buffer[] = [];
    let bytes = 0, stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      if (stopping) return;
      stopping = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 500);
    }
    const deadline = setTimeout(stop, status ? 6000 : 180_000);
    signal.addEventListener('abort', stop, { once: true });
    const receive = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > outputLimit) stop();
      else chunks.push(chunk);
    };
    child.stdout?.on('data', receive);
    child.stderr?.on('data', receive);
    child.once('error', stop);
    child.once('close', (code, childSignal) => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', stop);
      if (stopping || childSignal) reject(new Error('PROVIDER_UNAVAILABLE'));
      else resolve({ code, output: Buffer.concat(chunks) });
    });
  });
}

async function exists(path: string) {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export function createCodexAccount({
  home = homedir(), authHome = codexAuthHome(home),
  candidates = [join(home, '.local/bin/codex'), join(home, '.codex/packages/standalone/current/bin/codex'),
    '/opt/homebrew/bin/codex', '/usr/local/bin/codex'],
  verify = verifyCodexBinary, run = runCommand,
} : { home?: string; authHome?: string; candidates?: string[]; verify?: typeof verifyCodexBinary; run?: Command } = {}) {
  const env: NodeJS.ProcessEnv = { HOME: home, CODEX_HOME: authHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

  async function validateProfile() {
    await privateDirectory(authHome);
    await verifyInstallationMetadata(authHome);
    await noFileCredentials(authHome);
    // The dedicated authentication profile uses the CLI defaults and fixed overrides.
    if (await exists(join(authHome, 'config.toml'))) throw new Error('PROVIDER_UNSAFE');
  }

  async function findBinary() {
    let found: string | null = null;
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (!await exists(candidate)) continue;
      found ??= candidate;
      try {
        const path = await realpath(candidate);
        if (seen.has(path)) continue;
        seen.add(path);
        await verify(path);
        return { binary: path, version: CODEX_DISCOVERY_PIN.version };
      } catch { /* A different standard installation may match the pin. */ }
    }
    return { binary: found, version: null };
  }

  async function status(binary: string, signal: AbortSignal): Promise<CodexAccountStatus['state']> {
    if (!await exists(authHome)) return 'AUTH_REQUIRED';
    await validateProfile();
    const result = await run(binary, ['--no-daemon', 'login', 'status', ...options], cwd, env, true, signal);
    await noFileCredentials(authHome);
    const state = normalizeCodexLoginStatus(result.code, result.output);
    return state === 'CHATGPT' ? 'CONNECTED' : state === 'AUTH_REQUIRED' ? state : 'UNAVAILABLE';
  }

  return async function account(action: 'status' | 'login', signal: AbortSignal): Promise<CodexAccountStatus> {
    let metadata: Pick<CodexAccountStatus, 'binary' | 'version'> = { binary: null, version: null };
    try {
      if (process.platform !== 'darwin') return { ...metadata, state: 'UNAVAILABLE' };
      metadata = await findBinary();
      signal.throwIfAborted();
      const { binary, version } = metadata;
      if (!binary || !version) return { ...metadata, state: binary ? 'INCOMPATIBLE_CLI' : 'MISSING_CLI' };
      const current = await status(binary, signal);
      if (action === 'status' || current !== 'AUTH_REQUIRED') return { ...metadata, state: current };

      await prepareCodexAuthHome(authHome);
      await validateProfile();
      await verify(binary);
      const login = await run(binary, ['--no-daemon', 'login', ...options], cwd, env, false, signal);
      await validateProfile();
      await verify(binary);
      const confirmed = await status(binary, signal);
      return { ...metadata, state: confirmed === 'CONNECTED' ? confirmed : login.code === 0 ? confirmed : 'LOGIN_FAILED' };
    } catch {
      return { ...metadata, state: signal.aborted ? 'CANCELLED' : 'UNAVAILABLE' };
    }
  };
}
