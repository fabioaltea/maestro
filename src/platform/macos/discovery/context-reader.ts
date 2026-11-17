import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpath } from 'node:fs/promises';
import { createDiscoveryContext } from '../../../core/discovery/context.js';
import type { DiscoveryContextExtractor, DiscoveryContextPort, DiscoverySourceCollection } from '../../../ports/discovery-context.js';
import { isDiscoveryFailure, type DiscoveryResult } from '../../../domain/discovery/model.js';
import { createDirectRepositoryInspector } from '../git/repository-inspector.js';
import { readContextFrames, writeContextFrames } from './context-framing.js';
export { createDirectContextExtractor } from './context-sources.js';

const PROFILE = fileURLToPath(new URL('./context.sb', import.meta.url));
const PACKAGE = fileURLToPath(new URL('../../../../../package.json', import.meta.url));
const MAIN = fileURLToPath(new URL('./context-main.js', import.meta.url));
const CODE = fileURLToPath(new URL('../../../', import.meta.url)).replace(/\/$/, '');
export function contextProfileArguments(executable: string, code: string, root: string, excluded: readonly string[]): string[] {
  if (excluded.length > 16) throw new Error('INVALID_REQUEST');
  const params = ['-D', `EXECUTABLE=${executable}`, '-D', `CODE=${code}`, '-D', `PACKAGE=${PACKAGE}`, '-D', `ROOT=${root}`];
  for (let index = 0; index < 16; index++) params.push('-D', `EX${index + 1}=${excluded[index] ?? '/var/empty'}`);
  return [...params, '-f', PROFILE];
}
export function createConfinedContextExtractor(): DiscoveryContextExtractor {
  return { async extract(request, inventory, options): Promise<DiscoveryResult<DiscoverySourceCollection>> {
    if (process.platform !== 'darwin') return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
    if (options.signal?.aborted) return { ok: false, code: 'INTERRUPTED' };
    if (options.deadline.expired()) return { ok: false, code: 'DEADLINE_EXCEEDED' };
    let excluded: string[];
    try { excluded = await Promise.all(request.excludedRoots.map(path => realpath(path).catch(() => path))); }
    catch { return { ok: false, code: 'CONTEXT_UNSTABLE' }; }
    return await new Promise(resolve => {
      const child = spawn('/usr/bin/sandbox-exec', [...contextProfileArguments(process.execPath, CODE, inventory.reference.root.canonicalPath, excluded), process.execPath, MAIN], {
        cwd: '/', env: { PATH: '/usr/bin:/bin', HOME: '/var/empty', LANG: 'C', LC_ALL: 'C' }, shell: false, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      });
      let error: 'DEADLINE_EXCEEDED' | 'INTERRUPTED' | 'CONTEXT_UNSTABLE' | undefined, stderrBytes = 0;
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const cancel = (reason: typeof error) => {
        error ??= reason;
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); escalation ??= setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 150); }
      };
      const abort = () => cancel('INTERRUPTED'); options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => cancel('DEADLINE_EXCEEDED'), Math.min(30_000, options.deadline.remainingMs()));
      const output = readContextFrames(child.stdout).catch(() => { cancel('CONTEXT_UNSTABLE'); return null; });
      void writeContextFrames(child.stdin, { request, inventory, timeoutMs: Math.min(30_000, Math.max(1, options.deadline.remainingMs())) }).catch(() => cancel('CONTEXT_UNSTABLE'));
      child.stdin.on('error', () => cancel('CONTEXT_UNSTABLE'));
      child.stderr.on('data', (chunk: Buffer) => { stderrBytes += chunk.length; if (stderrBytes > 16384) cancel('CONTEXT_UNSTABLE'); });
      child.once('error', () => { error ??= 'CONTEXT_UNSTABLE'; });
      child.once('close', (code, signal) => {
        clearTimeout(timer); clearTimeout(escalation); options.signal?.removeEventListener('abort', abort);
        void output.then(raw => {
          if (error || code !== 0 || signal || !raw || typeof raw !== 'object') { resolve({ ok: false, code: error ?? 'CONTEXT_UNSTABLE' }); return; }
          const parsed = raw as { ok: boolean; value?: Omit<DiscoverySourceCollection, 'corpus'> & { corpus: string }; code?: string };
          if (!parsed.ok) { resolve({ ok: false, code: isDiscoveryFailure(parsed.code) ? parsed.code : 'CONTEXT_UNSTABLE' }); return; }
          if (!parsed.value || typeof parsed.value.corpus !== 'string') { resolve({ ok: false, code: 'CONTEXT_UNSTABLE' }); return; }
          resolve({ ok: true, value: { ...parsed.value, corpus: Buffer.from(parsed.value.corpus, 'base64') } });
        });
      });
      if (options.signal?.aborted) abort();
    });
  } };
}
export function createMacOSDiscoveryContext(options: { extractor?: DiscoveryContextExtractor; checkpoint?: (point: string, relativePath?: string) => Promise<void> } = {}): DiscoveryContextPort {
  return createDiscoveryContext({ inventory: createDirectRepositoryInspector(), extractor: options.extractor ?? createConfinedContextExtractor(), ...(options.checkpoint ? { checkpoint: options.checkpoint } : {}) });
}
