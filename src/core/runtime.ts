import type { DaemonLauncher } from '../ports/platform.js';
import type { StoragePort } from '../ports/storage.js';
import type { StorageOptions } from '../storage/sqlite-store.js';

/** Composition seams for isolated process/fault tests; never accepted on the public wire. */
export interface CoreDependencies {
  readonly checkpoint?: (point: string) => Promise<void>;
  readonly report?: (accepted: boolean, errorCode?: string) => void;
  readonly storage?: (options: StorageOptions) => Promise<StoragePort>;
  readonly launcher?: DaemonLauncher;
}
