import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { SQLiteStore, type StorageOptions } from './sqlite-store.js';
import type { StoragePort } from '../ports/storage.js';

const methods = ['readSnapshot', 'getOperation', 'acceptOperation', 'setOperationPhase',
  'completeOperation', 'issueTicket', 'claimTicket', 'cancelTicket', 'getTicket', 'recordInstance',
  'transitionInstance', 'saveResource', 'listResources', 'close'] as const;
type Method = typeof methods[number];
interface Request { id: number; method: Method; args: unknown[] }

function safeCode(error: unknown): string {
  if (error instanceof Error) {
    if (/^(INVALID_REQUEST|INVALID_IDENTIFIER|INVALID_TRANSITION|UNAUTHORIZED|STATE_INCOMPATIBLE|STATE_CORRUPT|STALE_TARGET|IDEMPOTENCY_CONFLICT|BUSY|PERSISTENCE_UNAVAILABLE)$/.test(error.message)) return error.message;
    if ('code' in error && typeof error.code === 'string') {
      if (/^SQLITE_(BUSY|LOCKED)/.test(error.code)) return 'BUSY';
      if (/^SQLITE_(CORRUPT|NOTADB)/.test(error.code)) return 'STATE_CORRUPT';
      if (/^SQLITE_(FULL|IOERR|READONLY|CANTOPEN)/.test(error.code)) return 'PERSISTENCE_UNAVAILABLE';
    }
  }
  return 'PERSISTENCE_UNAVAILABLE';
}

if (!isMainThread) {
  const port = parentPort!;
  let store: SQLiteStore;
  try {
    store = new SQLiteStore(workerData as StorageOptions);
    port.postMessage({ ready: true });
    let queue = Promise.resolve();
    port.on('message', (request: Request) => {
      queue = queue.then(async () => {
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
            port.postMessage({ id: request.id, error: code });
            return;
          }
        }
      }).catch(() => {
        port.postMessage({ id: request.id, error: 'PERSISTENCE_UNAVAILABLE' });
      });
    });
  } catch (error) {
    port.postMessage({ ready: false, error: safeCode(error) });
    port.close();
  }
}

export async function openStorage(options: StorageOptions): Promise<StoragePort> {
  if (!isMainThread) throw new Error('INVALID_REQUEST');
  const worker = new Worker(new URL('./worker.js', import.meta.url), { workerData: options });
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
  worker.on('message', (message: { ready?: boolean; id?: number; error?: string; value?: unknown }) => {
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
    if (message.error) entry.reject(new Error(message.error));
    else entry.resolve(message.value);
  });
  worker.on('error', () => { clearTimeout(readyTimer); rejectReady(new Error('PERSISTENCE_UNAVAILABLE')); rejectPending(); });
  worker.on('exit', () => { exited = true; clearTimeout(readyTimer); rejectReady(new Error('PERSISTENCE_UNAVAILABLE')); rejectPending(); });
  try { await ready; }
  catch (error) { clearTimeout(readyTimer); await worker.terminate(); throw error; }

  function call<T>(method: Method, args: unknown[]): Promise<T> {
    if (closing || exited) return Promise.reject(new Error('PERSISTENCE_UNAVAILABLE'));
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('DEADLINE_EXCEEDED'));
      }, 2_100);
      pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      worker.postMessage({ id, method, args });
    });
  }
  return {
    readSnapshot: () => call('readSnapshot', []),
    getOperation: id => call('getOperation', [id]),
    acceptOperation: intent => call('acceptOperation', [intent]),
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
    async close() {
      if (exited || closing) return;
      const exit = new Promise<void>(resolve => worker.once('exit', () => resolve()));
      const result = call<void>('close', []);
      closing = true;
      try { await result; await exit; }
      catch (error) { await worker.terminate(); throw error; }
    },
  };
}
