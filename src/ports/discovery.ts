import type { DiscoveryApproval } from '../domain/discovery/approval.js';
import type { DiscoveryDocumentRevision } from '../domain/discovery/documents.js';
import type { DiscoveryAction, DiscoveryAnswer, DiscoveryGrant, DiscoveryOperation, DiscoveryOutput, DiscoveryQuestion,
  DiscoveryRecord, DiscoveryResult, DiscoveryRun } from '../domain/discovery/model.js';
import type { AgentProcessIdentity } from './agent-runtime.js';
import type { DiscoveryManifest } from './discovery-context.js';
import type { ProviderConfiguration } from './provider.js';

export interface DiscoveryPage<T> { readonly items: readonly T[]; readonly nextCursor: string | null }
export interface DiscoverySnapshot {
  readonly snapshotId: string; readonly projectId: string; readonly configRevision: string;
  readonly state: 'PREPARING' | 'SEALED' | 'INVALID'; readonly manifest: DiscoveryManifest;
  readonly manifestArtifactId: string; readonly corpusArtifactId: string; readonly createdAt: string;
  readonly expiresAtMs: number | null; readonly pinned: boolean;
}
export interface DiscoveryArtifact {
  readonly artifactId: string; readonly kind: 'MANIFEST' | 'CORPUS' | 'DOCUMENT' | 'OUTPUT' | 'EXIT_PROOF';
  readonly relativeKey: string; readonly sha256: string | null; readonly allocatedBytes: number;
  readonly state: 'RESERVED' | 'PUBLISHED' | 'REFERENCED' | 'ORPHAN' | 'CORRUPT'; readonly referenceCount: number;
}
export interface DiscoveryAdmission {
  readonly requestId: string; readonly action: DiscoveryAction; readonly payloadHash: string; readonly canonicalIntent: string;
  readonly grantId: string | null; readonly ownerUid: number; readonly instanceId: string;
  readonly acceptedAt: string; readonly nowMs: number; readonly discovery: DiscoveryRecord | null;
  readonly run: DiscoveryRun | null; readonly expectedStateRevision: string | null; readonly acquireSlot: boolean;
}
/** All mutations are implemented by the existing SQLite writer, never Electron. */
export interface DiscoveryAdmissionResult { readonly operation: DiscoveryOperation; readonly inserted: boolean }
export type DiscoveryOperationView = Omit<DiscoveryOperation, 'canonicalIntent' | 'payloadHash'>;
export interface DiscoveryLedgerStoragePort {
  admitDiscoveryOperation?(input: DiscoveryAdmission): Promise<DiscoveryResult<DiscoveryAdmissionResult>>;
  getDiscoveryOperation?(requestId: string): Promise<DiscoveryOperationView | null>;
  saveDiscoveryGrant?(grant: DiscoveryGrant): Promise<DiscoveryResult<void>>;
}
export interface DiscoveryStorePort {
  admit(input: DiscoveryAdmission): Promise<DiscoveryResult<DiscoveryAdmissionResult>>;
  operation(requestId: string): Promise<DiscoveryOperation | null>;
  reservation(requestId: string): Promise<'LIFECYCLE' | 'PROJECT' | 'DISCOVERY' | null>;
  get(discoveryId: string): Promise<DiscoveryRecord | null>;
  list(projectId: string, cursor?: string): Promise<DiscoveryPage<DiscoveryRecord>>;
  saveGrant(grant: DiscoveryGrant): Promise<DiscoveryResult<void>>;
  provider(): Promise<ProviderConfiguration | null>;
  snapshot(snapshotId: string): Promise<DiscoverySnapshot | null>;
  questions(discoveryId: string): Promise<readonly DiscoveryQuestion[]>;
  answers(discoveryId: string): Promise<readonly DiscoveryAnswer[]>;
  revision(revisionId: string): Promise<DiscoveryDocumentRevision | null>;
  approval(revisionId: string): Promise<DiscoveryApproval | null>;
  processes(): Promise<readonly AgentProcessIdentity[]>;
  output(runId: string, cursor?: string): Promise<DiscoveryPage<DiscoveryOutput>>;
}
export interface DiscoveryArtifactPort {
  reserve(kind: DiscoveryArtifact['kind'], maximumBytes: number): Promise<DiscoveryResult<DiscoveryArtifact>>;
  publish(artifactId: string, bytes: Uint8Array): Promise<DiscoveryResult<DiscoveryArtifact>>;
  read(artifactId: string, offset: number, maximumBytes: number): Promise<DiscoveryResult<{ readonly bytes: Uint8Array; readonly sha256: string; readonly totalBytes: number }>>;
  reconcile(): Promise<DiscoveryResult<void>>;
}
