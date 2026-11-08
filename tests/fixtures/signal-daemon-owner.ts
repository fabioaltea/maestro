// Only this fixture can signal its directly observed child; no persisted PID is used.
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const frame = await readFile(process.argv[2]!, 'utf8');
const child = spawn(process.execPath, [fileURLToPath(new URL('../../../dist/core/daemon-main.js', import.meta.url))], { detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
let exited = false, closing = false;
child.once('exit', (code, signal) => {
  exited = true;
  process.send?.({ type: 'daemon-exited', code, signal });
  if (closing) process.exit(0);
});
child.once('error', () => process.exit(1));
child.stdin.end(frame);
process.on('message', (message: {type?: string; signal?: string}) => {
  if (message.type === 'signal' && ['SIGTERM', 'SIGINT', 'SIGHUP'].includes(message.signal ?? '') && !exited) {
    child.kill(message.signal as NodeJS.Signals);
  }
  if (message.type === 'maestro-test-shutdown') {
    closing = true;
    if (exited) process.exit(0);
    child.kill('SIGTERM');
  }
});
process.send?.({ type: 'ready' });
