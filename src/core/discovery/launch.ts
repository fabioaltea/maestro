import { createHash, randomUUID } from 'node:crypto';
import type { DiscoveryIntent } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS as limits, type DiscoveryOperation, type DiscoveryRecord, type DiscoveryRun } from '../../domain/discovery/model.js';
import type { DiscoveryArtifactPort, DiscoverySnapshot } from '../../ports/discovery.js';
import type { DiscoveryContextPort, DiscoveryManifest, ContextRequest } from '../../ports/discovery-context.js';
import type { ProviderConfiguration, ProviderInput, ProviderPort } from '../../ports/provider.js';
import { makeDeadline, systemClock } from '../../ports/clock.js';

const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function artifact(artifacts: DiscoveryArtifactPort, id: string, maximum: number) {
  const chunks: Uint8Array[] = []; let offset = 0, sha: string | undefined, total: number | undefined;
  for (;;) {
    const page = await artifacts.read(id, offset, limits.chunkBytes); if (!page.ok) throw new Error(page.code);
    const value = page.value;
    if (value.totalBytes > maximum || value.totalBytes <= 0 || total !== undefined && total !== value.totalBytes || sha !== undefined && sha !== value.sha256
      || value.bytes.byteLength === 0 || value.bytes.byteLength > limits.chunkBytes || offset + value.bytes.byteLength > value.totalBytes) throw new Error('ARTIFACT_CORRUPT');
    total = value.totalBytes; sha = value.sha256; chunks.push(value.bytes); offset += value.bytes.byteLength;
    if (offset === total) break;
  }
  const bytes = Buffer.concat(chunks); if (hash(bytes) !== sha) throw new Error('ARTIFACT_CORRUPT');
  return bytes;
}
/** Read only sealed, registered private bodies. Never reopen source files to
 * assemble provider input after consent. Revalidation is a separate check. */
export async function readDiscoverySnapshot(artifacts: DiscoveryArtifactPort, snapshot: DiscoverySnapshot, storeId: string) {
  if (snapshot.state !== 'SEALED' || !snapshot.contextDigest || !snapshot.manifestArtifactId || !snapshot.corpusArtifactId) throw new Error('CONTEXT_CHANGED');
  const [manifestBytes, corpusBytes] = await Promise.all([artifact(artifacts, snapshot.manifestArtifactId, limits.inputBytes), artifact(artifacts, snapshot.corpusArtifactId, limits.corpusBytes)]);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as DiscoveryManifest;
  const corpus = JSON.parse(decoder.decode(corpusBytes)) as { schemaVersion: number; sources: ProviderInput['sources'] };
  const { snapshotId: _id, capturedAt: _at, contextDigest: _digest, ...stable } = manifest;
  if (manifest.snapshotVersion !== 1 || manifest.snapshotId !== snapshot.snapshotId || manifest.storeId !== storeId || manifest.projectId !== snapshot.projectId
    || manifest.configRevision !== snapshot.configRevision || manifest.contextDigest !== snapshot.contextDigest || hash(JSON.stringify(stable)) !== manifest.contextDigest
    || JSON.stringify(manifest.selectors) !== JSON.stringify(snapshot.selectors) || !Array.isArray(manifest.sources) || manifest.sources.length !== snapshot.fileCount
    || manifest.sources.length > limits.files || corpus.schemaVersion !== 1 || !Array.isArray(corpus.sources) || corpus.sources.length !== manifest.sources.length
    || corpusBytes.byteLength !== snapshot.byteCount || Object.keys(corpus).some(key => !['schemaVersion', 'sources'].includes(key))) throw new Error('ARTIFACT_CORRUPT');
  for (let i = 0; i < corpus.sources.length; i++) {
    const source = corpus.sources[i]!, expected = manifest.sources[i]!;
    if (!source || Object.keys(source).some(key => !['sourceId', 'relativePath', 'sha256', 'text'].includes(key)) || typeof source.text !== 'string' || !source.text.isWellFormed()
      || source.sourceId !== expected.sourceId || source.relativePath !== expected.relativePath || source.sha256 !== expected.sha256
      || hash(source.text) !== source.sha256 || Buffer.byteLength(source.text) !== expected.byteLength || expected.byteLength > limits.fileBytes
      || source.sourceId !== hash(`${source.relativePath}\0${source.sha256}`)) throw new Error('ARTIFACT_CORRUPT');
  }
  return { manifest, sources: corpus.sources };
}
export interface DiscoveryLaunch {
  readonly operation: DiscoveryOperation; readonly discovery: DiscoveryRecord; readonly run: DiscoveryRun;
  readonly configuration: ProviderConfiguration; readonly stdin: string;
}
interface LaunchPreparation {
  readonly requestId: string; readonly grantId: string; readonly intent: DiscoveryIntent; readonly snapshot: DiscoverySnapshot;
  readonly configuration: ProviderConfiguration; readonly contextRequest: ContextRequest;
}
interface LaunchDependencies { context: DiscoveryContextPort; artifacts: DiscoveryArtifactPort; provider: ProviderPort }
export async function prepareDiscoveryLaunch(input: LaunchPreparation, dependencies: LaunchDependencies) {
  const deadline = makeDeadline(systemClock, limits.contextMs);
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([prepareWithin(input, dependencies, deadline, controller.signal), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error('DEADLINE_EXCEEDED')); }, deadline.remainingMs());
    })]);
  } finally { clearTimeout(timer); controller.abort(); }
}
async function prepareWithin(input: LaunchPreparation, dependencies: LaunchDependencies, deadline: import('../../ports/clock.js').Deadline, signal: AbortSignal) {
  const sealed = await readDiscoverySnapshot(dependencies.artifacts, input.snapshot, input.intent.storeId);
  const current = await dependencies.context.revalidate(input.contextRequest, sealed.manifest, { deadline, signal });
  if (!current.ok) throw new Error(current.code);
  if (current.value.freshness !== 'CURRENT' || current.value.contextDigest !== input.intent.contextDigest) throw new Error('CONTEXT_CHANGED');
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  const inspected = await dependencies.provider.inspectConfiguredBinary(input.configuration); if (!inspected.ok) throw new Error(inspected.code);
  if (inspected.value.sha256 !== input.configuration.binarySha256 || inspected.value.version !== input.configuration.binaryVersion) throw new Error('PROVIDER_UNSUPPORTED');
  const availability = await dependencies.provider.checkAvailability(input.configuration);
  if (availability.state !== 'AVAILABLE') throw new Error(availability.code ?? 'PROVIDER_UNAVAILABLE');
  if (!availability.capabilities.readOnlyAnalysis || !availability.capabilities.portableTurns || !availability.capabilities.localCancellation) throw new Error('PROVIDER_UNSAFE');
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  const discoveryId = randomUUID(), runId = randomUUID(), generation = randomUUID(), at = new Date().toISOString();
  const serialized = dependencies.provider.serializeInput({ runId, generation, schemaVersion: 1, instructionsVersion: 'project-architect-v1', requestKind: 'INITIAL',
    sources: sealed.sources, answers: [], priorDraft: null, correction: null });
  if (!serialized.ok) throw new Error(serialized.code);
  if (!serialized.value.isWellFormed() || Buffer.byteLength(serialized.value) > limits.inputBytes) throw new Error('PROVIDER_CONTEXT_LIMIT');
  const discovery: DiscoveryRecord = { discoveryId, storeId: input.intent.storeId, projectId: input.snapshot.projectId, sessionId: randomUUID(), state: 'RUNNING', stateRevision: '1',
    snapshotId: input.snapshot.snapshotId, configRevision: input.snapshot.configRevision, providerRevision: input.configuration.revision, currentRunId: runId,
    latestDocumentRevisionId: null, createdAt: at, updatedAt: at, error: null };
  const run: DiscoveryRun = { runId, discoveryId, generation, turnIndex: 1, grantId: input.grantId, requestId: input.requestId, contextDigest: input.snapshot.contextDigest!, inputDigest: hash(serialized.value),
    providerId: input.configuration.providerId, providerRevision: input.configuration.revision, profileDigest: input.configuration.qualificationDigest, modelId: input.configuration.modelId,
    phase: 'SPAWN_INTENT', outcome: 'RUNNING', startedAt: null, endedAt: null, outputWatermark: '0', error: null };
  return { discovery, run, stdin: serialized.value };
}
