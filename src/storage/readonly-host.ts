import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { foundationError, type SafeError } from '../domain/errors.js';
import type { StorageOptions } from './sqlite-store.js';
import type { StoragePort } from '../ports/storage.js';
import { createStorageProxy, type Method } from './worker.js';
import { reserveReadonlyObservation } from './readonly-database.js';

/** Native SQLite is confined too: its C VFS cannot create WAL files during races. */
export async function openReadonlyStorage(options: StorageOptions): Promise<StoragePort> {
  if (process.platform !== 'darwin') throw new Error('UNSUPPORTED_PLATFORM');
  const profile = fileURLToPath(new URL('../platform/macos/storage/readonly.sb', import.meta.url));
  const main = fileURLToPath(new URL('./readonly-main.js', import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_OPTIONS|NODE_PATH|DYLD_|LD_)/.test(key)));
  env.SQLITE_USE_URI = '1';
  const child = spawn('/usr/bin/sandbox-exec', ['-D', `EXECUTABLE=${process.execPath}`, '-f', profile, process.execPath, main], {
    env, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const listeners = new Set<(error: SafeError) => void>();
  let failed: SafeError | null = null, closing = false, exited = false, nextId = 0;
  let buffer = Buffer.alloc(0);
  const requests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout>; release(): void }>();
  const initial = reserveReadonlyObservation(options.path);
  let readyResolve!: () => void, readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const exit = new Promise<void>(resolve => { child.once('exit', () => { exited = true; resolve(); }); child.once('error', () => { exited = true; resolve(); }); });
  const readyTimer = setTimeout(() => { readyReject(new Error('PERSISTENCE_UNAVAILABLE')); child.kill('SIGKILL'); }, 2_000);
  function fail(error: SafeError) {
    if (failed) return;
    failed ??= error;
    readyReject(new Error(error.code));
    if (!closing) for (const listener of listeners) listener(error);
    // A killed/failed child can still be running until its exit event. Release
    // native writer fences only after that event, never from a mere RPC error.
    const held = [...requests.values()];
    void exit.then(() => { initial.release(); for (const entry of held) entry.release(); });
    for (const entry of requests.values()) { clearTimeout(entry.timer); entry.reject(new Error(error.code)); }
    requests.clear();
  }
  child.once('error', () => fail(foundationError('PERSISTENCE_UNAVAILABLE')));
  child.once('exit', () => { clearTimeout(readyTimer); if (!closing) fail(foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'PROCESS_EXIT' })); });
  child.stdin.on('error', () => fail(foundationError('PERSISTENCE_UNAVAILABLE')));
  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.byteLength > 64 * 1024) { fail(foundationError('OUTPUT_LIMIT')); child.kill('SIGKILL'); return; }
    for (;;) {
      const newline = buffer.indexOf(10); if (newline === -1) return;
      const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
      let message: { ready?: boolean; id?: number; value?: unknown; error?: string; failure?: SafeError };
      try { message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)) as typeof message; }
      catch { fail(foundationError('INVALID_REQUEST')); child.kill('SIGKILL'); return; }
      if (message.ready !== undefined) {
        clearTimeout(readyTimer);
        initial.release();
        if (message.ready) readyResolve(); else readyReject(new Error(message.error ?? 'PERSISTENCE_UNAVAILABLE'));
        continue;
      }
      const entry = requests.get(message.id!); if (!entry) continue;
      requests.delete(message.id!); clearTimeout(entry.timer); entry.release();
      if (message.error) entry.reject(Object.assign(new Error(message.error), { safeFailure: message.failure })); else entry.resolve(message.value);
    }
  });
  child.stdin.write(JSON.stringify({ options: { path: options.path, readonly: true }, quiescent: initial.quiescent }) + '\n');
  try { await ready; }
  catch (error) { clearTimeout(readyTimer); if (!exited) child.kill('SIGKILL'); await exit; initial.release(); throw error; }
  let serialized = Promise.resolve();
  function perform<T>(method: Method, args: unknown[]): Promise<T> {
    if (['commitExecutionState','commitEnvironmentState','commitWorkspaceState','commitWorkspaceLease','settleWorkspaceClaim','commitFeatureState','reconcileWorkflowArtifacts'].includes(method)) return Promise.reject(new Error('UNAUTHORIZED'));
    if (method.includes('Discovery') && !['readDiscoveryMetadata', 'getDiscoveryRunOwner', 'getDiscoveryOperation', 'readDiscoveryArtifact', 'readDiscoveryManifestPage', 'getDiscoveryBudget'].includes(method)) return Promise.reject(new Error('UNAUTHORIZED'));
    if (exited || closing || failed) return Promise.reject(new Error(failed?.code ?? 'PERSISTENCE_UNAVAILABLE'));
    const id = ++nextId;
    const reservation = method === 'close' ? { quiescent: false, release() {} } : reserveReadonlyObservation(options.path);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error('DEADLINE_EXCEEDED')); child.kill('SIGKILL'); }, 2_100);
      requests.set(id, { resolve: value => {
        const encoded = JSON.stringify(value);
        if (method.includes('Discovery') && (!encoded || Buffer.byteLength(encoded) > 32 * 1024)) { reject(new Error('CONTEXT_LIMIT')); return; }
        resolve(value as T);
      }, reject, timer, release: reservation.release });
      child.stdin.write(JSON.stringify({ id, method, args, quiescent: reservation.quiescent }) + '\n');
    });
  }
  function call<T>(method: Method, args: unknown[]): Promise<T> {
    const next = serialized.then(() => perform<T>(method, args));
    serialized = next.then(() => {}, () => {});
    return next;
  }
  let closingPromise: Promise<void> | undefined;
  return createStorageProxy(call, listener => { listeners.add(listener); if (failed) queueMicrotask(() => listener(failed!)); return () => listeners.delete(listener); }, () => {
    closingPromise ??= (async () => {
      if (exited || closing) return;
      try { await call<void>('close', []); closing = true; child.stdin.end(); await exit; }
      catch (error) { child.kill('SIGKILL'); await exit; throw error; }
    })();
    return closingPromise;
  });
}
