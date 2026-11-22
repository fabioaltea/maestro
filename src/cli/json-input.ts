import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
export async function jsonFile(path: string | undefined, maxBytes = 32768): Promise<unknown> {
  if (!path) throw new Error('INVALID_REQUEST');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK | constants.O_NOCTTY);
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile() || before.size > BigInt(maxBytes)) throw new Error('INVALID_REQUEST');
    const bytes = Buffer.alloc(maxBytes + 1); let offset = 0;
    while (offset < bytes.length) { const result = await file.read(bytes, offset, bytes.length - offset, null); if (!result.bytesRead) break; offset += result.bytesRead; }
    const after = await file.stat({ bigint: true });
    if (offset > maxBytes || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error('INVALID_REQUEST');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, offset)));
  } finally { await file.close(); }
}
export async function jsonStdin(maxBytes = 32768): Promise<unknown> {
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []; let size = 0, done = false;
    const timer = setTimeout(() => finish(new Error('DEADLINE_EXCEEDED')), 2000);
    const data = (raw: Buffer) => { size += raw.length; if (size > maxBytes) finish(new Error('INVALID_REQUEST')); else chunks.push(raw); };
    const end = () => finish(); const error = () => finish(new Error('INVALID_REQUEST'));
    function finish(problem?: Error) {
      if (done) return; done = true; clearTimeout(timer);
      process.stdin.off('data', data); process.stdin.off('end', end); process.stdin.off('error', error);
      if (problem) { process.stdin.destroy(); reject(problem); } else resolve(Buffer.concat(chunks));
    }
    process.stdin.on('data', data); process.stdin.once('end', end); process.stdin.once('error', error);
  });
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
