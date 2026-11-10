import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SQLiteStore, type StorageOptions } from './sqlite-store.js';
import { foundationError, type SafeError } from '../domain/errors.js';
import type { StoragePort } from '../ports/storage.js';

export const methods = ['captureEventState', 'recordEvents', 'drainEvents', 'getEventState', 'listEvents', 'listTickets', 'reopenOperation', 'retireTicket', 'reconcileInstanceAbsent', 'readSnapshot', 'getOperation', 'acceptOperation', 'setOperationPhase',
  'getProject', 'commitProjectRegistration', 'getRequestReservation', 'acceptProjectOperation', 'getProjectOperation', 'listPendingProjectOperations', 'setProjectOperationPhase', 'completeProjectOperation',
  'resumeBlocked', 'cancelIssuedTickets', 'prepareShutdown', 'recordInstanceError', 'blockInstance', 'completeOperation', 'issueTicket', 'claimTicket', 'cancelTicket', 'getTicket', 'recordInstance',
  'transitionInstance', 'saveResource', 'listResources', 'recordControllerAttempt', 'getControllerAttempt', 'finishControllerAttempt', 'close'] as const;
export type Method = typeof methods[number];
interface Request { id: number; method: Method; args: unknown[] }

export function classifyStorageFailure(error: unknown): SafeError {
  if (error instanceof Error) {
    if ('safeFailure' in error) return error.safeFailure as SafeError;
    const native = 'code' in error && typeof error.code === 'string' ? error.code : '';
    if (/^(SQLITE_FULL|ENOSPC|EDQUOT)$/.test(native)) return foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'DISK_FULL' });
    if (/^(SQLITE_READONLY|EACCES|EROFS)/.test(native)) return foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'READ_ONLY' });
    if (/^SQLITE_(CORRUPT|NOTADB)/.test(native)) return foundationError('STATE_CORRUPT', { cause: 'CORRUPT' });
    if (/^(SQLITE_IOERR|SQLITE_CANTOPEN|EIO)/.test(native)) return foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'IO_ERROR' });
    if (/^SQLITE_(BUSY|LOCKED)/.test(native)) return foundationError('BUSY');
    try { return foundationError(error.message as SafeError['code']); } catch { /* Never expose the driver's raw message. */ }
  }
  return foundationError('PERSISTENCE_UNAVAILABLE');
}
const safeCode = (error: unknown) => classifyStorageFailure(error).code;

if (!isMainThread) {
  const port = parentPort!;
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(workerData as StorageOptions);
    port.postMessage({ ready: true });
    let queue = Promise.resolve();
    const reads = new Set<Method>(['readSnapshot', 'getOperation', 'getProject', 'getRequestReservation', 'getProjectOperation', 'listPendingProjectOperations', 'getEventState', 'listEvents', 'getTicket', 'listTickets', 'listResources', 'getControllerAttempt']);
    port.on('message', (request: Request) => {
      const execute = async () => {
        if (!Number.isSafeInteger(request.id) || !methods.includes(request.method) || !Array.isArray(request.args)) {
          port.postMessage({ id: request.id, error: 'INVALID_REQUEST' });
          return;
        }
        const deadline = performance.now() + 1_900;
        for (;;) {
          try {
            const value: unknown = Reflect.apply(store[request.method], store, request.args);
            port.postMessage({ id: request.id, value });
            if (request.method === 'close') port.close();
            return;
          } catch (error) {
            const code = safeCode(error);
            const nativeBusy = error instanceof Error && 'code' in error
              && typeof error.code === 'string' && /^SQLITE_(BUSY|LOCKED)/.test(error.code);
            if (nativeBusy && performance.now() < deadline) {
              await new Promise<void>(resolve => setTimeout(resolve, 10));
              continue;
            }
            port.postMessage({ id: request.id, error: code, failure: classifyStorageFailure(error) });
            return;
          }
        }
      };
      const failed = () => port.postMessage({id: request.id, error: 'PERSISTENCE_UNAVAILABLE'});
      // Synchronous SQLite calls always finish their transaction before yielding. Reads may run while a writer retries a busy lock.
      if (reads.has(request.method)) void execute().catch(failed);
      else queue = queue.then(execute).catch(failed);
    });
  } catch (error) {
    port.postMessage({ ready: false, error: safeCode(error), failure: classifyStorageFailure(error) });
    port.close();
  }
}

export async function openStorage(options: StorageOptions, host: { observeWorker?(worker: Worker): void } = {}): Promise<StoragePort> {
  if (!isMainThread) throw new Error('INVALID_REQUEST');
  if (options.readonly) return (await import('./readonly-host.js')).openReadonlyStorage(options);
  const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: options, execArgv: [] });
  host.observeWorker?.(worker);
  let failure: SafeError | null = null;
  const listeners = new Set<(error: SafeError) => void>();
  function notify(error: SafeError) {
    if (closing || failure) return;
    failure = error;
    for (const listener of listeners) listener(error);
  }
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let nextId = 0;
  let closing = false;
  let exited = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => rejectReady(new Error('PERSISTENCE_UNAVAILABLE')), 2_000);
  function rejectPending() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('PERSISTENCE_UNAVAILABLE'));
    }
    pending.clear();
  }
  worker.on('message', (message: { ready?: boolean; id?: number; error?: string; failure?: SafeError; value?: unknown }) => {
    if (message.ready !== undefined) {
      clearTimeout(readyTimer);
      if (message.ready) resolveReady();
      else rejectReady(new Error(message.error ?? 'PERSISTENCE_UNAVAILABLE'));
      return;
    }
    if (message.id === undefined) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error) {
      const safe = message.failure ?? classifyStorageFailure(new Error(message.error));
      if (['PERSISTENCE_UNAVAILABLE', 'STATE_CORRUPT', 'STATE_INCOMPATIBLE'].includes(safe.code)) notify(safe);
      entry.reject(Object.assign(new Error(message.error), { safeFailure: safe }));
    }
    else entry.resolve(message.value);
  });
  worker.on('error', () => { notify(foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'WORKER_EXIT' })); clearTimeout(readyTimer); rejectReady(new Error('PERSISTENCE_UNAVAILABLE')); rejectPending(); });
  worker.on('exit', () => { exited = true; notify(foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'WORKER_EXIT' })); clearTimeout(readyTimer); rejectReady(new Error('PERSISTENCE_UNAVAILABLE')); rejectPending(); });
  try { await ready; }
  catch (error) { clearTimeout(readyTimer); await worker.terminate(); throw error; }

  function call<T>(method: Method, args: unknown[]): Promise<T> {
    if (closing || exited) return Promise.reject(new Error('PERSISTENCE_UNAVAILABLE'));
    if (failure && !['readSnapshot', 'getOperation', 'getProject', 'getRequestReservation', 'getProjectOperation', 'listPendingProjectOperations', 'getTicket', 'listTickets', 'getEventState', 'listEvents', 'listResources', 'getControllerAttempt', 'close'].includes(method)) return Promise.reject(new Error(failure.code));
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        notify(foundationError('PERSISTENCE_UNAVAILABLE', { cause: 'IO_ERROR' }));
        reject(new Error('DEADLINE_EXCEEDED'));
      }, 2_100);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      worker.postMessage({ id, method, args });
    });
  }
  return createStorageProxy(call, listener => { listeners.add(listener); if (failure) queueMicrotask(() => listener(failure!)); return () => listeners.delete(listener); }, async () => {
    if (exited || closing) return;
    const exit = new Promise<void>(resolve => worker.once('exit', () => resolve()));
    const result = call<void>('close', []);
    closing = true;
    try { await result; await exit; }
    catch (error) { await worker.terminate(); throw error; }
  });
}
export function createStorageProxy(call: <T>(method: Method, args: unknown[]) => Promise<T>, onFailure: StoragePort['onFailure'], close: StoragePort['close']): StoragePort {
  return {
    getProject: id => call('getProject', [id]),
    commitProjectRegistration: input => call('commitProjectRegistration', [input]),
    getRequestReservation: id => call('getRequestReservation', [id]),
    acceptProjectOperation: intent => call('acceptProjectOperation', [intent]),
    getProjectOperation: id => call('getProjectOperation', [id]),
    listPendingProjectOperations: () => call('listPendingProjectOperations', []),
    setProjectOperationPhase: (id, phase) => call('setProjectOperationPhase', [id, phase]),
    completeProjectOperation: (id, result) => call('completeProjectOperation', [id, result]),
    recordEvents: drafts => call('recordEvents', [drafts]),
    drainEvents: () => call('drainEvents', []),
    captureEventState: () => call('captureEventState', []),
    getEventState: verify => call('getEventState', [verify ?? false]),
    listEvents: options => call('listEvents', [options ?? {}]),
    onFailure,
    listTickets: id => call('listTickets', [id]),
    reopenOperation: id => call('reopenOperation', [id]),
    retireTicket: (id, generation, pid) => call('retireTicket', [id, generation, pid]),
    reconcileInstanceAbsent: (id, generation) => call('reconcileInstanceAbsent', [id, generation]),
    readSnapshot: () => call('readSnapshot', []),
    getOperation: id => call('getOperation', [id]),
    acceptOperation: intent => call('acceptOperation', [intent]),
    resumeBlocked: (id, target) => call('resumeBlocked', [id, target]),
    cancelIssuedTickets: id => call('cancelIssuedTickets', [id]),
    prepareShutdown: (id, generation) => call('prepareShutdown', [id, generation]),
    recordInstanceError: (id, error) => call('recordInstanceError', [id, error]),
    blockInstance: (id, error) => call('blockInstance', [id, error]),
    setOperationPhase: (id, phase) => call('setOperationPhase', [id, phase]),
    completeOperation: (id, outcome, completedAt, error) => call('completeOperation', [id, outcome, completedAt, error]),
    issueTicket: ticket => call('issueTicket', [ticket]),
    claimTicket: (id, generation, pid) => call('claimTicket', [id, generation, pid]),
    cancelTicket: id => call('cancelTicket', [id]),
    getTicket: id => call('getTicket', [id]),
    recordInstance: instance => call('recordInstance', [instance]),
    transitionInstance: (id, state) => call('transitionInstance', [id, state]),
    saveResource: resource => call('saveResource', [resource]),
    listResources: id => call('listResources', [id]),
    recordControllerAttempt: attempt => call('recordControllerAttempt', [attempt]),
    getControllerAttempt: id => call('getControllerAttempt', [id]),
    finishControllerAttempt: (id, endedAt, result) => call('finishControllerAttempt', [id, endedAt, result]),
    close,
  };
}
