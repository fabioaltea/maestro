import { MAX_FRAME_BYTES, METHODS } from './messages.js';
import type { RpcRequest } from '../ports/platform.js';
import { requireUuid } from '../domain/identifiers.js';

export function decodeObject(frame: string | Uint8Array): Record<string, unknown> {
  const bytes = typeof frame === 'string' ? Buffer.from(frame, 'utf8') : frame;
  if (!bytes.length || bytes.byteLength > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('INVALID_REQUEST'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('INVALID_REQUEST');
  return parsed as Record<string, unknown>;
}

export function encodeFrame(value: unknown): Buffer {
  const encoded = Buffer.from(JSON.stringify(value) + '\n', 'utf8');
  if (encoded.byteLength - 1 > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
  return encoded;
}

export function decodeRequest(frame: string | Uint8Array): RpcRequest {
  const parsed = decodeObject(frame);
  if (parsed.protocolVersion !== 1) throw new Error(typeof parsed.protocolVersion === 'number' ? 'UNSUPPORTED_VERSION' : 'INVALID_REQUEST');
  if (typeof parsed.method !== 'string' || !METHODS.includes(parsed.method as typeof METHODS[number])
    || !parsed.params || typeof parsed.params !== 'object' || Array.isArray(parsed.params)) throw new Error('INVALID_REQUEST');
  try { requireUuid(parsed.correlationId); }
  catch { throw new Error('INVALID_REQUEST'); }
  return { protocolVersion: 1, correlationId: parsed.correlationId as string,
    method: parsed.method, params: parsed.params as Readonly<Record<string, unknown>> };
}
