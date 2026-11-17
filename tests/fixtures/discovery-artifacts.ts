import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { DiscoveryArtifact } from '../../src/ports/discovery.js';
import type { DiscoveryResult } from '../../src/domain/discovery/model.js';
import { createRegistryStore } from './registry-store.js';

export interface ArtifactBudget { allocatedBytes: number; reservedBytes: number; metadataBytes: number; allocatedFiles: number; reservedFiles: number }
export interface ArtifactStorage {
  reserveDiscoveryArtifact(kind: DiscoveryArtifact['kind'], bytes: number): DiscoveryResult<DiscoveryArtifact>;
  publishDiscoveryArtifact(id: string, bytes: Uint8Array): DiscoveryResult<DiscoveryArtifact>;
  readDiscoveryArtifact(id: string, offset: number, maximumBytes: number): DiscoveryResult<{ bytes: Uint8Array; sha256: string; totalBytes: number }>;
  reconcileDiscoveryArtifacts(): DiscoveryResult<void>;
  getDiscoveryBudget(): DiscoveryResult<ArtifactBudget>;
  discardDiscoveryPreview(id: string): DiscoveryResult<void>;
}
export function value<T>(result: DiscoveryResult<T>): T { if (!result.ok) assert.fail(result.code); return result.value; }
export async function artifactFixture(t: TestContext, checkpoint?: (point: string) => void) {
  const f = await createRegistryStore(t, checkpoint);
  const artifacts = f.store as unknown as ArtifactStorage;
  assert.equal(typeof artifacts.reserveDiscoveryArtifact, 'function', 'T012 artifact storage is required');
  value(artifacts.reconcileDiscoveryArtifacts());
  return { ...f, artifacts };
}
