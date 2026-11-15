import { mkdir, lstat, open, rename, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { CORE_ERRORS } from '../shared/core-errors.ts';
import { METHODS } from '../shared/bridge-contract.ts';
import { keys, record, uuid } from '../shared/validation.ts';
export class SafeLog {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private directory: string;
  private maximum: number;
  constructor(directory: string, maximum = 2 * 1024 * 1024) { this.directory = directory; this.maximum = maximum; }
  async write(input: { code: string; action?: string; requestId?: string; durationMs?: number }): Promise<void> {
    keys(record(input), ['code', 'action', 'requestId', 'durationMs']);
    if (!Object.hasOwn(CORE_ERRORS, input.code) && !['OK', 'INVALID_INPUT', 'STALE_CONTEXT', 'LOCAL_BUSY', 'CLIENT_PROTOCOL_ERROR', 'CLIENT_OUTPUT_LIMIT'].includes(input.code)) throw new Error('INVALID_INPUT');
    if (input.action !== undefined && !(METHODS as readonly string[]).includes(input.action)) throw new Error('INVALID_INPUT');
    if (input.requestId !== undefined) uuid(input.requestId);
    if (input.durationMs !== undefined && (!Number.isFinite(input.durationMs) || input.durationMs < 0)) throw new Error('INVALID_INPUT');
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...input }) + '\n';
    if (this.pending >= 32 || Buffer.byteLength(line) > this.maximum) return;
    this.pending++;
    const write = async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const dir = await lstat(this.directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || dir.uid !== process.getuid?.()) throw new Error('UNAUTHORIZED');
      const path = join(this.directory, 'desktop.jsonl'), previous = `${path}.1`;
      const info = await lstat(path).catch(() => null);
      if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error('UNAUTHORIZED');
      if (info && info.size + Buffer.byteLength(line) > this.maximum) {
        await unlink(previous).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; });
        await rename(path, previous);
      }
      const file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
      try { await file.writeFile(line); } finally { await file.close(); }
    };
    const result = this.tail.then(write);
    this.tail = result.catch(() => undefined);
    try { await result; } finally { this.pending--; }
  }
}
