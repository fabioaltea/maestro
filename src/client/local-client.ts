import { randomUUID } from 'node:crypto';
import type { ClientBackend } from '../ports/platform.js';
import type { PublicResult } from '../protocol/messages.js';
import { requireUuid } from '../domain/identifiers.js';

export interface CommandOptions {
  readonly stateDirectory?: string;
  readonly requestId?: string;
  readonly timeoutMs?: number;
}

export class LocalClient {
  constructor(private readonly backend: ClientBackend) {}
  async run(command: 'start' | 'status' | 'stop' | 'restart' | 'operation', options: CommandOptions = {}): Promise<PublicResult> {
    const directory = options.stateDirectory ?? this.backend.defaultDirectory;
    if (command === 'operation') {
      if (!options.requestId) throw new Error('INVALID_REQUEST');
      return this.backend.operation(directory, requireUuid(options.requestId));
    }
    if (command === 'status') return this.backend.inspect(directory);
    const requestId = options.requestId ? requireUuid(options.requestId) : randomUUID();
    const maximum = command === 'stop' ? 10_000 : 30_000;
    const timeout = options.timeoutMs ?? maximum;
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > maximum) throw new Error('INVALID_REQUEST');
    return this.backend.control({ protocolVersion: 1, requestId, action: command, canonicalStateDir: directory }, timeout);
  }
}
