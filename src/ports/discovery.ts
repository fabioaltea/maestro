import type { DiscoveryApproval } from '../domain/discovery/approval.js';
import type { DiscoveryDocumentRevision } from '../domain/discovery/documents.js';
import type { DiscoveryAction, DiscoveryAnswer, DiscoveryGrant, DiscoveryOperation, DiscoveryOutput, DiscoveryQuestion,
  DiscoveryRecord, DiscoveryResult, DiscoveryRun } from '../domain/discovery/model.js';
import type { AgentProcessIdentity } from './agent-runtime.js';
import type { ProviderConfiguration } from './provider.js';

export interface DiscoveryPage<T> { readonly items: readonly T[]; readonly nextCursor: string | null }
export interface DiscoverySnapshot {
  readonly snapshotId: string; readonly projectId: string; readonly configRevision: string;
  readonly state: 'PREPARING' | 'SEALED' | 'INVALID'; readonly contextDigest: string | null;
  readonly selectors: readonly string[]; readonly fileCount: number; readonly byteCount: number; readonly omissions: readonly string[];
  readonly manifestArtifactId: string | null; readonly corpusArtifactId: string | null; readonly createdAt: string;
  readonly expiresAtMs: number | null; readonly pinned: boolean;
}
export interface DiscoveryArtifact {
  readonly artifactId: string; readonly kind: 'MANIFEST' | 'CORPUS' | 'DOCUMENT' | 'OUTPUT' | 'EXIT_PROOF';
  readonly relativeKey: string; readonly sha256: string | null; readonly allocatedBytes: number;
  readonly state: 'RESERVED' | 'PUBLISHED' | 'REFERENCED' | 'ORPHAN' | 'CORRUPT'; readonly referenceCount: number;
}
export interface DiscoveryAdmission {
  /** Start reserves its grant until validation. Answer consumes it while saving
   * the response before validation. ACTIVATE matches the durable reservation. */
  readonly startStage?: 'PREPARE' | 'ACTIVATE';
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
  getDiscoveryRunOwner?(runId: string): Promise<string | null>;
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


export interface DiscoveryMetadataSingles {
  lastAnswer: DiscoveryAnswer;
  outputStatus: { readonly runId: string; readonly bytes: number; readonly watermark: string; readonly truncated: boolean };
  question: DiscoveryQuestion;
  grant: DiscoveryGrant;
  provider: ProviderConfiguration;
  snapshot: DiscoverySnapshot;
  discovery: DiscoveryRecord;
  run: DiscoveryRun;
  process: AgentProcessIdentity;
  revision: DiscoveryDocumentRevision;
  approval: DiscoveryApproval;
  artifact: DiscoveryArtifact;
}
export interface DiscoveryMetadataLists {
  activeDiscoveries: DiscoveryRecord;
  pendingOperations: DiscoveryOperationView;
  discoveries: DiscoveryRecord;
  questions: DiscoveryQuestion;
  answers: DiscoveryAnswer;
  revisions: DiscoveryDocumentRevision;
  processes: AgentProcessIdentity;
  output: DiscoveryOutput;
}
/** Private paging only; public opaque cursors are validated by the core API. */
export interface DiscoveryMetadataPage<T> { readonly items: readonly T[]; readonly nextOffset: number | null }
export type DiscoveryMetadataQuery = { readonly kind: 'provider' }
  | { readonly kind: Exclude<keyof DiscoveryMetadataSingles, 'provider'>; readonly id: string }
  | { readonly kind: keyof DiscoveryMetadataLists; readonly id?: string; readonly offset?: number; readonly limit?: number };
export type DiscoveryMetadataData<Q extends DiscoveryMetadataQuery> = Q['kind'] extends keyof DiscoveryMetadataSingles
  ? DiscoveryMetadataSingles[Q['kind']] | null : Q['kind'] extends keyof DiscoveryMetadataLists ? DiscoveryMetadataPage<DiscoveryMetadataLists[Q['kind']]> : never;
export interface DiscoveryMetadataReply<Q extends DiscoveryMetadataQuery = DiscoveryMetadataQuery> { readonly kind: Q['kind']; readonly data: DiscoveryMetadataData<Q> }
export type DiscoveryMetadataChange =
  | { readonly kind: 'cancel'; readonly discoveryId: string; readonly expectedRevision: string; readonly admission: DiscoveryAdmission }
  | { readonly kind: 'operation-uncertain'; readonly requestId: string; readonly error: import('../domain/discovery/model.js').DiscoveryFailure }
  | { readonly kind: 'output-truncated'; readonly runId: string; readonly generation: string; readonly expectedWatermark: string }
  | { readonly kind: 'provider'; readonly configuration: ProviderConfiguration; readonly expectedRevision: string | null }
  | { readonly kind: 'configure'; readonly admission: DiscoveryAdmission; readonly configuration: ProviderConfiguration; readonly expectedRevision: string | null }
  | { readonly kind: 'artifact'; readonly value: DiscoveryArtifact }
  | { readonly kind: 'snapshot'; readonly value: DiscoverySnapshot }
  | { readonly kind: 'process'; readonly value: AgentProcessIdentity }
  | { readonly kind: 'run'; readonly value: DiscoveryRun; readonly expectedPhase: DiscoveryRun['phase']; readonly exitVerified: boolean }
  | { readonly kind: 'state'; readonly discoveryId: string; readonly expectedRevision: string; readonly next: DiscoveryRecord['state']; readonly exitVerified: boolean }
  | { readonly kind: 'questions'; readonly discoveryId: string; readonly runId: string; readonly generation: string; readonly expectedRevision: string; readonly values: readonly DiscoveryQuestion[] }
  | { readonly kind: 'answer'; readonly value: DiscoveryAnswer; readonly admission: DiscoveryAdmission }
  | { readonly kind: 'revision'; readonly value: DiscoveryDocumentRevision; readonly runId: string; readonly generation: string; readonly expectedRevision: string }
  | { readonly kind: 'approval'; readonly value: DiscoveryApproval; readonly expectedRevision: string; readonly requiredUnknownIds: readonly string[] }
  | { readonly kind: 'output'; readonly value: DiscoveryOutput; readonly generation: string; readonly expectedWatermark: string }
  | { readonly kind: 'operation'; readonly requestId: string; readonly outcome: Exclude<DiscoveryOperation['outcome'], 'IN_PROGRESS'>; readonly completedAt: string; readonly result: Readonly<Record<string, string>> | null; readonly error: DiscoveryOperation['error'] };
export interface DiscoveryMetadataStoragePort {
  readDiscoveryMetadata?<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryResult<DiscoveryMetadataReply<Q>>>;
  commitDiscoveryMetadata?(change: DiscoveryMetadataChange): Promise<DiscoveryResult<void>>;
}

export interface DiscoveryArtifactBudget {
  readonly allocatedBytes: number; readonly reservedBytes: number; readonly metadataBytes: number;
  readonly allocatedFiles: number; readonly reservedFiles: number;
}
/** Private worker port. No caller-supplied path, hash or publication flag. */
export interface DiscoveryArtifactStoragePort {
  reserveDiscoveryArtifact?(kind: DiscoveryArtifact['kind'], maximumBytes: number): Promise<DiscoveryResult<DiscoveryArtifact>>;
  publishDiscoveryArtifact?(artifactId: string, bytes: Uint8Array): Promise<DiscoveryResult<DiscoveryArtifact>>;
  readDiscoveryManifestPage?(artifactId: string, offset: number, limit: number): Promise<DiscoveryResult<{
    readonly storeId: string; readonly projectId: string; readonly snapshotId: string; readonly configRevision: string; readonly contextDigest: string;
    readonly items: readonly import('./discovery-context.js').DiscoverySource[]; readonly nextOffset: number | null;
  }>>;
  readDiscoveryArtifact?(artifactId: string, offset: number, maximumBytes: number): Promise<DiscoveryResult<{ readonly bytes: Uint8Array; readonly sha256: string; readonly totalBytes: number }>>;
  reconcileDiscoveryArtifacts?(): Promise<DiscoveryResult<void>>;
  getDiscoveryBudget?(): Promise<DiscoveryResult<DiscoveryArtifactBudget>>;
  discardDiscoveryPreview?(snapshotId: string): Promise<DiscoveryResult<void>>;
}
