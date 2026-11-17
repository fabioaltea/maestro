import { SQLiteStore, type StorageOptions } from './sqlite-store.js';
import { classifyStorageFailure, methods, type Method } from './worker.js';

let store: SQLiteStore | undefined;
let pending = Buffer.alloc(0);
let initialized = false;
let options: StorageOptions;
const limit = 64 * 1024;
function send(value: unknown) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.byteLength > limit) throw new Error('OUTPUT_LIMIT');
  process.stdout.write(bytes);
}
process.stdin.on('data', (chunk: Buffer) => {
  pending = Buffer.concat([pending, chunk]);
  if (pending.byteLength > limit) { store?.close(); process.exit(7); }
  for (;;) {
    const newline = pending.indexOf(10);
    if (newline === -1) return;
    const frame = pending.subarray(0, newline); pending = pending.subarray(newline + 1);
    let id: number | undefined;
    try {
      const request = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame)) as { id?: number; method?: Method; args?: unknown[]; options?: StorageOptions; quiescent?: boolean };
      if (!initialized) {
        if (!request.options || request.options.readonly !== true) throw new Error('UNAUTHORIZED');
        options = { path: request.options.path, readonly: true };
        store = new SQLiteStore({ ...options, readonlyQuiescent: request.quiescent === true });
        store.close(); store = undefined;
        initialized = true; send({ ready: true }); continue;
      }
      id = request.id;
      if (!Number.isSafeInteger(id) || !methods.includes(request.method!) || !Array.isArray(request.args)) throw new Error('INVALID_REQUEST');
      if (request.method === 'close') { send({ id }); process.stdin.destroy(); return; }
      if (request.method!.includes('Discovery') && !['readDiscoveryMetadata', 'getDiscoveryRunOwner', 'getDiscoveryOperation', 'readDiscoveryArtifact', 'readDiscoveryManifestPage', 'getDiscoveryBudget'].includes(request.method!)) throw new Error('UNAUTHORIZED');
      let value: unknown;
      try {
        store = new SQLiteStore({ ...options, readonlyQuiescent: request.quiescent === true });
        value = Reflect.apply(store[request.method!], store, request.args);
      } finally { store?.close(); store = undefined; }
      if (request.method === 'readDiscoveryArtifact' && value && typeof value === 'object' && 'ok' in value && value.ok === true && 'value' in value) {
        const artifact = value.value as { bytes: Uint8Array; sha256: string; totalBytes: number };
        value = { ok: true, value: { ...artifact, bytes: { encoding: 'base64', data: Buffer.from(artifact.bytes).toString('base64') } } };
      }
      send({ id, value });
    } catch (error) {
      const failure = classifyStorageFailure(error);
      send(initialized ? { id, error: failure.code, failure } : { ready: false, error: failure.code, failure });
      if (!initialized) { process.stdin.destroy(); return; }
    }
  }
});
process.stdin.on('end', () => { store?.close(); });
process.stdin.on('close', () => { store?.close(); });
process.on('SIGTERM', () => { store?.close(); process.exit(0); });
