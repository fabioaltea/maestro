import type { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { decodeObject, encodeFrame } from '../../../protocol/validation.js';
const CHUNK = 8192, MAX = 4 * 1024 * 1024, FRAME = 32 * 1024;
/** Reuse Foundation JSON framing, with bounded private transfer pages. */
export async function readContextFrames(stream: Readable): Promise<unknown> {
  let pending = Buffer.alloc(0), total = 0, frames = 0; const bytes: Buffer[] = [];
  for await (const data of stream) {
    pending = Buffer.concat([pending, Buffer.from(data as Uint8Array)]); let newline: number;
    while ((newline = pending.indexOf(10)) >= 0) {
      if (newline > FRAME) throw new Error('CONTEXT_LIMIT');
      const frame = decodeObject(pending.subarray(0, newline)); pending = pending.subarray(newline + 1);
      if (Object.keys(frame).join(',') !== 'data' || typeof frame.data !== 'string') throw new Error('INVALID_REQUEST');
      if (++frames > MAX / CHUNK + 1) throw new Error('CONTEXT_LIMIT');
      const part = Buffer.from(frame.data, 'base64');
      if (!part.length || part.length > CHUNK || part.toString('base64') !== frame.data) throw new Error('INVALID_REQUEST');
      total += part.length; if (total > MAX) throw new Error('CONTEXT_LIMIT'); bytes.push(part);
    }
    if (pending.length > FRAME) throw new Error('CONTEXT_LIMIT');
  }
  if (pending.length || !total) throw new Error('INVALID_REQUEST');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(bytes)));
}
export async function writeContextFrames(stream: Writable, value: unknown): Promise<void> {
  const bytes = Buffer.from(JSON.stringify(value)); if (bytes.length > MAX) throw new Error('CONTEXT_LIMIT');
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    if (!stream.write(encodeFrame({ data: bytes.subarray(offset, offset + CHUNK).toString('base64') }))) await once(stream, 'drain');
  }
  stream.end();
}
