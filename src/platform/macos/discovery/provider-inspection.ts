import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CodexInspectionPort } from '../../../ports/provider.js';
import type { ManagedResource } from '../../../ports/storage.js';
import { CODEX_DISCOVERY_PIN } from '../../../providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION } from '../../../providers/codex/capabilities.js';
import { privateDirectory, verifyCodexBinary, verifyInstallationMetadata } from './provider-launcher.js';

interface Options {
  readonly authHome: string; readonly runtimeRoot: string; readonly instanceId: string;
  readonly onResource?: (resource: ManagedResource) => Promise<void>;
  /** Trusted process-test seam, never a client/renderer option. */
  readonly workerUrl?: URL; readonly observeChild?: (child: ChildProcess) => void;
}
async function noFileCredentials(authHome: string) {
  try { await lstat(join(authHome, 'auth.json')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  throw new Error('PROVIDER_UNSAFE'); // Metadata only: never open the file.
}
async function qualifiedAssets() {
  for (const [url, expected] of [[new URL('./provider.sb', import.meta.url), CODEX_DISCOVERY_QUALIFICATION.profileSha256],
    [new URL('../../../providers/codex/discovery-result.schema.json', import.meta.url), CODEX_DISCOVERY_QUALIFICATION.schemaSha256]] as const) {
    if (createHash('sha256').update(await readFile(url)).digest('hex') !== expected) throw new Error('PROVIDER_UNSAFE');
  }
}
/** Metadata inspection and a short lived, owner-bound Foundation auxiliary.
 * No login, inference, token extraction, default home or environment fallback. */
export function createCodexInspection(options: Options): CodexInspectionPort {
  const persist = options.onResource ?? (async () => {});
  let active = false;
  return {
    async inspectBinary(binary) {
      try {
        if (!isAbsolute(binary) || normalize(binary) !== binary || /[\x00-\x1f\x7f]/.test(binary)) throw new Error('PROVIDER_UNSUPPORTED');
        await qualifiedAssets(); await verifyCodexBinary(binary);
        return { ok: true, value: { version: CODEX_DISCOVERY_PIN.version, sha256: CODEX_DISCOVERY_PIN.sha256 } };
      } catch (error) { return { ok: false, code: error instanceof Error && error.message === 'PROVIDER_UNSUPPORTED' ? 'PROVIDER_UNSUPPORTED' : 'PROVIDER_UNSAFE' }; }
    },
    async prepareAuthHome() {
      try {
        if (!isAbsolute(options.authHome) || normalize(options.authHome) !== options.authHome) throw new Error('PROVIDER_UNSAFE');
        await mkdir(options.authHome, { recursive: true, mode: 0o700 }); await privateDirectory(options.authHome);
        await noFileCredentials(options.authHome);
        let file;
        try {
          file = await open(join(options.authHome, 'installation_id'), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
          await file.writeFile(randomUUID()); await file.sync();
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
        finally { await file?.close(); }
        await verifyInstallationMetadata(options.authHome);
        const directory = await open(options.authHome, constants.O_RDONLY); try { await directory.sync(); } finally { await directory.close(); }
        return { ok: true, value: options.authHome };
      } catch { return { ok: false, code: 'PROVIDER_UNSAFE' }; }
    },
    async checkLogin(c) {
      if (active) return 'UNAVAILABLE'; active = true;
      let runtime: string | undefined, cleanupSafe = false;
      try {
        if (c.authProfileRef !== options.authHome) return 'UNSAFE';
        await qualifiedAssets(); await verifyCodexBinary(c.binaryRealpath);
        await privateDirectory(options.authHome); await verifyInstallationMetadata(options.authHome); await noFileCredentials(options.authHome);
        await privateDirectory(options.runtimeRoot);
        runtime = await realpath(await mkdtemp(join(options.runtimeRoot, 'status-'))); await privateDirectory(runtime);
        for (const name of ['scratch', 'scratch/home', 'scratch/tmp', 'scratch/config', 'scratch/cache', 'scratch/data', 'scratch/state']) await mkdir(join(runtime, name), { mode: 0o700 });
        let resource: ManagedResource = { resourceId: randomUUID(), owningInstanceId: options.instanceId, kind: 'auxiliary', policyScope: 'foundation', generation: randomUUID(),
          pid: null, endpoint: null, credentialRef: null, observation: 'UNKNOWN', releaseState: 'OWNED' };
        await persist(resource);
        const child = fork(fileURLToPath(options.workerUrl ?? new URL('./provider-status-main.js', import.meta.url)), [],
          { cwd: runtime, env: { PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8' }, execArgv: [], stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        options.observeChild?.(child);
        return await new Promise<Awaited<ReturnType<CodexInspectionPort['checkLogin']>>>(resolve => {
          let status: Awaited<ReturnType<CodexInspectionPort['checkLogin']>> = 'UNAVAILABLE', proved = false, settled = false;
          const timer = setTimeout(() => { if (child.connected) child.disconnect(); }, 4500);
          child.on('message', (value: unknown) => {
            const message = value as { status?: string; exited?: boolean } | null;
            if (message && ['CHATGPT', 'AUTH_REQUIRED', 'UNAVAILABLE', 'UNSAFE'].includes(message.status ?? '') && message.exited === true) {
              status = message.status as typeof status; proved = true;
            }
          });
          const finish = () => {
            if (settled) return; settled = true; clearTimeout(timer);
            cleanupSafe = proved;
            resource = { ...resource, pid: null, observation: proved ? 'ABSENT' : 'UNKNOWN', releaseState: proved ? 'RELEASED' : 'BLOCKED' };
            void persist(resource).then(() => resolve(proved ? status : 'UNAVAILABLE')).catch(() => resolve('UNAVAILABLE'));
          };
          child.once('error', finish); child.once('exit', finish);
          child.send({ binary: c.binaryRealpath, authHome: c.authProfileRef, runtime }, error => { if (error && child.connected) child.disconnect(); });
        });
      } catch { return 'UNSAFE'; }
      finally { active = false; if (runtime && cleanupSafe) await rm(runtime, { recursive: true, force: true }).catch(() => {}); }
    },
  };
}
