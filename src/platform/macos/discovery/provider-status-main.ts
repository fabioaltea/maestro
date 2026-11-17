import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCodexInvocation } from '../../../providers/codex/argv.js';
import { normalizeCodexLoginStatus } from '../../../providers/codex/capabilities.js';
import { createProviderProfile } from './provider-profile.js';
import { privateDirectory, verifyCodexBinary, verifyInstallationMetadata } from './provider-launcher.js';

type Status = 'CHATGPT' | 'AUTH_REQUIRED' | 'UNAVAILABLE' | 'UNSAFE';
let child: ChildProcess | undefined, started = false, stopping = false;
const bootstrapTimer = setTimeout(() => process.exit(1), 1500);
function stop() {
  stopping = true;
  // Only the native handle created here is ever signalled. A persisted PID is
  // never used, and the helper waits for close before acknowledging absence.
  if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  else if (!started) process.exit(1);
}
process.once('disconnect', stop); process.once('SIGTERM', stop);
process.once('message', (message: { binary: string; runtime: string; authHome: string }) => {
  started = true; clearTimeout(bootstrapTimer);
  void run(message).then(status => {
    if (process.connected) process.send?.({ status, exited: true }, () => process.exit(0));
    else process.exit(0);
  }).catch(() => {
    if (process.connected) process.send?.({ status: 'UNSAFE', exited: child === undefined }, () => process.exit(1));
    else process.exit(1);
  });
});
async function run(input: { binary: string; runtime: string; authHome: string }): Promise<Status> {
  await verifyCodexBinary(input.binary); await privateDirectory(input.authHome); await privateDirectory(input.runtime);
  await verifyInstallationMetadata(input.authHome);
  const base = createCodexInvocation({ ...input, model: 'status-only', schema: join(input.runtime, 'result.schema.json') });
  const profile = createProviderProfile({ executable: input.binary, runtime: input.runtime, authHome: input.authHome });
  const profilePath = join(input.runtime, 'status.sb');
  // Login status is local: further restrict the qualified provider policy.
  const source = await readFile(new URL('./provider.sb', import.meta.url), 'utf8');
  await writeFile(profilePath, source + '\n(deny network*)\n', { flag: 'wx', mode: 0o600 });
  if (stopping || !process.connected) return 'UNAVAILABLE';
  const args = [...profile.args]; args[args.indexOf('-f') + 1] = profilePath;
  return new Promise<Status>(resolve => {
    child = spawn(profile.executable, [...args, base.executable, '--no-daemon', 'login', 'status',
      '-c', 'cli_auth_credentials_store="keyring"', '-c', 'forced_login_method="chatgpt"',
      '-c', 'check_for_update_on_startup=false', '-c', 'analytics.enabled=false', '-c', 'feedback.enabled=false'],
    { cwd: base.cwd, env: base.env, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let chunks: Buffer[] = [], total = 0, overflow = false;
    const timer = setTimeout(stop, 3000);
    const receive = (bytes: Buffer) => {
      if (overflow) return;
      total += bytes.length;
      if (total > 8192) { overflow = true; chunks = []; stop(); return; }
      chunks.push(bytes);
    };
    child.stdout!.on('data', receive); child.stderr!.on('data', receive);
    child.once('error', () => { stopping = true; });
    child.once('close', code => {
      clearTimeout(timer);
      // Neither raw diagnostics nor account/token details cross private IPC.
      const status = overflow || stopping ? 'UNAVAILABLE' : normalizeCodexLoginStatus(code, Buffer.concat(chunks)); chunks = [];
      resolve(status);
    });
  });
}
