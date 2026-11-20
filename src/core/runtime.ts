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
    readonly createAgent?: (callbacks: {
      onStdout(identity: import('../ports/agent-runtime.js').AgentProcessIdentity, bytes: Uint8Array): Promise<void>;
      onExit(identity: import('../ports/agent-runtime.js').AgentProcessIdentity, proof: import('../ports/agent-runtime.js').AgentExitProof): Promise<void>;
    }) => import('../ports/agent-runtime.js').AgentRuntimePort;
    readonly files?: import('../ports/provider.js').DiscoveryRunFilesPort;
    readonly onResult?: (identity: import('../ports/agent-runtime.js').AgentProcessIdentity, result: import('../domain/discovery/documents.js').ArchitectResult) => Promise<void>;
  };
  readonly review?:Pick<import('./review/snapshot.js').ReviewServicesOptions,'git'|'captureCheckpoint'>;
  readonly scheduler?:{readonly executor:import('../ports/scheduler.js').SchedulerExecutor;readonly clock?:import('../ports/clock.js').Clock};
  readonly execution?:import('./execution/runtime.js').ExecutionDependencies;
  readonly profiles?:{
    readonly importPort?:import('../ports/profile.js').ProfileImportPort;
    readonly compose?:(context:import('./profiles/runtime.js').ProfileRuntimeContext)=>Readonly<Record<string,import('./profiles/dispatch.js').ProfileAction>>;
  };
  readonly environments?:(runtime:import('./environments/runtime.js').EnvironmentRuntimeContext)=>import('./environments/runtime.js').EnvironmentRuntimeServices;
  readonly workspaces?:(runtime:import('./workspaces/runtime.js').WorkspaceRuntimeContext)=>import('./workspaces/runtime.js').WorkspaceRuntimeServices;
  readonly workspaceFiles?:import('../ports/workspace.js').OwnedWorkspaceFilesPort;
  readonly featurePlanning?:import('../ports/feature-planning.js').FeaturePlanningPort;
  readonly projectExecute?: (context: import('./projects/operations.js').ProjectExecution) => Promise<import('../domain/projects/model.js').ProjectOperationResult>;
  readonly checkpoint?: (point: string) => Promise<void>;
  readonly report?: (accepted: boolean, errorCode?: string) => void;
  readonly storage?: (options: StorageOptions) => Promise<StoragePort>;
  readonly launcher?: DaemonLauncher;
}
