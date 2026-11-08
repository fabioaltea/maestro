import Database from 'better-sqlite3';
import { constants, closeSync, lstatSync, openSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import type { LeaseAttempt, LeaseHandle, LeaseScope, OwnershipLease } from '../../ports/platform.js';

const heldByInode = new Map<string, { database: Database.Database; handle: LeaseHandle }>();

export function createOwnershipLease(): OwnershipLease {
  return {
    tryAcquire(input: string, scope: LeaseScope): LeaseAttempt {
      let database: Database.Database | undefined;
      try {
        if (!isAbsolute(input) || !process.getuid || (scope !== 'control' && scope !== 'daemon')) {
          return { status: 'UNKNOWN' };
        }
        const parent = realpathSync(dirname(input));
        const parentInfo = lstatSync(parent);
        if (!parentInfo.isDirectory() || parentInfo.uid !== process.getuid()
          || (parentInfo.mode & 0o777) !== 0o700) return { status: 'UNKNOWN' };
        const path = join(parent, basename(input));
        try {
          const info = lstatSync(path);
          if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid()
            || (info.mode & 0o777) !== 0o600) return { status: 'UNKNOWN' };
          // Do not open/close another descriptor of an inode whose POSIX lock we own.
          if (heldByInode.has(`${info.dev}:${info.ino}`)) return { status: 'BUSY' };
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
          try {
            const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
            closeSync(fd);
          } catch (createError) {
            if (!(createError instanceof Error && 'code' in createError && createError.code === 'EEXIST')) throw createError;
          }
        }
        const info = lstatSync(path);
        if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.uid !== process.getuid()
          || (info.mode & 0o777) !== 0o600) return { status: 'UNKNOWN' };
        const inode = `${info.dev}:${info.ino}`;
        if (heldByInode.has(inode)) return { status: 'BUSY' };
        database = new Database(path, { fileMustExist: true, timeout: 0 });
        database.exec('BEGIN IMMEDIATE');
        const owned = database;
        let released = false;
        const handle: LeaseHandle = Object.freeze({
          path, scope,
          release() {
            if (released) return;
            owned.close();
            heldByInode.delete(inode);
            released = true;
          },
        });
        heldByInode.set(inode, { database: owned, handle });
        return { status: 'HELD', handle };
      } catch (error) {
        database?.close();
        if (error instanceof Error && 'code' in error
          && (error.code === 'SQLITE_BUSY' || error.code === 'SQLITE_LOCKED')) return { status: 'BUSY' };
        return { status: 'UNKNOWN' };
      }
    },
  };
}
