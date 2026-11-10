import type { Deadline } from './clock.js';
import type { IdentityProof } from './platform.js';

export type InspectionCode =
  | 'INVALID_REQUEST' | 'INVALID_BASE_BRANCH' | 'PATH_ACCESS_DENIED'
  | 'REPOSITORY_NOT_FOUND' | 'REFERENCE_CHECKOUT_UNAVAILABLE'
  | 'REPOSITORY_UNSUPPORTED' | 'REPOSITORY_CHANGED' | 'REPOSITORY_UNSTABLE'
  | 'GIT_UNAVAILABLE' | 'INSPECTION_UNAVAILABLE' | 'INSPECTION_UNSAFE'
  | 'OUTPUT_LIMIT' | 'DEADLINE_EXCEEDED' | 'INTERRUPTED';

export interface InspectionFailure {
  readonly code: InspectionCode;
  readonly retryable: boolean;
  readonly nextAction: 'correct-input' | 'restore-access' | 'restore-checkout'
    | 'install-supported-git' | 'check-inspection-capability'
    | 'review-repository-identity' | 'retry-inspection' | 'select-local-branch';
}

/** Filesystem evidence, not a cryptographic or repository-provided identifier. */
export interface FilesystemAnchor {
  readonly version: 1;
  readonly canonicalPath: string;
  readonly kind: 'directory' | 'file';
  readonly device: string;
  readonly inode: string;
  readonly birthtimeNs: string;
}

export interface FilesystemIdentity {
  capture(path: string, kind: FilesystemAnchor['kind']): Promise<FilesystemAnchor>;
  compare(expected: FilesystemAnchor, observed: FilesystemAnchor): IdentityProof;
}

export interface RepositoryIdentity {
  readonly version: 1;
  readonly commonDirectory: FilesystemAnchor;
}

/** The first confirmed checkout remains the observation reference. */
export interface ReferenceCheckout {
  readonly version: 1;
  readonly root: FilesystemAnchor;
  readonly adminDirectory: FilesystemAnchor;
}

export type HeadKind = 'BRANCH' | 'DETACHED' | 'UNBORN' | 'UNKNOWN';
export type BaseState = 'UNCONFIGURED' | 'VALID' | 'INVALID' | 'UNVERIFIED';
export type ObjectFormat = 'sha1' | 'sha256';

export interface RepositoryObservationEvidence {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly referencePath: string;
  readonly checkoutAvailability: 'VERIFIED' | 'UNAVAILABLE' | 'UNKNOWN';
  readonly repositoryIdentityStatus: 'VERIFIED' | 'CHANGED' | 'UNVERIFIED';
  readonly hasCommits: boolean | null;
  readonly headKind: HeadKind;
  readonly currentBranch: string | null;
  readonly headOid: string | null;
  readonly objectFormat: ObjectFormat | null;
  readonly baseState: BaseState;
  readonly baseOid: string | null;
  readonly trackedChanges: boolean | null;
  readonly untrackedChanges: boolean | null;
  readonly conflicts: boolean | null;
  readonly fileStatusScope: 'REFERENCE_CHECKOUT_DIRECT_ENTRIES';
  readonly limitations: readonly ('SUBMODULE_CONTENTS_NOT_INSPECTED' | 'FILE_STATUS_UNVERIFIED')[];
  readonly error: InspectionFailure | null;
}

export interface RepositoryInspection {
  readonly identity: RepositoryIdentity;
  readonly reference: ReferenceCheckout;
  /** A candidate default only; a registered project's configuration is never changed. */
  readonly proposedBaseBranch: string | null;
  readonly observation: RepositoryObservationEvidence;
}

export type InspectionResult = { readonly ok: true; readonly value: RepositoryInspection }
  | { readonly ok: false; readonly error: InspectionFailure };

export interface InspectionCapabilities {
  readonly version: 1;
  readonly status: 'AVAILABLE' | 'UNAVAILABLE';
  readonly gitVersion: string | null;
  readonly confinement: 'MACOS_SANDBOX' | 'UNAVAILABLE';
  readonly error: InspectionFailure | null;
}

export interface InspectionOptions {
  readonly deadline: Deadline;
  readonly signal?: AbortSignal;
}

export interface RepositoryInspector {
  capabilities(): Promise<InspectionCapabilities>;
  inspectCandidate(path: string, requestedBase: string | undefined,
    options: InspectionOptions): Promise<InspectionResult>;
  inspectRegistered(identity: RepositoryIdentity, reference: ReferenceCheckout,
    configuredBase: string | null, options: InspectionOptions): Promise<InspectionResult>;
}

export type ProbeRequest = {
  readonly kind: 'CANDIDATE'; readonly path: string; readonly requestedBase?: string;
} | {
  readonly kind: 'REGISTERED'; readonly identity: RepositoryIdentity;
  readonly reference: ReferenceCheckout; readonly configuredBase: string | null;
};

export interface ProbeOwnership {
  readonly resourceId: string;
  readonly generation: string;
  readonly owningInstanceId: string;
  readonly policyScope: 'foundation';
}

export interface OwnedProbe {
  readonly ownership: ProbeOwnership;
  readonly result: Promise<InspectionResult>;
  /** Must verify this owned invocation; never accept a persisted PID as proof. */
  cancel(): Promise<IdentityProof>;
}

/** OS implementation owns subprocess handles; callers receive only typed evidence. */
export interface ProbeSupervisor {
  start(request: ProbeRequest, ownership: ProbeOwnership,
    options: InspectionOptions): Promise<OwnedProbe>;
}
