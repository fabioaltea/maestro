import type { Freshness } from './model.js';

/** Historical approval is immutable; current eligibility must be recomputed. */
export interface DiscoveryApproval {
  readonly approvalId: string; readonly requestId: string; readonly storeId: string; readonly projectId: string;
  readonly discoveryId: string; readonly revisionId: string; readonly bundleDigest: string; readonly configRevision: string;
  readonly contextDigest: string; readonly acceptedUnknownIds: readonly string[]; readonly ownerUid: number;
  readonly approvedAt: string; readonly checkedAt: string;
}
export interface DiscoveryEligibility {
  readonly projectId: string; readonly eligible: boolean;
  readonly reason: 'CURRENT_APPROVAL' | 'APPROVAL_REQUIRED' | 'APPROVAL_STALE' | 'UNKNOWN' | 'PROJECT_REMOVED' | 'CHECKING';
  readonly revisionId: string | null; readonly approvalId: string | null; readonly contextDigest: string | null;
  readonly checkedAt: string | null; readonly freshness: Freshness; readonly checkId: string | null;
}
