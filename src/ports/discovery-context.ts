import type { Deadline } from './clock.js';
import type { DiscoveryResult, Freshness } from '../domain/discovery/model.js';

export interface DiscoverySource {
  readonly sourceId: string; readonly relativePath: string; readonly sha256: string; readonly byteLength: number; readonly lineCount: number;
}
export interface DiscoveryManifest {
  readonly snapshotVersion: 1; readonly snapshotId: string; readonly storeId: string; readonly projectId: string;
  readonly configRevision: string; readonly checkoutAnchor: string; readonly repositoryAnchor: string;
  readonly scopePolicyVersion: string; readonly selectors: readonly string[]; readonly inventoryDigest: string;
  readonly headKind: 'BRANCH' | 'DETACHED' | 'UNBORN'; readonly headOid: string | null; readonly currentBranch: string | null;
  readonly capturedAt: string; readonly sources: readonly DiscoverySource[]; readonly contextDigest: string;
}
export interface ContextRequest {
  readonly storeId: string; readonly projectId: string; readonly configRevision: string; readonly checkoutPath: string;
  readonly selectors: readonly string[]; readonly excludedRoots: readonly string[];
}
export interface DiscoveryContextPort {
  capture(request: ContextRequest, options: { readonly deadline: Deadline; readonly signal?: AbortSignal }): Promise<DiscoveryResult<{
    readonly manifest: DiscoveryManifest; readonly corpus: Uint8Array; readonly omissions: readonly string[];
  }>>;
  revalidate(request: ContextRequest, manifest: DiscoveryManifest, options: { readonly deadline: Deadline; readonly signal?: AbortSignal }): Promise<DiscoveryResult<{
    readonly freshness: Freshness; readonly contextDigest: string | null; readonly checkedAt: string;
  }>>;
}
