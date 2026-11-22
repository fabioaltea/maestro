import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { CODEX_ACCOUNT_STATES, type CodexAccountStatus } from '../shared/codex-contract.ts';
import type { ArchiveContext } from './archive-context.ts';
import type { BridgeRouter } from './bridge.ts';
import type { Runtime } from './runtime.ts';

const unavailable: CodexAccountStatus = { state: 'UNAVAILABLE', binary: null, version: null };
type Setup = { state: 'READY' | 'BLOCKED'; code: string | null };
const unavailableSetup: Setup = { state: 'BLOCKED', code: 'PROVIDER_UNAVAILABLE' };

function request(runtime: Runtime, args: string[], timeout: number, signal: AbortSignal): Promise<unknown> {
  return new Promise(resolve => {
    if (signal.aborted) { resolve(null); return; }
    const child = spawn(runtime.node, [runtime.cli, 'codex', ...args], {
      env: runtime.env, shell: false, stdio: ['ignore', 'pipe', 'ignore', 'ipc'],
    });
    const buffers: Buffer[] = [];
    let total = 0;
    let stopping = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    function stop() {
      if (stopping) return;
      stopping = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 1500);
    }
    const deadline = setTimeout(stop, timeout);
    signal.addEventListener('abort', stop, { once: true });
    child.stdout?.on('data', (bytes: Buffer) => {
      total += bytes.length;
      if (total > 8192) stop();
      else buffers.push(bytes);
    });
    child.once('error', stop);
    child.once('close', code => {
      clearTimeout(deadline);
      clearTimeout(killTimer);
      signal.removeEventListener('abort', stop);
      if (!stopping && code === 0) {
        try { resolve(JSON.parse(Buffer.concat(buffers).toString('utf8'))); return; }
        catch { /* Invalid response. */ }
      }
      resolve(null);
    });
  });
}

function decodeAccount(value: unknown): CodexAccountStatus {
  const account = value as CodexAccountStatus | null;
  if (!account || !CODEX_ACCOUNT_STATES.includes(account.state)
    || !(account.binary === null || typeof account.binary === 'string' && isAbsolute(account.binary) && !/[\x00-\x1f\x7f]/.test(account.binary))
    || !(account.version === null || typeof account.version === 'string' && /^\d+\.\d+\.\d+$/.test(account.version))) return unavailable;
  return { state: account.state, binary: account.binary, version: account.version };
}

export function installCodex(router: BridgeRouter, archive: ArchiveContext, runtime: Runtime | null) {
  const session = new AbortController();
  let account: { action: 'login' | 'status'; controller: AbortController; result: Promise<CodexAccountStatus> } | undefined;
  let setup: { storeId: string; result: Promise<Setup> } | undefined;
  function runAccount(action: 'login' | 'status'): Promise<CodexAccountStatus> {
    if (!runtime || session.signal.aborted) return Promise.resolve(unavailable);
    if (account) {
      if (action === 'login' && account.action === 'status') return account.result.then(() => runAccount(action));
      return account.result;
    }
    const controller = new AbortController();
    const result = request(runtime, [action], action === 'login' ? 200_000 : 10_000, AbortSignal.any([session.signal, controller.signal]))
      .then(value => controller.signal.aborted ? { ...unavailable, state: 'CANCELLED' as const } : decodeAccount(value))
      .finally(() => { account = undefined; });
    account = { action, controller, result };
    return result;
  }
  router.register('codexStatus', () => runAccount('status'));
  router.register('codexLogin', () => runAccount('login'));
  router.register('cancelCodexLogin', () => {
    if (account?.action === 'login') account.controller.abort();
    return null;
  });
  router.register('checkCodexDiscovery', async () => {
    if (!runtime) return unavailableSetup;
    const { path, view } = archive.capture();
    if (!view.storeId) return unavailableSetup;
    if (setup) return setup.storeId === view.storeId ? setup.result : unavailableSetup;
    const result = request(runtime, ['configure', '--state-dir', path, '--store-id', view.storeId], 25_000, session.signal)
      .then(value => {
        const checked = value as Setup | null;
        if (checked?.state === 'READY' && checked.code === null) return { state: 'READY', code: null } as const;
        if (checked?.state === 'BLOCKED' && typeof checked.code === 'string' && /^[A-Z_]{1,64}$/.test(checked.code)) {
          return { state: 'BLOCKED', code: checked.code } as const;
        }
        return unavailableSetup;
      })
      .finally(() => { setup = undefined; });
    setup = { storeId: view.storeId, result };
    return result;
  });
  router.window.once('closed', () => session.abort());
}
