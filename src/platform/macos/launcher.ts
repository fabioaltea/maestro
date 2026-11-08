import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DaemonLauncher, ObservedProcess, ProcessExit } from '../../ports/platform.js';
import { MAX_FRAME_BYTES } from '../../protocol/messages.js';

interface Options { readonly controllerFile?: string; readonly daemonFile?: string }

export function createDaemonLauncher(options: Options = {}): DaemonLauncher {
  async function launch(file: string, intent: unknown): Promise<ObservedProcess> {
    const frame = Buffer.from(JSON.stringify(intent) + '\n');
    if (frame.byteLength > MAX_FRAME_BYTES) throw new Error('INVALID_REQUEST');
    const child = spawn(process.execPath, [file], { detached: true, stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, NODE_OPTIONS: undefined } });
    let resolveReport!: (value: { accepted: boolean; errorCode?: string } | null) => void;
    const bootstrap = new Promise<{ accepted: boolean; errorCode?: string } | null>(resolve => { resolveReport = resolve; });
    let reportReceived = false;
    child.on('message', (value: unknown) => {
      if (reportReceived || !value || typeof value !== 'object' || !('kind' in value)
        || value.kind !== 'bootstrap' || !('accepted' in value) || typeof value.accepted !== 'boolean') return;
      reportReceived = true;
      const errorCode = 'errorCode' in value && typeof value.errorCode === 'string'
        && /^[A-Z_]{1,64}$/.test(value.errorCode) ? value.errorCode : undefined;
      resolveReport(errorCode ? { accepted: value.accepted, errorCode } : { accepted: value.accepted });
    });
    const exit = new Promise<ProcessExit>(resolve => {
      child.once('exit', (code, signal) => { resolveReport(null); resolve({ code, signal }); });
      child.once('error', () => { resolveReport(null); resolve({ code: null, signal: null }); });
    });
    await new Promise<void>((resolve, reject) => {
      const onError = () => reject(new Error('CORE_EXITED_BEFORE_ACCEPTANCE'));
      child.once('error', onError);
      child.once('spawn', () => { child.off('error', onError); resolve(); });
    });
    child.stdin!.on('error', () => {});
    await new Promise<void>((resolve, reject) => {
      child.stdin!.once('error', () => reject(new Error('CORE_EXITED_BEFORE_ACCEPTANCE')));
      child.stdin!.end(frame, () => resolve());
    });
    child.unref();
    child.channel?.unref();
    if (!child.pid) throw new Error('CORE_EXITED_BEFORE_ACCEPTANCE');
    return { pid: child.pid, exit, bootstrap };
  }
  return {
    spawnController: intent => launch(options.controllerFile ?? fileURLToPath(new URL('../../core/control-main.js', import.meta.url)), intent),
    spawnDaemon: intent => launch(options.daemonFile ?? fileURLToPath(new URL('../../core/daemon-main.js', import.meta.url)), intent),
  };
}
