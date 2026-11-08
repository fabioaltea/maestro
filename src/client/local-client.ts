import { randomUUID } from 'node:crypto';
import type { ClientBackend } from '../ports/platform.js';
import type { PublicResult } from '../protocol/messages.js';
import { foundationError } from '../domain/errors.js';
import { requireUuid } from '../domain/identifiers.js';

export interface CommandOptions {
  readonly stateDirectory?: string;
  readonly requestId?: string;
  readonly timeoutMs?: number;
  readonly limit?: number;
}

export class LocalClient {
  constructor(private readonly backend: ClientBackend) {}
  async run(command: 'start' | 'status' | 'stop' | 'restart' | 'operation' | 'diagnostics' | 'events', options: CommandOptions = {}): Promise<PublicResult> {
    const directory = options.stateDirectory ?? this.backend.defaultDirectory;
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
        : command === 'events' ? this.backend.events(directory, options.limit)
        : this.backend.control({ protocolVersion: 1, requestId: requestId!, action: command, canonicalStateDir: directory }, timeout);
      // Expiring observation never sends a cancellation to an accepted controller.
      return await Promise.race([observation, expired]);
    } finally { clearTimeout(timer); }
  }
}
