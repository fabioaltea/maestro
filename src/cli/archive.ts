import { isAbsolute } from 'node:path';
import { recoverArchive } from '../core/archive-adoption.js';
import { defaultArchiveDirectory } from '../platform/macos/paths.js';
import { classifyError } from '../core/control-main.js';

export async function runArchiveCli(args: readonly string[]): Promise<number> {
  try {
    const [action, source] = args;
    const value = action === 'location' && args.length === 1 ? { directory: defaultArchiveDirectory() }
      : action === 'recover' && args.length === 2 && source && isAbsolute(source) && !source.includes('\0') ? await recoverArchive(source) : null;
    if (!value) throw new Error('INVALID_REQUEST');
    process.stdout.write(JSON.stringify(value) + '\n');
    return 0;
  } catch (error) {
    process.stdout.write(JSON.stringify({ code: classifyError(error) }) + '\n');
    return classifyError(error) === 'INVALID_REQUEST' ? 2 : 4;
  }
}
