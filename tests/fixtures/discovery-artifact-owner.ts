import { SQLiteStore } from '../../src/storage/sqlite-store.js';
const store = new SQLiteStore({ path: process.argv[2]! }, { checkpoint: point => {
  if (point === process.argv[3]) process.kill(process.pid, 'SIGKILL');
} });
const reserved = store.reserveDiscoveryArtifact('DOCUMENT', 8192);
if (!reserved.ok) throw new Error(reserved.code);
const published = store.publishDiscoveryArtifact(reserved.value.artifactId, Buffer.from('owned crash fixture'));
if (!published.ok) throw new Error(published.code);
store.close(); process.disconnect?.();
