import { createOwnershipLease } from '../../src/platform/macos/lease.js';
import { createPlatformPaths } from '../../src/platform/macos/paths.js';
import { makeDeadline, systemClock } from '../../src/ports/clock.js';
import type { ArchivePaths, LeaseHandle } from '../../src/ports/platform.js';

const paths = (await createPlatformPaths().resolveArchive(process.argv[2]!, 'write'))!;
const control = createOwnershipLease().tryAcquire(paths.controlLeaseFile, 'control');
const daemon = createOwnershipLease().tryAcquire(paths.daemonLeaseFile, 'daemon');
if (control.status !== 'HELD' || daemon.status !== 'HELD') throw new Error('owned fixture lease unavailable');
try {
  const module = await import(new URL('../../src/storage/registry-upgrade.js', import.meta.url).href) as {
    upgradeRegistry(options: { paths: ArchivePaths; controlLease: LeaseHandle; daemonLease: LeaseHandle;
      deadline: ReturnType<typeof makeDeadline>; checkpoint(point: string): void }): void;
  };
  module.upgradeRegistry({ paths, controlLease: control.handle, daemonLease: daemon.handle,
    deadline: makeDeadline(systemClock, 2_000), checkpoint: point => {
      if (point !== process.argv[3]) return;
      process.send?.({ point });
      // Bounded synchronous fault window: the test kills only this captured child.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
      throw new Error('owned fault window expired without crash');
    } });
} finally { daemon.handle.release(); control.handle.release(); process.disconnect?.(); }
