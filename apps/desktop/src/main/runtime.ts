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
export async function archiveLocation(runtime: Runtime): Promise<string> {
  return archiveRequest(runtime, ['location']);
}
export async function recoverArchiveLocation(runtime: Runtime, source: string): Promise<string> {
  return archiveRequest(runtime, ['recover', source]);
}
async function archiveRequest(runtime: Runtime, args: readonly string[]): Promise<string> {
  const { stdout } = await promisify(execFile)(runtime.node, [runtime.cli, 'archive', ...args], {
    env: runtime.env, timeout: 2_000, maxBuffer: 16_384, encoding: 'utf8',
  }).catch(error => {
    let code = 'PERSISTENCE_UNAVAILABLE';
    try {
      const result = JSON.parse(error.stdout) as { code?: unknown };
      if (typeof result.code === 'string') code = result.code;
    } catch { /* A local child without a usable result failed. */ }
    throw new Error(code);
  });
  const { directory } = JSON.parse(stdout) as { directory?: unknown };
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0')) throw new Error('CLIENT_PROTOCOL_ERROR');
  return directory;
}
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
