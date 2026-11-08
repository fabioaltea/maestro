export type IdentityProof = 'VERIFIED' | 'ABSENT' | 'UNKNOWN';
export type LeaseScope = 'control' | 'daemon';
export type LocalRole = 'client' | 'controller' | 'auxiliary';

export interface ArchivePaths {
  readonly directory: string;
  readonly ownerUid: number;
  readonly stateFile: string;
  readonly controlLeaseFile: string;
  readonly daemonLeaseFile: string;
  readonly credentialsDirectory: string;
  readonly clientKeyFile: string;
  readonly runtimeDirectory: string;
  readonly daemonEndpoint: string;
  readonly controllerEndpoint: string;
}

export interface PlatformPaths {
  resolveArchive(path: string, mode: 'read' | 'write'): Promise<ArchivePaths | null>;
  validateOwnerAndLinks(path: string, kind: 'file' | 'directory'): Promise<void>;
  readCredential(path: string): Promise<string>;
  createCredential(path: string): Promise<string>;
  inspectStaleSocket(path: string): Promise<{uid: number; inode: number} | null>;
  ownedCleanup(path: string, expected: { uid: number; inode: number }): Promise<void>;
}

export interface LeaseHandle {
  readonly path: string;
  readonly scope: LeaseScope;
  release(): void;
}
export type LeaseAttempt = { readonly status: 'HELD'; readonly handle: LeaseHandle }
  | { readonly status: 'BUSY' | 'UNKNOWN' };
export interface OwnershipLease { tryAcquire(path: string, scope: LeaseScope): LeaseAttempt }

export interface ProcessExit { readonly code: number | null; readonly signal: string | null }
export interface ObservedProcess {
  readonly pid: number;
  readonly exit: Promise<ProcessExit>;
  readonly bootstrap?: Promise<{ readonly accepted: boolean; readonly errorCode?: string } | null>;
}
export interface BootstrapIntent {
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly action: 'start' | 'stop' | 'restart';
  readonly canonicalStateDir: string;
}
export interface DaemonIntent {
  readonly ticketId: string;
  readonly generation: string;
  readonly instanceId: string;
  readonly canonicalStateDir: string;
}
export interface DaemonLauncher {
  spawnController(intent: BootstrapIntent): Promise<ObservedProcess>;
  spawnDaemon(intent: DaemonIntent): Promise<ObservedProcess>;
}

export interface ProcessIdentity {
  probeAbsent(pid: number): Promise<IdentityProof>;
  observeExit(process: ObservedProcess): Promise<IdentityProof>;
  challenge(endpoint: string, expected: { identity: string; generation: string; key: string }, timeoutMs: number): Promise<IdentityProof>;
}

export interface RpcRequest {
  readonly protocolVersion: 1;
  readonly correlationId: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}
export interface RpcResponse {
  readonly protocolVersion: 1;
  readonly correlationId: string;
  readonly result: 'OK' | 'BUSY' | 'BLOCKED' | 'ERROR' | 'UNKNOWN_OUTCOME';
  readonly data: unknown;
}
export interface AuthenticatedPeer {
  readonly credentialId: string;
  readonly role: LocalRole;
  readonly identity: string;
}
export interface LocalServer { close(): Promise<void> }
export interface LocalTransport {
  listen(endpoint: string, identity: string, keys: ReadonlyMap<string, LocalRole> | (() => Promise<ReadonlyMap<string, LocalRole>>),
    dispatch: (request: RpcRequest, peer: AuthenticatedPeer) => Promise<RpcResponse>): Promise<LocalServer>;
  call(endpoint: string, key: string, request: RpcRequest, timeoutMs: number): Promise<RpcResponse>;
}
import type { PublicResult } from '../protocol/messages.js';

export interface ClientBackend {
  readonly defaultDirectory: string;
  diagnostics(directory: string): Promise<PublicResult>;
  events(directory: string, limit?: number): Promise<PublicResult>;
  operation(directory: string, requestId: string): Promise<PublicResult>;
  inspect(directory: string): Promise<PublicResult>;
  control(intent: BootstrapIntent, timeoutMs: number): Promise<PublicResult>;
}
