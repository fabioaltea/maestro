import { realpath, stat, statfs } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import type { FilesystemAnchor, FilesystemIdentity } from '../../../ports/repository.js';

function validPath(value: unknown): value is string {
  return typeof value === 'string' && isAbsolute(value) && !value.includes('\0')
    && Buffer.byteLength(value) <= 16 * 1024;
}
function validAnchor(value: FilesystemAnchor): boolean {
  if (!value || value.version !== 1 || !validPath(value.canonicalPath)
    || !['directory', 'file'].includes(value.kind)) return false;
  return [value.device, value.inode, value.birthtimeNs].every(part =>
    typeof part === 'string' && part.length <= 40 && /^(0|[1-9][0-9]*)$/.test(part))
    && BigInt(value.inode) > 0n && BigInt(value.birthtimeNs) > 0n;
}

export function createFilesystemIdentity(): FilesystemIdentity {
  // First supported macOS system volume is APFS. Use its kernel filesystem type
  // rather than assuming a portable numeric magic constant for Darwin statfs.
  let supportedType: Promise<bigint> | undefined;
  return {
    async capture(path, kind) {
      if (!validPath(path) || !['directory', 'file'].includes(kind)) throw new Error('INVALID_REQUEST');
      if (process.platform !== 'darwin') throw new Error('REPOSITORY_UNSUPPORTED');
      try {
        const canonicalPath = await realpath(path);
        const filesystem = await statfs(canonicalPath, { bigint: true });
        supportedType ??= statfs('/', { bigint: true }).then(value => value.type);
        if (filesystem.type !== await supportedType) throw new Error('REPOSITORY_UNSUPPORTED');
        const before = await stat(canonicalPath, { bigint: true });
        if (kind === 'directory' ? !before.isDirectory() : !before.isFile()) throw new Error('REPOSITORY_UNSUPPORTED');
        const afterPath = await realpath(path);
        const after = await stat(afterPath, { bigint: true });
        if (canonicalPath !== afterPath || before.dev !== after.dev || before.ino !== after.ino
          || before.birthtimeNs !== after.birthtimeNs) throw new Error('REPOSITORY_UNSTABLE');
        const evidence: FilesystemAnchor = Object.freeze({ version: 1, canonicalPath, kind,
          device: after.dev.toString(), inode: after.ino.toString(), birthtimeNs: after.birthtimeNs.toString() });
        if (!validAnchor(evidence)) throw new Error('INSPECTION_UNAVAILABLE');
        return evidence;
      } catch (error) {
        if (error instanceof Error && ['REPOSITORY_UNSUPPORTED', 'REPOSITORY_UNSTABLE',
          'INSPECTION_UNAVAILABLE'].includes(error.message)) throw error;
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        throw new Error(code === 'ENOENT' || code === 'ENOTDIR' ? 'REPOSITORY_NOT_FOUND'
          : code === 'EACCES' || code === 'EPERM' ? 'PATH_ACCESS_DENIED' : 'INSPECTION_UNAVAILABLE');
      }
    },
    compare(expected, observed) {
      return validAnchor(expected) && validAnchor(observed)
        && expected.canonicalPath === observed.canonicalPath && expected.kind === observed.kind
        && expected.device === observed.device && expected.inode === observed.inode
        && expected.birthtimeNs === observed.birthtimeNs ? 'VERIFIED' : 'UNKNOWN';
    },
  };
}
