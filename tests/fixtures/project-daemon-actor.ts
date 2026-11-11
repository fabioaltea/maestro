import { readFile } from 'node:fs/promises';
import { SQLiteStore, type StorageOptions } from '../../src/storage/sqlite-store.js';
import { createStorageProxy, type Method } from '../../src/storage/worker.js';
import type { StoragePort } from '../../src/ports/storage.js';
import type { DaemonIntent } from '../../src/ports/platform.js';
import type { ProjectExecution } from '../../src/core/projects/operations.js';
import type { ProjectOperationResult } from '../../src/domain/projects/model.js';
import type { FilesystemIdentity } from '../../src/ports/repository.js';
import { createFilesystemIdentity } from '../../src/platform/macos/git/filesystem-identity.js';
import { FaultSchedule } from './fault-schedule.js';
import { runDaemon } from '../../src/core/daemon-main.js';

const input = JSON.parse(await readFile(process.argv[2]!, 'utf8')) as { intent: DaemonIntent; point: string };
const schedule = new FaultSchedule([{ point: input.point, occurrence: 1, mode: 'pause' }]);
let storage: StoragePort;
let crashing = false;
process.on('message', (message: { type?: string }) => {
  if (message.type === 'maestro-test-shutdown' || message.type === 'maestro-test-crash') process.exit(86);
});
const filesystem = createFilesystemIdentity();
await runDaemon(input.intent, {
  report: (accepted, errorCode) => process.send?.({ type: accepted ? 'accepted' : 'rejected', errorCode }),
  storage: async (options: StorageOptions) => {
    // Same production SQLite adapter, directly behind the async port, so SIGKILL
    // can strike inside an actual transaction rather than simulating a rollback.
    const direct = new SQLiteStore(options, { checkpoint: point => {
      if (point !== input.point || crashing) return;
      crashing = true; process.send?.({ type: 'paused', point });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3_000);
      throw new Error('owned native fault window expired without crash');
    } });
    const call = async <T>(method: Method, args: unknown[]): Promise<T> => Reflect.apply(direct[method], direct, args) as T;
    storage = createStorageProxy(call, () => () => {}, async () => { direct.close(); });
    return storage;
  },
  projectExecute: async (context: ProjectExecution) => {
    if (context.operation.action === 'UPDATE') {
      const module = await import(new URL('../../src/core/projects/update.js', import.meta.url).href) as {
        updateProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity): Promise<ProjectOperationResult>;
      };
      return module.updateProject(context, storage, filesystem);
    }
    if (context.operation.action === 'VERIFY') {
      const module = await import(new URL('../../src/core/projects/verify.js', import.meta.url).href) as {
        verifyProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity): Promise<ProjectOperationResult>;
      };
      return module.verifyProject(context, storage, filesystem);
    }
    const module = await import(new URL('../../src/core/projects/register.js', import.meta.url).href) as {
      registerProject(context: ProjectExecution, storage: StoragePort, filesystem: FilesystemIdentity): Promise<ProjectOperationResult>;
    };
    return module.registerProject(context, storage, filesystem);
  },
  checkpoint: async point => {
    if (point === 'daemon.running') process.send?.({ type: 'running' });
    if (point !== input.point || crashing) return;
    crashing = true; process.send?.({ type: 'paused', point });
    await schedule.checkpoint(point);
  },
});
