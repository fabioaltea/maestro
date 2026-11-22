import { lstat, mkdir, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { requireProjectPath } from '../../../domain/projects/intent.js';
import type { InspectionCode, InspectionOptions, InspectionResult, RepositoryInspector } from '../../../ports/repository.js';
import { createFilesystemIdentity } from './filesystem-identity.js';
import { createGitRunner, inspectionFailure } from './runner.js';

async function exists(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function initializeRepository(path: string, inspector: RepositoryInspector, options: InspectionOptions): Promise<InspectionResult> {
  const fail = (code: InspectionCode): InspectionResult => ({ ok: false, error: inspectionFailure(code) });
  const check = () => {
    if (options.signal?.aborted) throw new Error('INTERRUPTED');
    if (options.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  };
  const runner = createGitRunner();
  if ((await runner.capabilities()).status !== 'AVAILABLE') return fail('INSPECTION_UNAVAILABLE');
  const filesystem = createFilesystemIdentity();
  try {
    requireProjectPath(path);
    const parent = await realpath(dirname(path));
    const root = join(parent, basename(path));
    if (root === parent || basename(root).toLowerCase() === '.git') return fail('REPOSITORY_DESTINATION_OCCUPIED');
    for (let ancestor = parent;; ancestor = dirname(ancestor)) {
      if (await exists(join(ancestor, '.git'))) return fail('REPOSITORY_DESTINATION_OCCUPIED');
      if (ancestor === dirname(ancestor)) break;
    }
    check();
    let current = await exists(root);
    if (!current) {
      await mkdir(root, { mode: 0o700 });
      current = await lstat(root);
    }
    if (!current.isDirectory() || current.uid !== process.getuid?.() || (current.mode & 0o022) !== 0
      || await realpath(root) !== root) return fail('PATH_ACCESS_DENIED');
    const location = await filesystem.capture(root, 'directory');
    const entries = await opendir(root);
    try {
      if (await entries.read()) return fail('REPOSITORY_DESTINATION_OCCUPIED');
    } finally { await entries.close(); }
    check();
    if (filesystem.compare(location, await filesystem.capture(root, 'directory')) !== 'VERIFIED') return fail('REPOSITORY_CHANGED');
    await mkdir(join(root, '.git'), { mode: 0o700 });
    if (filesystem.compare(location, await filesystem.capture(root, 'directory')) !== 'VERIFIED') return fail('REPOSITORY_CHANGED');
    const result = await runner.run({ kind: 'initialize' }, { ...options, cwd: root });
    if (!result.ok) return fail(result.error.code);
    if (result.exitCode !== 0) return fail('INSPECTION_UNAVAILABLE');
    check();
    return await inspector.inspectCandidate(root, undefined, options);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return fail('REPOSITORY_DESTINATION_OCCUPIED');
    if (error instanceof Error && (error.message === 'INTERRUPTED' || error.message === 'DEADLINE_EXCEEDED')) return fail(error.message);
    return fail('PATH_ACCESS_DENIED');
  }
}
