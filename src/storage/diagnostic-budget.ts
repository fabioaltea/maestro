import { constants, lstatSync, readdirSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type { EventRecord } from '../ports/storage.js';
import { privateDirectory, privateFile, writeAll } from './event-journal.js';
export const MiB = 1024 * 1024;
export function allocated(path: string): number {
  try { return lstatSync(path).blocks * 512; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0; throw error; }
}
function directoryBytes(path: string) {
  if (!allocated(path)) { try { lstatSync(path); } catch { return 0; } }
  const info = lstatSync(path);
  if (!info.isDirectory()) return info.blocks * 512;
  privateDirectory(path, false);
  return readdirSync(path).reduce((bytes, name) => {
    try { return bytes + privateFile(join(path, name)).blocks * 512; }
    catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return bytes; throw error; }
  }, info.blocks * 512);
}
export function diagnosticUsage(directory: string, database: Database.Database) {
  const eventPages = Number((database.prepare("SELECT coalesce(sum(pgsize),0) AS bytes FROM dbstat WHERE name IN ('event_outbox','journal_metadata')").get() as {bytes: bigint}).bytes);
  const freePages = Number(database.pragma('freelist_count', {simple: true})) * Number(database.pragma('page_size', {simple: true}));
  const journalBytes = directoryBytes(join(directory, 'events')), logBytes = directoryBytes(join(directory, 'logs'));
  const walBytes = allocated(join(directory, 'state.sqlite-wal')), shmBytes = allocated(join(directory, 'state.sqlite-shm'));
  const outboxMetadataBytes = eventPages + freePages;
  return {journalBytes, logBytes, walBytes, shmBytes, outboxMetadataBytes,
    totalBytes: journalBytes + logBytes + walBytes + shmBytes + outboxMetadataBytes,
    limits: {journalBytes: 40 * MiB, logBytes: 5 * MiB, totalBytes: 50 * MiB, temporaryBytes: 5 * MiB, walBytes: 2 * MiB}};
}
export function beforeDiagnosticMutation(directory: string, database: Database.Database) {
  if (allocated(join(directory, 'state.sqlite-wal')) >= MiB) {
    const result = database.pragma('wal_checkpoint(TRUNCATE)') as {busy: number; log: number; checkpointed: number}[];
    if (Number(result[0]?.busy) !== 0 || allocated(join(directory, 'state.sqlite-wal')) >= MiB) throw new Error('EVENT_BACKPRESSURE');
  }
  const usage = diagnosticUsage(directory, database);
  const pending = (database.prepare('SELECT records FROM event_outbox WHERE singleton=1').get() as {records: string}).records !== '[]';
  // A crashed drainer may leave temporary allocation. Only the existing batch may reclaim it before new state changes.
  const recoveryAllowance = pending ? 5 * MiB : 0;
  if (usage.journalBytes > 40 * MiB + recoveryAllowance || usage.outboxMetadataBytes > MiB
    || usage.totalBytes > 50 * MiB + recoveryAllowance || usage.logBytes > 5 * MiB + recoveryAllowance) throw new Error('EVENT_BACKPRESSURE');
}
export function appendDiagnosticLog(directory: string, events: readonly EventRecord[], checkpoint?: (point: string) => void) {
  const path = join(directory, 'logs'); privateDirectory(path, true);
  const bytes = Buffer.from(events.map(event => JSON.stringify(event) + '\n').join(''));
  if (bytes.length > MiB) throw new Error('EVENT_BACKPRESSURE');
  for (const name of readdirSync(path)) {
    if (!/^foundation-[0-4]\.log$/.test(name)) throw new Error('ENDPOINT_COLLISION');
    privateFile(join(path, name));
  }
  const active = join(path, 'foundation-0.log');
  let size = 0;
  try { size = privateFile(active).size; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (size + bytes.length > MiB) {
    for (let index = 4; index >= 0; index--) {
      const source = join(path, `foundation-${index}.log`);
      try { privateFile(source); } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue; throw error; }
      if (index === 4) unlinkSync(source); else renameSync(source, join(path, `foundation-${index + 1}.log`));
    }
  }
  const fd = openSync(active, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { writeAll(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
  checkpoint?.('log.allocated');
  for (let index = 4; directoryBytes(path) > 5 * MiB && index >= 1; index--) {
    const old = join(path, `foundation-${index}.log`);
    try { privateFile(old); unlinkSync(old); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  }
  if (directoryBytes(path) > 5 * MiB) throw new Error('EVENT_BACKPRESSURE');
}
