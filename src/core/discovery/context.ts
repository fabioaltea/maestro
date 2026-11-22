import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, normalize, relative, resolve } from 'node:path';
import type { ContextRequest, DiscoveryContextPort, DiscoveryManifest, DiscoveryContextExtractor } from '../../ports/discovery-context.js';
import type { RepositoryInventory, RepositoryInventoryPort } from '../../ports/repository.js';
import { discoverySourceExclusion } from '../../domain/discovery/context-policy.js';
import { requireUuid, requireDecimal } from '../../domain/identifiers.js';
import { DISCOVERY_LIMITS as limits, isDiscoveryFailure, type DiscoveryFailure } from '../../domain/discovery/model.js';

export const CONTEXT_POLICY = 'discovery-context-v1';
function validRequest(request: ContextRequest) {
  requireUuid(request.storeId); requireUuid(request.projectId); requireDecimal(request.configRevision);
  if (request.configRevision === '0' || Object.keys(request).some(key => !['storeId', 'projectId', 'configRevision', 'checkoutPath', 'selectors', 'excludedRoots'].includes(key))) throw new Error('INVALID_REQUEST');
  if (!Array.isArray(request.selectors) || request.selectors.length < 1 || request.selectors.length > limits.selectors || new Set(request.selectors).size !== request.selectors.length) throw new Error('INVALID_REQUEST');
  for (const s of request.selectors) if (typeof s !== 'string' || !s.isWellFormed() || s.normalize('NFC') !== s || Buffer.byteLength(s) > 4096 || (s !== '.' && (!s.length || isAbsolute(s) || /[\x00-\x1f\x7f\\]/.test(s) || s.split('/').some(part => !part || part === '.' || part === '..')))) throw new Error('INVALID_REQUEST');
  if (!Array.isArray(request.excludedRoots) || request.excludedRoots.length > 16) throw new Error('INVALID_REQUEST');
  for (const p of [request.checkoutPath, ...request.excludedRoots]) if (typeof p !== 'string' || !p.isWellFormed() || !isAbsolute(p) || normalize(p) !== p || /[\x00-\x1f\x7f]/.test(p) || Buffer.byteLength(p) > 16384) throw new Error('INVALID_REQUEST');
  if (Buffer.byteLength(JSON.stringify(request)) > limits.envelopeBytes) throw new Error('CONTEXT_LIMIT');
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function identity(inventory: RepositoryInventory) { return JSON.stringify({ identity: inventory.identity, reference: inventory.reference, headKind: inventory.headKind, headOid: inventory.headOid, currentBranch: inventory.currentBranch }); }
function failure(error: unknown): { readonly ok: false; readonly code: DiscoveryFailure } {
  return { ok: false, code: error instanceof Error && isDiscoveryFailure(error.message) ? error.message : error instanceof Error && error.message === 'INVALID_IDENTIFIER' ? 'INVALID_REQUEST' : 'CONTEXT_UNSTABLE' };
}
export function createDiscoveryContext(dependencies: { inventory: RepositoryInventoryPort; extractor: DiscoveryContextExtractor; checkpoint?: (point: string) => Promise<void> }): DiscoveryContextPort {
  const capture: DiscoveryContextPort['capture'] = async (request, options) => {
    try {
      validRequest(request);
      for (const selector of request.selectors) if (selector !== '.') {
        if (discoverySourceExclusion(selector)) throw new Error('SOURCE_EXCLUDED');
        const path = resolve(request.checkoutPath, selector);
        if (request.excludedRoots.some(root => { const suffix = relative(root, path); return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('../')); })) throw new Error('SOURCE_EXCLUDED');
      }
      if (options.signal?.aborted) throw new Error('INTERRUPTED'); if (options.deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
      const before = await dependencies.inventory.inventory(request.checkoutPath, options); if (!before.ok) return { ok: false, code: before.error.code === 'REPOSITORY_UNSTABLE' ? 'CONTEXT_UNSTABLE' : before.error.code };
      const sources = await dependencies.extractor.extract(request, before.value, options); if (!sources.ok) return sources;
      await dependencies.checkpoint?.('context.beforeInventoryRecheck');
      const after = await dependencies.inventory.inventory(request.checkoutPath, options); if (!after.ok) return { ok: false, code: ['DEADLINE_EXCEEDED', 'INTERRUPTED'].includes(after.error.code) ? after.error.code : 'CONTEXT_UNSTABLE' };
      if (identity(before.value) !== identity(after.value)) throw new Error('CONTEXT_UNSTABLE');
      // Recheck selected membership through the same policy. Source bytes/ancestors
      // are verified by the extractor; no second corpus is sent to a provider.
      const membership = await dependencies.extractor.extract(request, after.value, options); if (!membership.ok) return membership;
      if (sources.value.stabilityDigest !== membership.value.stabilityDigest || sources.value.inventoryDigest !== membership.value.inventoryDigest || hash(sources.value.sources) !== hash(membership.value.sources)) throw new Error('CONTEXT_UNSTABLE');
      const manifest: DiscoveryManifest = { snapshotVersion: 1, snapshotId: randomUUID(), storeId: request.storeId, projectId: request.projectId, configRevision: request.configRevision,
        checkoutAnchor: JSON.stringify(before.value.reference), repositoryAnchor: JSON.stringify(before.value.identity), scopePolicyVersion: CONTEXT_POLICY,
        selectors: [...request.selectors], inventoryDigest: sources.value.inventoryDigest, headKind: before.value.headKind, headOid: before.value.headOid, currentBranch: before.value.currentBranch,
        capturedAt: new Date().toISOString(), sources: sources.value.sources, contextDigest: '' };
      const { snapshotId: _id, capturedAt: _at, contextDigest: _digest, ...stable } = manifest;
      return { ok: true, value: { manifest: { ...manifest, contextDigest: hash(stable) }, corpus: sources.value.corpus, omissions: sources.value.omissions } };
    } catch (error) { return failure(error); }
  };
  return { capture, async revalidate(request, manifest, options) {
    const checkedAt = new Date().toISOString();
    if (manifest.storeId !== request.storeId || manifest.projectId !== request.projectId || manifest.configRevision !== request.configRevision || manifest.scopePolicyVersion !== CONTEXT_POLICY || JSON.stringify(manifest.selectors) !== JSON.stringify(request.selectors)) return { ok: true, value: { freshness: 'STALE', contextDigest: null, checkedAt } };
    const current = await capture(request, options);
    if (!current.ok) return { ok: true, value: { freshness: current.code === 'SOURCE_EXCLUDED' ? 'STALE' : 'UNKNOWN', contextDigest: null, checkedAt: new Date().toISOString() } };
    return { ok: true, value: { freshness: current.value.manifest.contextDigest === manifest.contextDigest ? 'CURRENT' : 'STALE', contextDigest: current.value.manifest.contextDigest, checkedAt: new Date().toISOString() } };
  } };
}

/** Publish both private bodies before registering an authoritative sealed preview.
 * The caller persists its preview operation first; failures leave counted orphans. */
export async function sealDiscoveryContext(request: ContextRequest, dependencies: {
  readonly context: DiscoveryContextPort; readonly artifacts: import('../../ports/discovery.js').DiscoveryArtifactPort;
  readonly saveSnapshot: (snapshot: import('../../ports/discovery.js').DiscoverySnapshot) => Promise<import('../../domain/discovery/model.js').DiscoveryResult<void>>;
}, options: Parameters<DiscoveryContextPort['capture']>[1]): Promise<import('../../domain/discovery/model.js').DiscoveryResult<import('../../ports/discovery.js').DiscoverySnapshot>> {
  try {
    const capture = await dependencies.context.capture(request, options); if (!capture.ok) return capture;
    const { manifest, corpus, omissions } = capture.value;
    const manifestBytes = Buffer.from(JSON.stringify(manifest));
    if (options.deadline.expired() || options.signal?.aborted) throw new Error(options.signal?.aborted ? 'INTERRUPTED' : 'DEADLINE_EXCEEDED');
    const manifestReservation = await dependencies.artifacts.reserve('MANIFEST', manifestBytes.length); if (!manifestReservation.ok) return manifestReservation;
    const corpusReservation = await dependencies.artifacts.reserve('CORPUS', corpus.byteLength); if (!corpusReservation.ok) return corpusReservation;
    const publishedManifest = await dependencies.artifacts.publish(manifestReservation.value.artifactId, manifestBytes); if (!publishedManifest.ok) return publishedManifest;
    const publishedCorpus = await dependencies.artifacts.publish(corpusReservation.value.artifactId, corpus); if (!publishedCorpus.ok) return publishedCorpus;
    if (options.deadline.expired() || options.signal?.aborted) throw new Error(options.signal?.aborted ? 'INTERRUPTED' : 'DEADLINE_EXCEEDED');
    const snapshot: import('../../ports/discovery.js').DiscoverySnapshot = { snapshotId: manifest.snapshotId, projectId: request.projectId, configRevision: request.configRevision,
      state: 'SEALED', contextDigest: manifest.contextDigest, selectors: manifest.selectors, fileCount: manifest.sources.length, byteCount: corpus.byteLength,
      omissions, manifestArtifactId: publishedManifest.value.artifactId, corpusArtifactId: publishedCorpus.value.artifactId,
      createdAt: manifest.capturedAt, expiresAtMs: Date.now() + limits.previewMs, pinned: false };
    const saved = await dependencies.saveSnapshot(snapshot); return saved.ok ? { ok: true, value: snapshot } : saved;
  } catch (error) { return failure(error); }
}
