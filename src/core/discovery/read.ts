import { DISCOVERY_LIMITS as limits } from '../../domain/discovery/model.js';
import { requireUuid } from '../../domain/identifiers.js';
import type { StoragePort } from '../../ports/storage.js';
import type { DiscoveryMetadataData, DiscoveryMetadataQuery } from '../../ports/discovery.js';
import { DISCOVERY_READ_METHODS, validateDiscoveryParams, requireDiscoveryEnvelope, discoveryObject, discoveryFields, publicDiscoveryOperation } from '../../protocol/discovery.js';

interface Cursor { version: 1; storeId: string; kind: string; targetId: string; revision: string; offset: number }
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function offset(value: unknown, expected: Omit<Cursor, 'version' | 'offset'>): number {
  if (value === undefined) return 0;
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096) throw new Error('INVALID_REQUEST');
    const c = discoveryObject(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64url'))));
    discoveryFields(c, ['version', 'storeId', 'kind', 'targetId', 'revision', 'offset']);
    if (c.version !== 1 || !Number.isSafeInteger(c.offset) || Number(c.offset) < 0 || Number(c.offset) > limits.artifactBytes || encode(c as unknown as Cursor) !== value) throw new Error('INVALID_REQUEST');
    requireUuid(c.storeId); requireUuid(c.targetId);
    if (c.storeId !== expected.storeId) throw new Error('WRONG_STORE');
    if (c.kind !== expected.kind || c.targetId !== expected.targetId) throw new Error('INVALID_REQUEST');
    if (c.revision !== expected.revision) throw new Error('CURSOR_EXPIRED');
    return Number(c.offset);
  } catch (error) { if (error instanceof Error && ['WRONG_STORE', 'CURSOR_EXPIRED'].includes(error.message)) throw error; throw new Error('INVALID_REQUEST'); }
}
/** Pure archive reads. Neither this module nor its storage port can probe provider/sources. */
export function createDiscoveryReader(options: { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'getDiscoveryOperation' | 'readDiscoveryArtifact' | 'readDiscoveryManifestPage' | 'getProject'>; storeId: string; offline: boolean }) {
  const { storage, storeId } = options;
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    if (!storage.readDiscoveryMetadata) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.readDiscoveryMetadata(query); if (!result.ok) throw new Error(result.code); return result.value.data;
  }
  async function artifact(id: string, start: number, sha: string) {
    if (!storage.readDiscoveryArtifact) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.readDiscoveryArtifact(id, start, limits.chunkBytes); if (!result.ok) throw new Error(result.code);
    if (result.value.sha256 !== sha) throw new Error('ARTIFACT_CORRUPT'); return result.value;
  }
  return async (method: string, params: Readonly<Record<string, unknown>>): Promise<Record<string, unknown>> => {
    if (!(DISCOVERY_READ_METHODS as readonly string[]).includes(method) && method !== 'discovery.eligibility.get') throw new Error('UNSUPPORTED_VERSION');
    validateDiscoveryParams(method, params);
    let result: Record<string, unknown>;
    if (method === 'discovery.provider.get') {
      const c = await meta({ kind: 'provider' });
      result = { configuration: c ? { providerId: c.providerId, revision: c.revision, binaryVersion: c.binaryVersion, binarySha256: c.binarySha256, modelId: c.modelId, policyVersion: c.policyVersion, qualificationDigest: c.qualificationDigest } : null, check: null };
    } else if (method === 'discovery.operation.get') {
      if (!storage.getDiscoveryOperation) throw new Error('DISCOVERY_NOT_INITIALIZED');
      const operation = await storage.getDiscoveryOperation(params.requestId as string); if (!operation) throw new Error('OPERATION_NOT_FOUND');
      result = { operation: publicDiscoveryOperation(operation) };
    } else if (method === 'discovery.get') {
      const discovery = await meta({ kind: 'discovery', id: params.discoveryId as string }); if (!discovery) throw new Error('INVALID_REQUEST');
      result = { discovery };
    } else if (method === 'discovery.eligibility.get') {
      if (!options.offline) throw new Error('UNSUPPORTED_VERSION');
      if (params.checkId !== undefined) throw new Error('CHECK_EXPIRED');
      // Historical approval never substitutes for a live context check.
      await meta({ kind: 'provider' });
      const project = await storage.getProject(params.projectId as string); if (!project) throw new Error('PROJECT_NOT_FOUND');
      result = { projectId: params.projectId, eligible: false, freshness: 'UNKNOWN', checkId: null, checkedAt: null };
    } else if (method === 'discovery.document.get') {
      const revision = await meta({ kind: 'revision', id: params.revisionId as string }); if (!revision) throw new Error('INVALID_REQUEST');
      const { artifactId: _private, ...view } = revision;
      if (params.content !== true) result = { revision: view, approval: await meta({ kind: 'approval', id: revision.revisionId }) };
      else {
        const binding = { storeId, kind: method, targetId: revision.revisionId, revision: revision.bundleDigest }, start = offset(params.cursor, binding);
        const page = await artifact(revision.artifactId, start, revision.bundleDigest);
        if (page.totalBytes !== revision.bytes) throw new Error('ARTIFACT_CORRUPT');
        const next = start + page.bytes.byteLength;
        result = { revisionId: revision.revisionId, chunk: { data: Buffer.from(page.bytes).toString('base64'), byteLength: page.bytes.byteLength, offset: start, totalBytes: page.totalBytes, sha256: page.sha256 }, nextCursor: next < page.totalBytes ? encode({ version: 1, ...binding, offset: next }) : null };
      }
    } else if (method === 'discovery.preview.get') {
      const snapshot = await meta({ kind: 'snapshot', id: params.snapshotId as string }); if (!snapshot) throw new Error('INVALID_REQUEST');
      if (params.sources !== true) { const { manifestArtifactId: _manifest, corpusArtifactId: _corpus, ...view } = snapshot; result = { snapshot: view }; }
      else {
        if (!snapshot.manifestArtifactId || !snapshot.contextDigest || !storage.readDiscoveryManifestPage) throw new Error('ARTIFACT_CORRUPT');
        const binding = { storeId, kind: method, targetId: snapshot.snapshotId, revision: snapshot.contextDigest }, start = offset(params.cursor, binding);
        const page = await storage.readDiscoveryManifestPage(snapshot.manifestArtifactId, start, Number(params.limit ?? 20)); if (!page.ok) throw new Error(page.code);
        const p = page.value;
        if (p.storeId !== storeId || p.projectId !== snapshot.projectId || p.snapshotId !== snapshot.snapshotId || p.configRevision !== snapshot.configRevision || p.contextDigest !== snapshot.contextDigest) throw new Error('ARTIFACT_CORRUPT');
        result = { items: p.items, nextCursor: p.nextOffset === null ? null : encode({ version: 1, ...binding, offset: p.nextOffset }) };
      }
    } else {
      let query: 'discoveries' | 'questions' | 'output', targetId: string, revision: string;
      if (method === 'discovery.list') {
        query = 'discoveries'; targetId = params.projectId as string; const project = await storage.getProject(targetId); if (!project) throw new Error('PROJECT_NOT_FOUND'); revision = project.project.configRevision;
      } else if (method === 'discovery.questions.list') {
        query = 'questions'; targetId = params.discoveryId as string; const discovery = await meta({ kind: 'discovery', id: targetId }); if (!discovery) throw new Error('INVALID_REQUEST'); revision = discovery.stateRevision;
      } else if (method === 'discovery.output.list') {
        query = 'output'; targetId = params.runId as string; const run = await meta({ kind: 'run', id: targetId }); if (!run) throw new Error('INVALID_REQUEST'); revision = run.generation;
      } else throw new Error('UNSUPPORTED_VERSION');
      const binding = { storeId, kind: method, targetId, revision };
      // Bind each page to the current target revision.
      const start = offset(params.cursor, binding), limit = Number(params.limit ?? 20);
      const page = await meta({ kind: query, id: targetId, offset: start, limit });
      const items: unknown[] = [];
      for (const entry of page.items) {
        let item: unknown = entry;
        if (query === 'questions') {
          const question = entry as import('../../domain/discovery/model.js').DiscoveryQuestion;
          item = { ...question, answer: await meta({ kind: 'lastAnswer', id: question.questionId }) };
        } else if (query === 'output') {
          const output = entry as import('../../domain/discovery/model.js').DiscoveryOutput;
          const bytes = await artifact(output.artifactId, 0, output.sha256); if (bytes.totalBytes !== output.bytes || bytes.bytes.length !== output.bytes) throw new Error('ARTIFACT_CORRUPT');
          const { artifactId: _id, ...publicOutput } = output; item = { ...publicOutput, data: Buffer.from(bytes.bytes).toString('base64'), byteLength: bytes.bytes.length };
        }
        if (Buffer.byteLength(JSON.stringify({ items: [...items, item], nextCursor: 'x'.repeat(512) })) > limits.envelopeBytes - 1024) break;
        items.push(item);
      }
      if (page.items.length && !items.length) throw new Error('CONTEXT_LIMIT');
      const next = page.nextOffset !== null || items.length < page.items.length ? start + items.length : null;
      result = { items, nextCursor: next === null ? null : encode({ version: 1, ...binding, offset: next }) };
    }
    requireDiscoveryEnvelope(result); return result;
  };
}
