import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { DiscoveryIntent } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS as limits, isDiscoveryFailure, type DiscoveryFailure, type DiscoveryOperation, type DiscoveryRecord, type DiscoveryRun } from '../../domain/discovery/model.js';
import type { DiscoveryArtifactPort, DiscoverySnapshot } from '../../ports/discovery.js';
import type { DiscoveryContextPort, DiscoveryManifest, ContextRequest } from '../../ports/discovery-context.js';
import type { ProviderConfiguration, ProviderInput, ProviderPort, ProviderOutputDecoder, ProviderEvent, DiscoveryRunFilesPort } from '../../ports/provider.js';
import { makeDeadline, systemClock } from '../../ports/clock.js';
import type { ArchivePaths } from '../../ports/platform.js';
import type { StoragePort } from '../../ports/storage.js';
import type { DiscoveryMetadataData, DiscoveryMetadataQuery, DiscoveryMetadataChange } from '../../ports/discovery.js';
import { DISCOVERY_RUNTIME_POLICY, type AgentProcessIdentity, type AgentRuntimePort, type AgentExitProof } from '../../ports/agent-runtime.js';
import type { ArchitectResult } from '../../domain/discovery/documents.js';

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
  readonly continuation?: { readonly discovery: DiscoveryRecord; readonly previousRun: DiscoveryRun; readonly answers: readonly import('../../domain/discovery/model.js').DiscoveryAnswer[]; readonly questions: readonly import('../../domain/discovery/model.js').DiscoveryQuestion[] };
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
  if (current.value.freshness === 'UNKNOWN') throw new Error('CONTEXT_UNSTABLE');
  if (current.value.freshness !== 'CURRENT' || current.value.contextDigest !== input.intent.contextDigest) throw new Error('CONTEXT_CHANGED');
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  const inspected = await dependencies.provider.inspectConfiguredBinary(input.configuration); if (!inspected.ok) throw new Error(inspected.code);
  if (inspected.value.sha256 !== input.configuration.binarySha256 || inspected.value.version !== input.configuration.binaryVersion) throw new Error('PROVIDER_UNSUPPORTED');
  const availability = await dependencies.provider.checkAvailability(input.configuration);
  if (availability.state !== 'AVAILABLE') throw new Error(availability.code ?? 'PROVIDER_UNAVAILABLE');
  if (!availability.capabilities.readOnlyAnalysis || !availability.capabilities.portableTurns || !availability.capabilities.localCancellation) throw new Error('PROVIDER_UNSAFE');
  if (deadline.expired()) throw new Error('DEADLINE_EXCEEDED');
  const discoveryId = input.continuation?.discovery.discoveryId ?? randomUUID(), runId = randomUUID(), generation = randomUUID(), at = new Date().toISOString();
  const serialized = dependencies.provider.serializeInput({ runId, generation, schemaVersion: 1, instructionsVersion: 'project-architect-v1', requestKind: input.continuation ? 'ANSWER' : 'INITIAL',
    sources: sealed.sources, answers: input.continuation?.answers ?? [], ...(input.continuation ? { questions: input.continuation.questions } : {}), priorDraft: null, correction: null });
  if (!serialized.ok) throw new Error(serialized.code);
  if (!serialized.value.isWellFormed() || Buffer.byteLength(serialized.value) > limits.inputBytes) throw new Error('PROVIDER_CONTEXT_LIMIT');
  const discovery: DiscoveryRecord = { discoveryId, storeId: input.intent.storeId, projectId: input.snapshot.projectId, sessionId: input.continuation?.discovery.sessionId ?? randomUUID(), state: 'RUNNING', stateRevision: input.continuation ? String(BigInt(input.continuation.discovery.stateRevision) + 1n) : '1',
    snapshotId: input.snapshot.snapshotId, configRevision: input.snapshot.configRevision, providerRevision: input.configuration.revision, currentRunId: runId,
    latestDocumentRevisionId: input.continuation?.discovery.latestDocumentRevisionId ?? null, createdAt: input.continuation?.discovery.createdAt ?? at, updatedAt: at, error: null };
  const run: DiscoveryRun = { runId, discoveryId, generation, turnIndex: input.continuation ? input.continuation.previousRun.turnIndex + 1 : 1, grantId: input.grantId, requestId: input.requestId, contextDigest: input.snapshot.contextDigest!, inputDigest: hash(serialized.value),
    providerId: input.configuration.providerId, providerRevision: input.configuration.revision, profileDigest: input.configuration.qualificationDigest, modelId: input.configuration.modelId,
    phase: 'SPAWN_INTENT', outcome: 'RUNNING', startedAt: null, endedAt: null, outputWatermark: '0', error: null };
  return { discovery, run, stdin: serialized.value };
}

interface LauncherOptions {
  readonly paths: ArchivePaths; readonly instanceId: string;
  readonly storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'getDiscoveryOperation'>;
  readonly provider: ProviderPort; readonly files: DiscoveryRunFilesPort; readonly runtime: AgentRuntimePort;
  readonly onEvent?: (identity: AgentProcessIdentity, event: ProviderEvent) => Promise<void>;
  /** Domain publication (interview/review) is a separate durable core gate. */
  readonly onResult: (identity: AgentProcessIdentity, result: ArchitectResult) => Promise<void>;
}
interface ActiveLaunch {
  readonly generation: string; readonly fingerprint: string; readonly decoder: ProviderOutputDecoder;
  identity: AgentProcessIdentity; failure: DiscoveryFailure | null; finalized: boolean;
  start: Promise<void>; settlement: Promise<void> | undefined;
}
function launchError(error: unknown): DiscoveryFailure { return error instanceof Error && isDiscoveryFailure(error.message) ? error.message : 'PERSISTENCE_UNAVAILABLE'; }
/** Connects the provider boundary to the owned host. It never approves documents
 * or infers process absence from a PID or exit-code string in model output. */
export function createDiscoveryLauncher(options: LauncherOptions) {
  const active = new Map<string, ActiveLaunch>();
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    if (!options.storage.readDiscoveryMetadata) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const read = await options.storage.readDiscoveryMetadata(query); if (!read.ok) throw new Error(read.code); return read.value.data;
  }
  async function commit(change: DiscoveryMetadataChange) {
    if (!options.storage.commitDiscoveryMetadata) throw new Error('DISCOVERY_NOT_INITIALIZED');
    const written = await options.storage.commitDiscoveryMetadata(change); if (!written.ok) throw new Error(written.code);
  }
  async function state(run: DiscoveryRun, next: DiscoveryRecord['state'], verified: boolean) {
    const d = await meta({ kind: 'discovery', id: run.discoveryId });
    if (!d || d.currentRunId !== run.runId) throw new Error('STALE_TARGET');
    if (d.state !== next) await commit({ kind: 'state', discoveryId: d.discoveryId, expectedRevision: d.stateRevision, next, exitVerified: verified });
  }
  async function observedExit(entry: ActiveLaunch, proof: AgentExitProof) {
    const r = await meta({ kind: 'run', id: entry.identity.runId });
    if (!r || r.generation !== entry.generation) throw new Error('STALE_TARGET');
    if (r.phase === 'FINALIZED' || r.phase === 'EXIT_OBSERVED') return;
    const decoded = entry.failure === null && proof.outcome === 'SUCCEEDED' ? entry.decoder.finish(proof.exitCode ?? null) : null;
    const code = entry.failure ?? (decoded && !decoded.ok ? decoded.code : proof.outcome === 'SUCCEEDED' ? null : proof.error ?? 'PROVIDER_UNAVAILABLE');
    const succeeded = code === null && decoded?.ok === true;
    const outcome = succeeded ? 'SUCCEEDED' : entry.failure === null && ['CANCELLED', 'INTERRUPTED', 'TIMED_OUT'].includes(proof.outcome) ? proof.outcome : 'FAILED';
    const exited: DiscoveryRun = { ...r, phase: 'EXIT_OBSERVED', outcome, endedAt: new Date().toISOString(), error: code };
    await commit({ kind: 'run', value: exited, expectedPhase: r.phase, exitVerified: true });
    const process = await meta({ kind: 'process', id: r.runId });
    if (process) await commit({ kind: 'process', value: { ...process, observation: 'ABSENT', releaseState: 'RELEASED' } });
    if (succeeded && decoded?.ok) {
      try { await options.onResult(entry.identity, decoded.value); }
      catch (error) {
        await commit({ kind: 'run', value: { ...exited, phase: 'FINALIZED', outcome: 'FAILED', error: launchError(error) }, expectedPhase: 'EXIT_OBSERVED', exitVerified: true });
        await state(exited, 'FAILED', true); entry.finalized = true; active.delete(r.runId); throw error;
      }
    } else {
      const d = await meta({ kind: 'discovery', id: r.discoveryId });
      await state(exited, d?.state === 'CANCELLING' ? outcome === 'CANCELLED' ? 'CANCELLED' : 'INTERRUPTED'
        : d?.state === 'RECONCILING' || outcome === 'INTERRUPTED' ? 'INTERRUPTED' : 'FAILED', true);
    }
    entry.finalized = true; active.delete(r.runId);
  }
  async function settle(entry: ActiveLaunch, supplied?: AgentExitProof, noProcess = false) {
    if (entry.settlement) return entry.settlement;
    entry.settlement = (async () => {
      if (noProcess) {
        // The launcher has not called AgentRuntime, whose process intent is
        // durable before fork. Absence is known from control flow, not a PID.
        await observedExit(entry, { runId: entry.identity.runId, generation: entry.generation, hostExited: true, providerExited: true,
          outcome: 'FAILED', authentication: 'NO_PROCESS_CREATED', error: entry.failure ?? 'PROVIDER_UNAVAILABLE' }); return;
      }
      const verified = await options.runtime.reconcile(entry.identity);
      if (!verified.ok || !verified.value || !verified.value.hostExited || !verified.value.providerExited
        || verified.value.runId !== entry.identity.runId || verified.value.generation !== entry.generation
        || supplied && supplied.authentication !== verified.value.authentication) {
        const r = await meta({ kind: 'run', id: entry.identity.runId }); if (r) await state(r, 'RECONCILING', false); return;
      }
      await observedExit(entry, verified.value);
    })();
    try { await entry.settlement; } finally { if (!entry.finalized) entry.settlement = undefined; }
  }
  return {
    async launch(input: DiscoveryLaunch) {
      const fingerprint = hash(JSON.stringify({ run: input.run, stdin: input.stdin, configuration: input.configuration }));
      const previous = active.get(input.run.runId);
      if (previous) { if (previous.generation !== input.run.generation || previous.fingerprint !== fingerprint) throw new Error('IDEMPOTENCY_CONFLICT'); return previous.start; }
      if (active.size >= limits.hosts) throw new Error('DISCOVERY_BUSY');
      if (!options.provider.createOutputDecoder || typeof options.onResult !== 'function') throw new Error('PROVIDER_UNSUPPORTED');
      const entry: ActiveLaunch = { generation: input.run.generation, fingerprint, decoder: options.provider.createOutputDecoder(), failure: null, finalized: false,
        identity: { runId: input.run.runId, generation: input.run.generation, owningInstanceId: options.instanceId, hostPid: null, providerPid: null,
          hostEndpoint: join(options.paths.runtimeDirectory, `a-${input.run.runId}.sock`), credentialRef: join(options.paths.credentialsDirectory, `agent-${input.run.runId}.key`),
          observation: 'UNKNOWN', releaseState: 'OWNED', policy: DISCOVERY_RUNTIME_POLICY }, start: Promise.resolve(), settlement: undefined };
      active.set(input.run.runId, entry);
      entry.start = (async () => {
        let attempted = false, admitted = false;
        try {
          const run = await meta({ kind: 'run', id: input.run.runId });
          const op = await options.storage.getDiscoveryOperation?.(input.operation.requestId);
          if (!run || run.generation !== input.run.generation || run.phase !== 'SPAWN_INTENT' || run.outcome !== 'RUNNING' || run.inputDigest !== hash(input.stdin)
            || input.configuration.revision !== run.providerRevision || input.configuration.modelId !== run.modelId || input.configuration.qualificationDigest !== run.profileDigest
            || !op || op.outcome !== 'SUCCEEDED' || op.runId !== run.runId || op.discoveryId !== run.discoveryId) throw new Error('APPROVAL_REQUIRED');
          if (await meta({ kind: 'process', id: run.runId })) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
          admitted = true;
          const files = await options.files.prepare(run.runId); if (!files.ok) throw new Error(files.code);
          const invocation = await options.provider.buildInvocation(input.configuration, files.value.runtime, files.value.schema); if (!invocation.ok) throw new Error(invocation.code);
          attempted = true;
          const launched = await options.runtime.launch({ identity: entry.identity, invocation: invocation.value, stdin: input.stdin, deadline: makeDeadline(systemClock, limits.contextMs) });
          if (!launched.ok) throw new Error(launched.code); entry.identity = launched.value;
          const ready = await meta({ kind: 'run', id: run.runId }); if (!ready || ready.phase !== 'HOST_READY') throw new Error('INVALID_TRANSITION');
          await commit({ kind: 'run', value: { ...ready, phase: 'SPAWN_AUTHORIZED' }, expectedPhase: 'HOST_READY', exitVerified: false });
          const go = await options.runtime.authorizeStart(entry.identity); if (!go.ok) throw new Error(go.code);
        } catch (error) {
          entry.failure = launchError(error);
          if (admitted) {
            if (attempted) {
              await options.runtime.cancel(entry.identity, makeDeadline(systemClock, limits.cancelMs)); await settle(entry);
            } else await settle(entry, undefined, true);
          } else { entry.finalized = true; active.delete(input.run.runId); }
          throw error;
        }
      })();
      return entry.start;
    },
    async output(identity: AgentProcessIdentity, bytes: Uint8Array) {
      const entry = active.get(identity.runId); if (!entry || entry.generation !== identity.generation) throw new Error('STALE_TARGET');
      const decoded = entry.decoder.feed(bytes);
      if (!decoded.ok) { entry.failure = decoded.code; for (const event of decoded.partial ?? []) await options.onEvent?.(identity, event); throw new Error(decoded.code); }
      try { for (const event of decoded.value) await options.onEvent?.(identity, event); }
      catch (error) { entry.failure = launchError(error); throw error; }
    },
    async exited(identity: AgentProcessIdentity, proof: AgentExitProof) {
      const entry = active.get(identity.runId); if (!entry) return;
      if (entry.generation !== identity.generation) throw new Error('STALE_TARGET');
      await settle(entry, proof);
    },
  };
}
