import { lstat, readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
/** Read-only snapshot of an explicitly supplied temporary archive. Never follows links. */
export async function snapshotArchive(directory: string): Promise<unknown> {
  const result: unknown[] = [];
  async function visit(relative: string) {
    const path = join(directory, relative), stat = await lstat(path);
    result.push({ relative, mode: stat.mode, size: stat.isDirectory() ? 0 : stat.size,
      hash: stat.isFile() ? createHash('sha256').update(await readFile(path)).digest('hex') : null });
    if (stat.isDirectory()) for (const name of (await readdir(path)).sort()) await visit(join(relative, name));
  }
  await visit(''); return result;
}
