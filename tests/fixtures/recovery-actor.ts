import { readFile } from 'node:fs/promises';
import type { BootstrapIntent, DaemonIntent } from '../../src/ports/platform.js';
import { openStorage } from '../../src/storage/worker.js';
import type { Worker } from 'node:worker_threads';
import { FaultSchedule } from './fault-schedule.js';
const [file, point = ''] = process.argv.slice(2);
const intent = JSON.parse(await readFile(file!, 'utf8')) as BootstrapIntent | DaemonIntent;
const schedule = new FaultSchedule(point ? [{ point, occurrence: 1, mode: 'pause' }] : []);
let paused = false;
let worker: Worker | undefined;
process.on('message', (message: {type?: string}) => {
  if (message.type === 'worker-exit') void worker?.terminate().then(() => process.send?.({type: 'worker-exited'}));
  if (message.type === 'continue') { paused = false; schedule.release(point, 1); }
  if (message.type === 'maestro-test-crash' || (message.type === 'maestro-test-shutdown' && paused)) process.exit(86);
  if (message.type === 'maestro-test-shutdown') {
    if ('action' in intent) process.exit(86);
    else process.kill(process.pid, 'SIGTERM');
  }
});
const dependencies = {
  storage: (options: Parameters<typeof openStorage>[0]) => openStorage(options, { observeWorker: value => { worker = value; } }),
  report: (accepted: boolean, errorCode?: string) => process.send?.({ type: accepted ? 'accepted' : 'rejected', errorCode }),
  checkpoint: async (name: string) => {
    if (name === point) { paused = true; process.send?.({ type: 'paused', point }); }
    await schedule.checkpoint(name);
  },
};
if ('action' in intent) {
  const { runControl } = await import('../../src/core/control-main.js') as unknown as {runControl(intent: BootstrapIntent, deps: typeof dependencies): Promise<number>};
  process.exit(await runControl(intent, dependencies));
} else {
  const { runDaemon } = await import('../../src/core/daemon-main.js') as unknown as {runDaemon(intent: DaemonIntent, deps: typeof dependencies): Promise<void>};
  await runDaemon(intent, dependencies);
}
