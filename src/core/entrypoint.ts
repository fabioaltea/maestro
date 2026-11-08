import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { MAX_FRAME_BYTES } from '../protocol/messages.js';

export function isEntrypoint(url: string): boolean {
  return process.argv[1] !== undefined && fileURLToPath(url) === resolve(process.argv[1]);
}
export async function readBootstrap(): Promise<Record<string, unknown>> {
  let buffer = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk as Uint8Array)]);
    if (buffer.byteLength > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
  }
  if (buffer.at(-1) !== 10) throw new Error('INVALID_REQUEST');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)); }
  catch { throw new Error('INVALID_REQUEST'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function reportBootstrap(accepted: boolean, errorCode?: string): void {
  if (!process.connected || !process.send) return;
  try {
    process.send({ kind: 'bootstrap', accepted, ...(errorCode ? { errorCode } : {}) }, () => {
      try { if (process.connected) process.disconnect!(); } catch { /* Parent may already have disconnected. */ }
    });
  } catch { /* The accepted core operation must outlive its client. */ }
}
