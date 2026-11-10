import Database from './sqlite-driver.js';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createOwnershipLease } from '../platform/macos/lease.js';
import type { LeaseHandle } from '../ports/platform.js';

/** Host-side proof for one observation. Never creates lease files. */
export function reserveReadonlyObservation(path: string): { quiescent: boolean; release(): void } {
  const leases: LeaseHandle[] = [];
  const release = () => { for (const lease of leases.splice(0).reverse()) lease.release(); };
  if (!existsSync(path) || existsSync(path + '-wal') || existsSync(path + '-shm')) return { quiescent: false, release };
  const ownership = createOwnershipLease();
  for (const scope of ['control', 'daemon'] as const) {
    const attempt = ownership.tryAcquireExisting(join(dirname(path), `${scope}-lease.sqlite`), scope);
    if (attempt.status !== 'HELD') { release(); return { quiescent: false, release }; }
    leases.push(attempt.handle);
  }
  if (existsSync(path + '-wal') || existsSync(path + '-shm')) { release(); return { quiescent: false, release }; }
  return { quiescent: true, release };
}

/** No create/repair/checkpoint. Missing sidecars are never supplied by a reader. */
export function openReadonlyDatabase(path: string, quiescent?: boolean): { database: Database.Database; release(): void } {
  const url = pathToFileURL(path);
  url.searchParams.set('mode', 'ro');
  url.searchParams.set('readonly_shm', '1');
  const reservation = quiescent === undefined ? reserveReadonlyObservation(path) : { quiescent, release() {} };
  const release = reservation.release;
  try {
    const wal = existsSync(path + '-wal'), shm = existsSync(path + '-shm');
    if (!wal || !shm) {
      if (wal || shm || !reservation.quiescent) throw new Error('PERSISTENCE_UNAVAILABLE');
      // Both writer admission locks remain held until the reader closes. Only
      // this proven quiescent, fully checkpointed main file may be immutable.
      if (existsSync(path + '-wal') || existsSync(path + '-shm')) throw new Error('PERSISTENCE_UNAVAILABLE');
      url.searchParams.set('immutable', '1');
    }
    return { database: new Database(url.href, { readonly: true, fileMustExist: true, timeout: 50 }), release };
  } catch (error) { release(); throw error; }
}
