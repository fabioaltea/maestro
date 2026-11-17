import type { DaemonLauncher } from '../ports/platform.js';
import type { StoragePort } from '../ports/storage.js';
import type { StorageOptions } from '../storage/sqlite-store.js';

/** Composition seams for isolated process/fault tests; never accepted on the public wire. */
export interface CoreDependencies {
  readonly discovery?: {
    readonly provider?: import('../ports/provider.js').ProviderPort;
    readonly inspection?: import('../ports/provider.js').CodexInspectionPort;
    readonly context?: import('../ports/discovery-context.js').DiscoveryContextPort;
    readonly agent?: import('../ports/agent-runtime.js').AgentRuntimePort;
    readonly files?: import('../ports/provider.js').DiscoveryRunFilesPort;
    readonly onResult?: (identity: import('../ports/agent-runtime.js').AgentProcessIdentity, result: import('../domain/discovery/documents.js').ArchitectResult) => Promise<void>;
  };
  readonly projectExecute?: (context: import('./projects/operations.js').ProjectExecution) => Promise<import('../domain/projects/model.js').ProjectOperationResult>;
  readonly checkpoint?: (point: string) => Promise<void>;
  readonly report?: (accepted: boolean, errorCode?: string) => void;
  readonly storage?: (options: StorageOptions) => Promise<StoragePort>;
  readonly launcher?: DaemonLauncher;
}
