import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, statfs, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { PlatformPaths, ArchivePaths } from '../../ports/platform.js';

function unauthorized(): never { throw new Error('UNAUTHORIZED'); }
function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
export function defaultArchiveDirectory(): string {
  return join(homedir(), 'Library', 'Application Support', 'Maestro', 'foundation', 'default');
}

export function createPlatformPaths(): PlatformPaths {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || !process.getuid) {
    throw new Error('UNSUPPORTED_PLATFORM');
  }
  const version = execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
  if (!/^26\.3(?:\.|$)/.test(version)) throw new Error('UNSUPPORTED_PLATFORM');
  const volume = execFileSync('/usr/sbin/diskutil', ['info', '-plist', '/'], { encoding: 'utf8' });
  if (!/<key>FilesystemType<\/key>\s*<string>apfs<\/string>/.test(volume)) {
    throw new Error('UNSUPPORTED_PLATFORM');
  }
  const uid = process.getuid();
  const knownRuntimeDirectories = new Set<string>();

  async function validateOwnerAndLinks(path: string, kind: 'file' | 'directory'): Promise<void> {
    const entry = await lstat(path);
    if (entry.uid !== uid || entry.isSymbolicLink()
      || (entry.mode & 0o777) !== (kind === 'file' ? 0o600 : 0o700)
      || (kind === 'file' ? !entry.isFile() || entry.nlink !== 1 : !entry.isDirectory())) unauthorized();
  }
  async function validateIfPresent(path: string, kind: 'file' | 'directory'): Promise<boolean> {
    try { await validateOwnerAndLinks(path, kind); return true; }
    catch (error) { if (isMissing(error)) return false; throw error; }
  }
  async function readCredential(path: string): Promise<string> {
    await validateOwnerAndLinks(dirname(path), 'directory');
    await validateOwnerAndLinks(path, 'file');
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (info.uid !== uid || !info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
        || info.size !== 64) unauthorized();
      const key = await handle.readFile({ encoding: 'utf8' });
      if (!/^[0-9a-f]{64}$/.test(key)) unauthorized();
      return key;
    } finally { await handle.close(); }
  }
  async function createCredential(path: string): Promise<string> {
    await validateOwnerAndLinks(dirname(path), 'directory');
    try {
      const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      const key = randomBytes(32).toString('hex');
      try { await handle.writeFile(key, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      return key;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      // Another initializer may have created the file but not finished writing it yet.
      for (let attempt = 0; attempt < 20; attempt++) {
        try { return await readCredential(path); }
        catch (readError) {
          if (attempt === 19) throw readError;
          await new Promise<void>(resolve => setTimeout(resolve, 5));
        }
      }
      return unauthorized();
    }
  }

  return {
    validateOwnerAndLinks, readCredential, createCredential,
    async resolveArchive(path, mode): Promise<ArchivePaths | null> {
      if (!isAbsolute(path)) throw new Error('INVALID_REQUEST');
      const absolute = resolve(path);
      const exists = await validateIfPresent(absolute, 'directory');
      if (!exists && mode === 'read') return null;
      let parent = absolute;
      for (;;) {
        try { await lstat(parent); break; }
        catch (error) {
          if (!isMissing(error) || parent === dirname(parent)) throw error;
          parent = dirname(parent);
        }
      }
      if ((await statfs(parent)).type !== (await statfs('/')).type) throw new Error('UNSUPPORTED_PLATFORM');
      if (!exists) await mkdir(absolute, { recursive: true, mode: 0o700 });
      await validateOwnerAndLinks(absolute, 'directory');
      const directory = await realpath(absolute);
      const credentialsDirectory = join(directory, 'credentials');
      if (mode === 'write') await mkdir(credentialsDirectory, { mode: 0o700 }).catch(error => {
        if (error.code !== 'EEXIST') throw error;
      });
      await validateIfPresent(credentialsDirectory, 'directory');
      for (const name of ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'state.sqlite-journal',
        'control-lease.sqlite', 'control-lease.sqlite-journal', 'daemon-lease.sqlite', 'daemon-lease.sqlite-journal']) {
        await validateIfPresent(join(directory, name), 'file');
      }
      const digest = createHash('sha256').update(directory).digest('hex').slice(0, 16);
      const runtimeDirectory = `/private/tmp/m-${uid}-${digest}`;
      if (mode === 'write') {
        await mkdir(runtimeDirectory, { mode: 0o700 }).catch(error => {
          if (error.code !== 'EEXIST') throw error;
        });
      }
      const runtimeExists = await validateIfPresent(runtimeDirectory, 'directory');
      if (runtimeExists) {
        const marker = join(runtimeDirectory, 'archive.json');
        const expectedMarker = JSON.stringify({ directory, ownerUid: uid });
        if (mode === 'write') {
          try {
            const handle = await open(marker, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
            try { await handle.writeFile(expectedMarker); await handle.sync(); }
            finally { await handle.close(); }
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
          }
        }
        await validateOwnerAndLinks(marker, 'file');
        const handle = await open(marker, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const info = await handle.stat();
          if (info.size > 8192 || await handle.readFile({ encoding: 'utf8' }) !== expectedMarker) {
            throw new Error('ENDPOINT_COLLISION');
          }
        } finally { await handle.close(); }
        knownRuntimeDirectories.add(runtimeDirectory);
      }
      const paths: ArchivePaths = {
        directory, ownerUid: uid, stateFile: join(directory, 'state.sqlite'),
        controlLeaseFile: join(directory, 'control-lease.sqlite'), daemonLeaseFile: join(directory, 'daemon-lease.sqlite'),
        credentialsDirectory, clientKeyFile: join(credentialsDirectory, 'client.key'), runtimeDirectory,
        daemonEndpoint: join(runtimeDirectory, 'daemon.sock'), controllerEndpoint: join(runtimeDirectory, 'control.sock'),
      };
      if (Buffer.byteLength(paths.daemonEndpoint) >= 90) throw new Error('ENDPOINT_COLLISION');
      await validateIfPresent(paths.clientKeyFile, 'file');
      return Object.freeze(paths);
    },
    async ownedCleanup(path, expected) {
      if (!knownRuntimeDirectories.has(dirname(path))) unauthorized();
      const info = await lstat(path);
      if (!info.isSocket() || info.isSymbolicLink() || info.uid !== uid || expected.uid !== uid
        || info.ino !== expected.inode) unauthorized();
      await unlink(path);
    },
  };
}
