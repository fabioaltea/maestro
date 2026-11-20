import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { archiveIdentity, archiveReferenceFile, createPlatformPaths, defaultArchiveDirectory, privateArchiveSlot } from '../platform/macos/paths.js';
import { createOwnershipLease } from '../platform/macos/lease.js';
import { openReadonlyStorage } from '../storage/readonly-host.js';
import { reserveReadonlyObservation } from '../storage/readonly-database.js';
import { SCHEMA_VERSION } from '../storage/schema.js';

export async function reserveDefaultArchiveSlot() {
  const parent = dirname(privateArchiveSlot());
  await mkdir(parent, { recursive: true, mode: 0o700 });
  archiveIdentity(parent, 'directory');
  const lock = createOwnershipLease().tryAcquire(join(parent, 'default-selection.sqlite'), 'control');
  if (lock.status !== 'HELD') throw new Error(lock.status === 'BUSY' ? 'BUSY' : 'PERSISTENCE_UNAVAILABLE');
  return lock.handle;
}

async function absent(path: string) {
  try { await lstat(path); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

export async function recoverArchive(source: string) {
  const slotLease = await reserveDefaultArchiveSlot();
  try {
    const paths = await createPlatformPaths().resolveArchive(source, 'read');
    if (!paths || paths.directory === privateArchiveSlot() || await absent(paths.stateFile)) throw new Error('STATE_ABSENT');
    const reference = archiveReferenceFile();
    if (!await absent(reference)) {
      if (defaultArchiveDirectory() === paths.directory) return { directory: paths.directory };
      throw new Error('ARCHIVE_RECOVERY_BLOCKED');
    }
    for (const name of ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'state.sqlite-journal']) {
      if (!await absent(join(privateArchiveSlot(), name))) throw new Error('ARCHIVE_RECOVERY_BLOCKED');
    }
    const proof = reserveReadonlyObservation(paths.stateFile);
    try {
      if (!proof.quiescent) throw new Error('ARCHIVE_RECOVERY_BLOCKED');
      const store = await openReadonlyStorage({ path: paths.stateFile, readonly: true }, proof);
      let snapshot;
      try { snapshot = await store.readSnapshot(); }
      finally { await store.close(); }
      if (!snapshot || snapshot.store.schemaVersion !== SCHEMA_VERSION || snapshot.store.ownerUid !== paths.ownerUid
        || snapshot.store.canonicalPath !== paths.directory || snapshot.pendingOperation || snapshot.instance && snapshot.instance.lifecycle !== 'STOPPED') {
        throw new Error('ARCHIVE_RECOVERY_BLOCKED');
      }
      const record = { directory: paths.directory, storeId: snapshot.store.storeId,
        root: archiveIdentity(paths.directory, 'directory'), state: archiveIdentity(paths.stateFile, 'file') };
      const temporary = join(dirname(reference), `.recovery-${randomUUID()}`);
      try {
        const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
        finally { await handle.close(); }
        await rename(temporary, reference);
        const directory = await open(dirname(reference), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await directory.sync(); } finally { await directory.close(); }
      } finally { if (!await absent(temporary)) await unlink(temporary); }
      return { directory: paths.directory };
    } finally { proof.release(); }
  } finally { slotLease.release(); }
}
