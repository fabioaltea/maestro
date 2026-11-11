import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
export function sanitizedEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ['HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'PATH']) if (source[key] !== undefined) result[key] = source[key];
  result.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
  return result;
}
export interface Runtime { node: string; cli: string; env: NodeJS.ProcessEnv }
export async function validateRuntime(node: string, cli: string): Promise<Runtime> {
  if (!isAbsolute(node) || !isAbsolute(cli)) throw new Error('RUNTIME_UNAVAILABLE');
  const binary = await realpath(node).catch(() => { throw new Error('RUNTIME_UNAVAILABLE'); });
  const entry = await realpath(cli).catch(() => { throw new Error('BUILD_UNAVAILABLE'); });
  if (!(await stat(binary)).isFile() || !(await stat(entry)).isFile()) throw new Error('RUNTIME_UNAVAILABLE');
  const env = sanitizedEnvironment();
  const version = await promisify(execFile)(binary, ['--version'], { env, timeout: 2_000, maxBuffer: 1024, encoding: 'utf8' }).catch(() => { throw new Error('RUNTIME_UNAVAILABLE'); });
  if (version.stdout.trim() !== 'v26.13.0') throw new Error('RUNTIME_UNAVAILABLE');
  return { node: binary, cli: entry, env };
}
