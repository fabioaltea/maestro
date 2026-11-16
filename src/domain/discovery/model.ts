export const DISCOVERY_LIMITS = Object.freeze({
  activeDiscoveries: 1, hosts: 1, providers: 1, selectors: 16, files: 200, fileBytes: 128 * 1024,
  corpusBytes: 1024 * 1024, inputBytes: 2 * 1024 * 1024, questions: 20, questionBytes: 4096,
  answerBytes: 4096, turns: 20, documentBytes: 256 * 1024, claims: 200, sections: 20,
  outputLineBytes: 1024 * 1024, runOutputBytes: 8 * 1024 * 1024, stderrBytes: 64 * 1024,
  storedOutputBytes: 4 * 1024 * 1024, chunkBytes: 8192, envelopeBytes: 32 * 1024, pageItems: 20,
  artifactBytes: 64 * 1024 * 1024, artifactFiles: 4096, archiveDiscoveries: 100,
  terminalReserveBytes: 5 * 1024 * 1024, previews: 4, previewMs: 15 * 60 * 1000,
  grantMs: 5 * 60 * 1000, activeGrants: 32, readMs: 2000, contextMs: 30_000,
  runMs: 600_000, termGraceMs: 2000, cancelMs: 4000, eligibilityChecks: 4,
  eligibilityChecksPerProject: 1, eligibilityCheckMs: 30_000, uiLines: 500, uiOutputBytes: 1024 * 1024,
});
export type DiscoveryState = 'PREPARING' | 'READY_TO_START' | 'RUNNING' | 'WAITING_USER'
  | 'READY_FOR_REVIEW' | 'UPDATING' | 'APPROVED' | 'STALE' | 'FAILED' | 'CANCELLED'
  | 'INTERRUPTED' | 'CANCELLING' | 'RECONCILING';
export type RunPhase = 'SPAWN_INTENT' | 'HOST_READY' | 'SPAWN_AUTHORIZED' | 'PROVIDER_RUNNING' | 'EXIT_OBSERVED' | 'FINALIZED';
export type RunOutcome = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'INTERRUPTED' | 'TIMED_OUT' | 'UNKNOWN';
export type DiscoveryGrantAction = 'configure' | 'start' | 'answer' | 'correct' | 'approve' | 'cancel';
export type DiscoveryAction = DiscoveryGrantAction | 'preview' | 'check' | 'discard';
export type DiscoveryOperationOutcome = 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'BLOCKED' | 'INTERRUPTED' | 'UNKNOWN';
export type Freshness = 'CURRENT' | 'STALE' | 'UNKNOWN' | 'LAST_KNOWN';
export type DiscoveryFailure = 'INVALID_REQUEST' | 'INVALID_TRANSITION' | 'IDEMPOTENCY_CONFLICT' | 'APPROVAL_REQUIRED'
  | 'APPROVAL_STALE' | 'DISCOVERY_BUSY' | 'DISCOVERY_LIMIT' | 'DISCOVERY_NOT_INITIALIZED' | 'CONTEXT_CHANGED'
  | 'CONTEXT_UNSTABLE' | 'CONTEXT_LIMIT' | 'SOURCE_EXCLUDED' | 'ARTIFACT_CORRUPT' | 'ANSWER_CONFLICT'
  | 'CHECK_EXPIRED' | 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_AUTH_REQUIRED' | 'PROVIDER_UNSUPPORTED'
  | 'PROVIDER_UNSAFE' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_QUOTA' | 'PROVIDER_PROTOCOL_ERROR'
  | 'PROVIDER_OUTPUT_LIMIT' | 'PROVIDER_CONTEXT_LIMIT' | 'UNKNOWN_OUTCOME' | 'PERSISTENCE_UNAVAILABLE'
  | 'DEADLINE_EXCEEDED' | 'PROJECT_NOT_FOUND' | 'PROJECT_REMOVED';
export type DiscoveryResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: DiscoveryFailure };
export interface DiscoveryIdentity { readonly storeId: string; readonly projectId: string; readonly discoveryId: string; readonly sessionId: string }
export interface DiscoveryRecord extends DiscoveryIdentity {
  readonly state: DiscoveryState; readonly stateRevision: string; readonly snapshotId: string;
  readonly configRevision: string; readonly providerRevision: string; readonly currentRunId: string | null;
  readonly latestDocumentRevisionId: string | null; readonly createdAt: string; readonly updatedAt: string;
  readonly error: DiscoveryFailure | null;
}
export interface DiscoveryRun {
  readonly runId: string; readonly discoveryId: string; readonly generation: string; readonly turnIndex: number;
  readonly grantId: string; readonly requestId: string; readonly contextDigest: string; readonly inputDigest: string;
  readonly providerId: string; readonly providerRevision: string; readonly profileDigest: string; readonly modelId: string;
  readonly phase: RunPhase; readonly outcome: RunOutcome; readonly startedAt: string | null; readonly endedAt: string | null;
  readonly outputWatermark: string; readonly error: DiscoveryFailure | null;
}
export interface DiscoveryOperation {
  readonly requestId: string; readonly action: DiscoveryAction; readonly payloadHash: string; readonly canonicalIntent: string;
  readonly phase: 'ACCEPTED' | 'WORKING' | 'FINALIZED'; readonly outcome: DiscoveryOperationOutcome;
  readonly acceptedAt: string; readonly completedAt: string | null;
  readonly discoveryId: string | null; readonly runId: string | null; readonly error: DiscoveryFailure | null;
}
export interface DiscoveryQuestion {
  readonly questionId: string; readonly discoveryId: string; readonly runId: string; readonly revision: string;
  readonly text: string; readonly reason: string; readonly section: string; readonly status: 'OPEN' | 'ANSWERED' | 'UNKNOWN_ACCEPTED';
}
export interface DiscoveryAnswer {
  readonly answerId: string; readonly questionId: string; readonly questionRevision: string; readonly revision: string;
  readonly requestId: string; readonly kind: 'ANSWER' | 'UNKNOWN'; readonly text: string; readonly confirmedAt: string;
}
export interface DiscoveryGrant {
  readonly grantId: string; readonly canonicalIntent: string; readonly expiresAtMs: number;
  readonly consumedByRequestId: string | null;
}
export interface DiscoveryOutput {
  readonly runId: string; readonly seq: string; readonly artifactId: string; readonly sha256: string;
  readonly bytes: number; readonly kind: 'PROGRESS' | 'AGENT_TEXT'; readonly createdAt: string; readonly truncated: boolean;
}
