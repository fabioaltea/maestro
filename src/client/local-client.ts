import { randomUUID } from 'node:crypto';
import type { ClientBackend } from '../ports/platform.js';
import type { PublicResult } from '../protocol/messages.js';
import { foundationError } from '../domain/errors.js';
import { decodeCursor } from '../protocol/event-cursor.js';
import { requireUuid } from '../domain/identifiers.js';
import { decodeProjectOperationView, validateProjectAdmission, validateProjectParams } from '../protocol/validation.js';

export interface CommandOptions {
  readonly stateDirectory?: string;
  readonly requestId?: string;
  readonly timeoutMs?: number;
  readonly limit?: number;
  readonly after?: string;
}

export class LocalClient {
  constructor(private readonly backend: ClientBackend) {}
  async runProject(command: 'register' | 'list' | 'get' | 'verify' | 'update' | 'remove' | 'operation',
    params: Readonly<Record<string, unknown>>, options: CommandOptions = {}): Promise<PublicResult> {
    const method = command === 'operation' ? 'projects.operation.get' : `projects.${command}`;
    const mutation = ['register', 'verify', 'update', 'remove'].includes(command);
    const maximum = mutation ? 30_000 : 2_000;
    const timeout = options.timeoutMs ?? maximum;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > maximum || options.limit !== undefined || options.after !== undefined
      || (!mutation && options.requestId !== undefined) || (mutation && Object.hasOwn(params, 'requestId'))) throw new Error('INVALID_REQUEST');
    const requestId = mutation ? requireUuid(options.requestId ?? randomUUID()) : command === 'operation' ? requireUuid(params.requestId) : null;
    const original = mutation || command === 'operation' ? { ...params, requestId } : { ...params };
    validateProjectParams(method, original);
    const send = this.backend.project?.bind(this.backend);
    if (!send) throw new Error('UNSUPPORTED_VERSION');
    const directory = options.stateDirectory ?? this.backend.defaultDirectory;
    const expires = performance.now() + timeout;
    const unknown = (): PublicResult => ({ protocolVersion: 1, storeId: null, instanceId: null, requestId,
      result: 'UNKNOWN_OUTCOME', outcome: null, freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {},
      error: foundationError('UNKNOWN_OUTCOME', requestId ? { operationId: requestId } : {}) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<PublicResult>(resolve => { timer = setTimeout(() => resolve(unknown()), timeout); });
    const observe = async () => {
      let response = await send(directory, method, original, Math.max(1, expires - performance.now()));
      let backoff = 50, admitted = false;
      for (;;) {
        if (response.requestId !== requestId && (requestId !== null || response.requestId !== null)) throw new Error('INVALID_REQUEST');
        if (response.data.operation !== undefined) {
          const operation = decodeProjectOperationView(response.data.operation);
          if (operation.requestId !== requestId || operation.outcome !== response.outcome) throw new Error('INVALID_REQUEST');
          if (!mutation || operation.outcome !== 'IN_PROGRESS') return response;
          admitted = true;
        } else if (Object.hasOwn(response.data, 'accepted')) {
          const { storeId: _store, observabilityDegraded: _degraded, ...admission } = response.data;
          validateProjectAdmission(admission);
          if (admission.requestId !== requestId) throw new Error('INVALID_REQUEST');
          if (admission.accepted === false) return admitted && mutation ? unknown() : response;
          admitted = true;
          if (!mutation || response.outcome !== 'IN_PROGRESS') throw new Error('INVALID_REQUEST');
        } else {
          if (mutation && admitted) return unknown();
          if (response.outcome === 'IN_PROGRESS' || (mutation && !response.error)) throw new Error('INVALID_REQUEST');
          return response;
        }
        const remaining = expires - performance.now();
        if (remaining <= backoff) return await expired;
        await new Promise(resolve => setTimeout(resolve, backoff));
        backoff = Math.min(250, backoff * 2);
        if (performance.now() >= expires) return unknown();
        response = await send(directory, 'projects.operation.get', { requestId }, Math.max(1, expires - performance.now()));
      }
    };
    try { return await Promise.race([observe(), expired]); }
    catch (error) { if (mutation) return unknown(); throw error; }
    finally { clearTimeout(timer); }
  }
  async followEvents(consume: (frame: import('../protocol/messages.js').StreamEventFrame) => Promise<void>, options: CommandOptions & {signal?: AbortSignal} = {}) {
    if (options.requestId || options.limit !== undefined || (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 2_000))) throw new Error('INVALID_REQUEST');
    return this.backend.follow(options.stateDirectory ?? this.backend.defaultDirectory, consume, options.signal, options.timeoutMs, options.after === undefined ? undefined : decodeCursor(options.after));
  }
  async run(command: 'start' | 'status' | 'stop' | 'restart' | 'operation' | 'diagnostics' | 'events', options: CommandOptions = {}): Promise<PublicResult> {
    const directory = options.stateDirectory ?? this.backend.defaultDirectory;
    if (options.after !== undefined && command !== 'events') throw new Error('INVALID_REQUEST');
    const after = options.after === undefined ? undefined : decodeCursor(options.after);
    const reading = ['status', 'operation', 'diagnostics', 'events'].includes(command);
    if (options.limit !== undefined && (command !== 'events' || !Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000)) throw new Error('INVALID_REQUEST');
    const maximum = reading ? 2_000 : command === 'stop' ? 10_000 : 30_000;
    const timeout = options.timeoutMs ?? maximum;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > maximum) throw new Error('INVALID_REQUEST');
    const requestId = ['status', 'diagnostics', 'events'].includes(command) ? null : options.requestId ? requireUuid(options.requestId)
      : command === 'operation' ? null : randomUUID();
    if (command === 'operation' && requestId === null) throw new Error('INVALID_REQUEST');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<PublicResult>(resolve => {
      timer = setTimeout(() => resolve({ protocolVersion: 1, requestId, storeId: null, instanceId: null,
        result: 'UNKNOWN_OUTCOME', outcome: null, freshness: 'LAST_KNOWN', liveness: 'UNKNOWN', data: {},
        error: foundationError('DEADLINE_EXCEEDED', requestId ? { operationId: requestId } : {}),
      }), timeout);
    });
    try {
      const observation = command === 'status' ? this.backend.inspect(directory)
        : command === 'operation' ? this.backend.operation(directory, requestId!)
        : command === 'diagnostics' ? this.backend.diagnostics(directory)
        : command === 'events' ? this.backend.events(directory, options.limit, after)
        : this.backend.control({ protocolVersion: 1, requestId: requestId!, action: command, canonicalStateDir: directory }, timeout);
      // Expiring observation never sends a cancellation to an accepted controller.
      return await Promise.race([observation, expired]);
    } finally { clearTimeout(timer); }
  }
}
