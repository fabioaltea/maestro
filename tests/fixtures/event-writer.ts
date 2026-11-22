import { readFileSync } from 'node:fs';
import { SQLiteStore } from '../../src/storage/sqlite-store.js';
import { SCHEMA_VERSION } from '../../src/storage/schema.js';
const [file, point] = process.argv.slice(2);
const data = JSON.parse(readFileSync(file!, 'utf8')) as {path: string; directory: string; storeId: string; requestId: string};
const factory = SQLiteStore as unknown as new (options: unknown, hooks: {checkpoint(point: string): void}) => SQLiteStore;
const store = new factory({path: data.path, identity: {storeId: data.storeId, schemaVersion: SCHEMA_VERSION, ownerUid: process.getuid!(), canonicalPath: data.directory, revision: '0'}}, {
  checkpoint: name => { if (name === point) process.exit(86); },
});
store.acceptOperation({requestId: data.requestId, action: 'start', targetInstanceId: null, payloadHash: 'a'.repeat(64), ownerUid: process.getuid!(), acceptedAt: new Date().toISOString()});
store.close();
