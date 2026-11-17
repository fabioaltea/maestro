import { createHash, randomUUID } from 'node:crypto';
import { canonicalDiscoveryIntent, validateDiscoveryGrant, type DiscoveryIntent } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS, isDiscoveryFailure, type DiscoveryFailure, type DiscoveryResult } from '../../domain/discovery/model.js';
import { requireUuid } from '../../domain/identifiers.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ArchivePaths, AuthenticatedPeer } from '../../ports/platform.js';
import type { DiscoveryAdmission, DiscoveryArtifactPort, DiscoveryMetadataData, DiscoveryMetadataQuery } from '../../ports/discovery.js';
import type { DiscoveryContextPort, ContextRequest } from '../../ports/discovery-context.js';
import { makeDeadline, systemClock } from '../../ports/clock.js';
import { prepareDiscoveryLaunch, readDiscoverySnapshot, type DiscoveryLaunch } from './launch.js';
import { sealDiscoveryContext } from './context.js';
import { requireDiscoveryEnvelope } from '../../protocol/discovery.js';
import type { CodexInspectionPort, ProviderAvailability, ProviderConfiguration, ProviderPort } from '../../ports/provider.js';
import { CODEX_DISCOVERY_PIN } from '../../providers/codex/argv.js';
import { CODEX_DISCOVERY_QUALIFICATION, validCodexModel } from '../../providers/codex/capabilities.js';
import { createDiscoveryReview } from './review.js';
import { createDiscoveryInterview } from './interview.js';
import type { AgentProcessIdentity } from '../../ports/agent-runtime.js';
import type { DiscoveryQuestions } from '../../domain/discovery/documents.js';

interface Options {
  readonly storage: Pick<StoragePort, 'readSnapshot' | 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'admitDiscoveryOperation' | 'getDiscoveryOperation' | 'saveDiscoveryGrant' | 'getProject' | 'discardDiscoveryPreview'>;
  readonly paths: ArchivePaths; readonly instanceId: string; readonly ownerUid: number;
  readonly provider: ProviderPort; readonly inspection?: CodexInspectionPort;
  readonly context?: DiscoveryContextPort; readonly artifacts?: DiscoveryArtifactPort;
  readonly launch?: (input: DiscoveryLaunch) => Promise<void>;
  readonly cancel?: (discoveryId: string, requestId: string) => Promise<void>;
  readonly checkpoint?: (point: string) => Promise<void>;
}
export interface DiscoveryCommand { readonly requestId: string; readonly grantId: string | null; readonly canonicalIntent: string }
export interface DiscoveryAccepted { readonly accepted: true; readonly requestId: string; readonly discoveryId?: string; readonly sessionId?: string; readonly runId?: string }
function fail(code: DiscoveryFailure): never { throw new Error(code); }
function failure(error: unknown): { ok: false; code: DiscoveryFailure } {
  return { ok: false, code: error instanceof SyntaxError || error instanceof Error && error.message === 'INVALID_IDENTIFIER' ? 'INVALID_REQUEST'
    : error instanceof Error && isDiscoveryFailure(error.message) ? error.message as DiscoveryFailure : 'PERSISTENCE_UNAVAILABLE' };
}
function exact(value: object, keys: readonly string[]) { if (!value || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_REQUEST'); }
export function createDiscoveryOperations(options: Options) {
  const { storage } = options;
  const interview = options.context && options.artifacts ? createDiscoveryInterview({ storage, paths: options.paths, context: options.context, artifacts: options.artifacts, provider: options.provider }) : null;
  const review = options.context && options.artifacts ? createDiscoveryReview({ storage, paths: options.paths, context: options.context, artifacts: options.artifacts, provider: options.provider }) : null;
  const answering = new Set<string>();
  let lastCheck: { revision: string; value: ProviderAvailability } | null = null;
  const jobs = new Set<Promise<void>>();
  function job(work: () => Promise<void>) {
    const running = work(); jobs.add(running); void running.finally(() => jobs.delete(running)).catch(() => {});
  }
  async function guard(peer: AuthenticatedPeer) {
    if (peer.role !== 'client') fail('UNAUTHORIZED');
    const s = await storage.readSnapshot();
    if (!s || s.store.ownerUid !== options.ownerUid || s.store.canonicalPath !== options.paths.directory
      || s.instance?.instanceId !== options.instanceId || s.instance.lifecycle !== 'RUNNING') fail('STALE_TARGET');
    return s!;
  }
  async function meta<Q extends DiscoveryMetadataQuery>(query: Q): Promise<DiscoveryMetadataData<Q>> {
    if (!storage.readDiscoveryMetadata) return fail('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.readDiscoveryMetadata(query); if (!result.ok) return fail(result.code); return result.value.data;
  }
  async function commit(change: Parameters<NonNullable<StoragePort['commitDiscoveryMetadata']>>[0]) {
    if (!storage.commitDiscoveryMetadata) fail('DISCOVERY_NOT_INITIALIZED');
    const result = await storage.commitDiscoveryMetadata!(change); if (!result.ok) fail(result.code);
  }
  async function intentFor(peer: AuthenticatedPeer, raw: DiscoveryIntent | string) {
    const s = await guard(peer);
    const canonical = canonicalDiscoveryIntent(typeof raw === 'string' ? JSON.parse(raw) : raw);
    if (typeof raw === 'string' && raw !== canonical) fail('INVALID_REQUEST');
    const intent = JSON.parse(canonical) as DiscoveryIntent;
    if (intent.ownerUid !== options.ownerUid) fail('APPROVAL_REQUIRED');
    if (intent.storeId !== s.store.storeId) fail('WRONG_STORE');
    return { canonical, intent, snapshot: s };
  }
  function admission(requestId: string, canonicalIntent: string, grantId: string | null): DiscoveryAdmission {
    requireUuid(requestId); const intent = JSON.parse(canonicalIntent) as DiscoveryIntent;
    return { requestId, action: intent.action, canonicalIntent, payloadHash: createHash('sha256').update(canonicalIntent).digest('hex'), grantId,
      ownerUid: options.ownerUid, instanceId: options.instanceId, acceptedAt: new Date().toISOString(), nowMs: Date.now(),
      discovery: null, run: null, expectedStateRevision: null, acquireSlot: false };
  }
  async function original(input: DiscoveryCommand, action: DiscoveryIntent['action']) {
    requireUuid(input.requestId);
    const old = await storage.getDiscoveryOperation?.(input.requestId);
    if (old) {
      // Public operations omit the intent/hash: compare through the ledger's
      // replay path rather than accepting a UUID with another payload.
      if (old.action !== action) fail('IDEMPOTENCY_CONFLICT');
      if (!storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
      const result = await storage.admitDiscoveryOperation!(admission(input.requestId, input.canonicalIntent, input.grantId));
      if (!result.ok) fail(result.code); return true;
    }
    return false;
  }
  async function configureIntent(intent: DiscoveryIntent) {
    const c = await meta({ kind: 'provider' }), p = intent.payload;
    if (intent.action !== 'configure' || intent.targetId !== intent.storeId || intent.configRevision !== null || intent.stateRevision !== null
      || intent.snapshotId !== null || intent.contextDigest !== null || intent.providerRevision !== (c?.revision ?? null)
      || p.expectedProviderRevision !== (c?.revision ?? null)) fail('APPROVAL_STALE');
    if (!validCodexModel(p.modelId) || intent.modelId !== p.modelId || p.binarySha256 !== CODEX_DISCOVERY_PIN.sha256
      || p.binaryVersion !== CODEX_DISCOVERY_PIN.version || p.providerProfileDigest !== CODEX_DISCOVERY_QUALIFICATION.digest
      || intent.providerProfileDigest !== CODEX_DISCOVERY_QUALIFICATION.digest || typeof p.binaryRealpath !== 'string') fail('PROVIDER_UNSUPPORTED');
    if (!options.inspection) fail('PROVIDER_UNAVAILABLE');
    const inspected = await options.inspection!.inspectBinary(p.binaryRealpath as string);
    if (!inspected.ok) fail(inspected.code);
    if (inspected.value.sha256 !== p.binarySha256 || inspected.value.version !== p.binaryVersion) fail('PROVIDER_UNSUPPORTED');
    return c;
  }
  async function projectRequest(projectId: string, configRevision: string, selectors: readonly string[], storeId: string): Promise<ContextRequest> {
    const p = await storage.getProject(projectId); if (!p) fail('PROJECT_NOT_FOUND'); if (p.project.removedAt !== null) fail('PROJECT_REMOVED');
    if (p.project.configRevision !== configRevision) fail('APPROVAL_STALE');
    const provider = await meta({ kind: 'provider' });
    return { storeId, projectId, configRevision, selectors, checkoutPath: p.project.referenceCheckout.root.canonicalPath,
      excludedRoots: [options.paths.directory, options.paths.runtimeDirectory, ...(provider ? [provider.authProfileRef] : [])] };
  }
  async function startIntent(intent: DiscoveryIntent) {
    const c = await meta({ kind: 'provider' }); if (!c) fail('PROVIDER_NOT_CONFIGURED');
    if (intent.action !== 'start' || intent.stateRevision !== null || !intent.snapshotId || !intent.contextDigest || !intent.configRevision
      || intent.payload.snapshotId !== intent.snapshotId || intent.providerRevision !== c.revision || intent.modelId !== c.modelId
      || intent.providerProfileDigest !== c.qualificationDigest) fail('APPROVAL_STALE');
    const snapshot = await meta({ kind: 'snapshot', id: intent.snapshotId });
    if (!snapshot || snapshot.state !== 'SEALED' || snapshot.projectId !== intent.targetId || snapshot.configRevision !== intent.configRevision
      || snapshot.contextDigest !== intent.contextDigest || !snapshot.pinned && (snapshot.expiresAtMs === null || snapshot.expiresAtMs <= Date.now())) fail('CONTEXT_CHANGED');
    const request = await projectRequest(snapshot.projectId, snapshot.configRevision, snapshot.selectors, intent.storeId);
    return { configuration: c, snapshot, request };
  }
  async function usable(c: ProviderConfiguration) {
    const checked = await options.provider.checkAvailability(c);
    if (checked.state !== 'AVAILABLE') fail(checked.code ?? 'PROVIDER_UNAVAILABLE');
    if (!checked.capabilities.readOnlyAnalysis || !checked.capabilities.portableTurns || !checked.capabilities.localCancellation) fail('PROVIDER_UNSAFE');
    return checked;
  }
  async function cancelIntent(intent: DiscoveryIntent) {
    const d = await meta({ kind: 'discovery', id: intent.targetId }), snapshot = d ? await meta({ kind: 'snapshot', id: d.snapshotId }) : null;
    if (!d || intent.action !== 'cancel' || d.storeId !== intent.storeId || d.stateRevision !== intent.stateRevision || d.configRevision !== intent.configRevision
      || d.providerRevision !== intent.providerRevision || d.snapshotId !== intent.snapshotId || snapshot?.contextDigest !== intent.contextDigest || intent.modelId !== null || intent.providerProfileDigest !== null || Object.keys(intent.payload).length
      || !['RUNNING', 'UPDATING', 'WAITING_USER', 'READY_FOR_REVIEW', 'CANCELLING', 'RECONCILING'].includes(d.state)) fail('APPROVAL_STALE');
    return d;
  }
  async function blocked(requestId: string, error: unknown) {
    const operation = await storage.getDiscoveryOperation?.(requestId);
    if (operation && operation.phase !== 'FINALIZED') await commit({ kind: 'operation', requestId, outcome: 'BLOCKED', completedAt: new Date().toISOString(), result: null, error: failure(error).code });
  }
  return {
    async prepare(peer: AuthenticatedPeer, raw: DiscoveryIntent) {
      try {
        const { canonical, intent } = await intentFor(peer, raw);
        let summary: Record<string, unknown>;
        if (intent.action === 'configure') {
          await configureIntent(intent); summary = { action: intent.action, modelId: intent.modelId, sendsProjectData: false };
        } else if (intent.action === 'start') {
          const current = await startIntent(intent); await usable(current.configuration);
          if (!options.artifacts) fail('DISCOVERY_NOT_INITIALIZED');
          const sealed = await readDiscoverySnapshot(options.artifacts, current.snapshot, intent.storeId);
          summary = { action: 'start', projectId: current.snapshot.projectId, snapshotId: current.snapshot.snapshotId, contextDigest: current.snapshot.contextDigest,
            selectors: current.snapshot.selectors, fileCount: sealed.manifest.sources.length, byteCount: current.snapshot.byteCount, omissions: current.snapshot.omissions,
            providerId: current.configuration.providerId, providerRevision: current.configuration.revision, modelId: current.configuration.modelId,
            sendsProjectData: true, data: 'Selected sealed source text is sent to the configured AI provider for read-only project discovery.' };
        } else if (intent.action === 'correct' || intent.action === 'approve') {
          if (!review) fail('DISCOVERY_NOT_INITIALIZED');
          const current = await review!.inspect(intent);
          summary = { action: intent.action, projectId: current.discovery.projectId, revisionId: current.revision.revisionId, bundleDigest: current.revision.bundleDigest, contextDigest: current.revision.contextDigest, sendsProjectData: intent.action === 'correct', modelId: current.configuration.modelId };
        } else if (intent.action === 'cancel') {
          const d = await cancelIntent(intent); summary = { action: 'cancel', projectId: d.projectId, snapshotId: d.snapshotId, contextDigest: intent.contextDigest, sendsProjectData: false, data: 'Stop only the owned local execution; remote cancellation is not verified.' };
        } else if (intent.action === 'answer') {
          if (!interview) fail('DISCOVERY_NOT_INITIALIZED');
          const current = await interview!.inspect(intent);
          summary = { action: 'answer', projectId: current.discovery.projectId, snapshotId: current.snapshot.snapshotId, contextDigest: current.snapshot.contextDigest,
            providerId: current.configuration.providerId, providerRevision: current.configuration.revision, modelId: current.configuration.modelId, sendsProjectData: true,
            data: 'Confirmed answer and the original sealed sources are sent in a new read-only run.' };
        } else fail('INVALID_REQUEST');
        const grant = { grantId: randomUUID(), canonicalIntent: canonical, expiresAtMs: Date.now() + DISCOVERY_LIMITS.grantMs, consumedByRequestId: null };
        const prepared = { grantId: grant.grantId, canonicalIntent: canonical, expiresAtMs: grant.expiresAtMs, summary };
        requireDiscoveryEnvelope(prepared);
        if (!storage.saveDiscoveryGrant) fail('DISCOVERY_NOT_INITIALIZED');
        const saved = await storage.saveDiscoveryGrant!(grant); if (!saved.ok) fail(saved.code);
        return { ok: true, value: prepared } as const;
      } catch (error) { return failure(error); }
    },
    async publishDocument(identity: AgentProcessIdentity, result: import('../../domain/discovery/documents.js').DiscoveryDocument) {
      if (!review) fail('DISCOVERY_NOT_INITIALIZED'); await review!.publish(identity, result);
    },
    async correct(peer: AuthenticatedPeer, input: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'canonicalIntent']); const { intent } = await intentFor(peer, input.canonicalIntent);
        if (intent.action !== 'correct' || !review || !options.launch) fail('INVALID_REQUEST');
        if (await original(input, 'correct')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        await review!.inspect(intent);
        const admitted = await storage.admitDiscoveryOperation!({ ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'PREPARE', expectedStateRevision: intent.stateRevision }); if (!admitted.ok) fail(admitted.code);
        if (admitted.value.inserted) job(async () => {
          try { const prepared = await review!.continuation(intent, input.requestId, input.grantId!); await guard(peer);
            const active = await storage.admitDiscoveryOperation!({ ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'ACTIVATE', discovery: prepared.discovery, run: prepared.run, expectedStateRevision: intent.stateRevision, acquireSlot: true });
            if (!active.ok) fail(active.code); if (active.value.inserted) await options.launch!({ ...prepared, operation: active.value.operation });
          } catch (error) { await blocked(input.requestId, error); }
        });
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async publishQuestions(identity: AgentProcessIdentity, result: DiscoveryQuestions) {
      if (!interview) fail('DISCOVERY_NOT_INITIALIZED'); await interview!.publish(identity, result);
    },
    async cancelGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; discoveryId: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'discoveryId']); requireUuid(input.requestId); requireUuid(input.discoveryId); await guard(peer);
        const grant = await meta({ kind: 'grant', id: input.grantId }); if (!grant) fail('APPROVAL_REQUIRED');
        const { intent } = await intentFor(peer, grant.canonicalIntent);
        if (intent.action !== 'cancel' || intent.targetId !== input.discoveryId) fail('APPROVAL_REQUIRED');
        const command = { requestId: input.requestId, grantId: input.grantId, canonicalIntent: grant.canonicalIntent };
        if (await original(command, 'cancel')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        const d = await cancelIntent(intent);
        await commit({ kind: 'cancel', discoveryId: d.discoveryId, expectedRevision: d.stateRevision, admission: { ...admission(input.requestId, grant.canonicalIntent, input.grantId), discovery: d, expectedStateRevision: d.stateRevision } });
        if ((await storage.getDiscoveryOperation?.(input.requestId))?.phase !== 'FINALIZED') job(async () => {
          try { if (!options.cancel) fail('RESOURCE_IDENTITY_UNKNOWN'); await options.cancel!(d.discoveryId, input.requestId); }
          catch { await commit({ kind: 'operation-uncertain', requestId: input.requestId, error: 'RESOURCE_IDENTITY_UNKNOWN' }); }
        });
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async answer(peer: AuthenticatedPeer, input: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>> {
      let uncertain = false;
      try {
        exact(input, ['requestId', 'grantId', 'canonicalIntent']);
        const { intent } = await intentFor(peer, input.canonicalIntent);
        if (intent.action !== 'answer' || !interview || !options.launch || !storage.admitDiscoveryOperation) fail('INVALID_REQUEST');
        if (await original(input, 'answer')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        await interview!.inspect(intent);
        const p = intent.payload; uncertain = true;
        await commit({ kind: 'answer', admission: { ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'PREPARE', expectedStateRevision: intent.stateRevision },
          value: { answerId: p.answerId as string, questionId: p.questionId as string, questionRevision: p.questionRevision as string, revision: p.answerRevision as string,
            requestId: input.requestId, kind: p.kind as 'ANSWER' | 'UNKNOWN', text: p.text as string, confirmedAt: new Date().toISOString() } });
        const saved = await storage.getDiscoveryOperation?.(input.requestId);
        if (saved?.phase === 'ACCEPTED' && !answering.has(input.requestId)) {
          answering.add(input.requestId);
          job(async () => {
            try {
              await options.checkpoint?.('discovery.answer.beforeRevalidation');
              const prepared = await interview!.continuation(intent, input.requestId, input.grantId!); await guard(peer);
              const activated = await storage.admitDiscoveryOperation!({ ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'ACTIVATE',
                discovery: prepared.discovery, run: prepared.run, expectedStateRevision: intent.stateRevision, acquireSlot: true });
              if (!activated.ok) fail(activated.code);
              if (activated.value.inserted) await options.launch!({ ...prepared, operation: activated.value.operation });
            } catch (error) {
              if (failure(error).code === 'CONTEXT_CHANGED') {
                const q = await meta({ kind: 'question', id: intent.targetId }), d = q ? await meta({ kind: 'discovery', id: q.discoveryId }) : null;
                if (d?.state === 'WAITING_USER' && d.stateRevision === intent.stateRevision) await commit({ kind: 'state', discoveryId: d.discoveryId, expectedRevision: d.stateRevision, next: 'STALE', exitVerified: true });
              }
              await blocked(input.requestId, error);
            } finally { answering.delete(input.requestId); }
          });
        }
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return uncertain && ['PERSISTENCE_UNAVAILABLE', 'UNKNOWN_OUTCOME', 'DEADLINE_EXCEEDED'].includes(failure(error).code) ? { ok: false, code: 'UNKNOWN_OUTCOME' } : failure(error); }
    },
    async answerGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; questionId: string; kind: 'ANSWER' | 'UNKNOWN'; text: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'questionId', 'kind', 'text']); requireUuid(input.requestId); requireUuid(input.questionId); await guard(peer);
        const grant = await meta({ kind: 'grant', id: input.grantId }); if (!grant) fail('APPROVAL_REQUIRED');
        const { intent } = await intentFor(peer, grant.canonicalIntent);
        if (intent.action !== 'answer' || intent.targetId !== input.questionId || intent.payload.kind !== input.kind || intent.payload.text !== input.text) fail('ANSWER_CONFLICT');
        return await this.answer(peer, { requestId: input.requestId, grantId: input.grantId, canonicalIntent: grant.canonicalIntent });
      } catch (error) { return failure(error); }
    },
    async start(peer: AuthenticatedPeer, input: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>> {
      let admissionUncertain = false;
      try {
        exact(input, ['requestId', 'grantId', 'canonicalIntent']);
        const { intent } = await intentFor(peer, input.canonicalIntent);
        if (intent.action !== 'start') fail('INVALID_REQUEST');
        if (!options.context || !options.artifacts || !options.launch || !storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
        // Resolve the original receipt before expiry or new preconditions. The
        // ledger verifies the canonical payload without scheduling another job.
        if (await original(input, 'start')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        await startIntent(intent);
        await options.checkpoint?.('discovery.start.beforeAdmission');
        admissionUncertain = true;
        const accepted = await storage.admitDiscoveryOperation({ ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'PREPARE' });
        if (!accepted.ok) { admissionUncertain = false; fail(accepted.code); }
        if (accepted.value.inserted) job(async () => {
          try {
            const current = await startIntent(intent);
            const prepared = await prepareDiscoveryLaunch({ requestId: input.requestId, grantId: input.grantId!, intent,
              snapshot: current.snapshot, configuration: current.configuration, contextRequest: current.request },
              { context: options.context!, artifacts: options.artifacts!, provider: options.provider });
            // Recheck daemon authority after asynchronous filesystem/provider
            // work, then atomically check provider/project/snapshot in SQLite.
            await guard(peer);
            const activated = await storage.admitDiscoveryOperation!({ ...admission(input.requestId, input.canonicalIntent, input.grantId), startStage: 'ACTIVATE',
              discovery: prepared.discovery, run: prepared.run, acquireSlot: true });
            if (!activated.ok) fail(activated.code);
            if (activated.value.inserted) await options.launch!({ ...prepared, operation: activated.value.operation, configuration: current.configuration });
          } catch (error) { await blocked(input.requestId, error); }
        });
        await options.checkpoint?.('discovery.start.afterAcceptance');
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return admissionUncertain ? { ok: false, code: 'UNKNOWN_OUTCOME' } : failure(error); }
    },
    async startGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; projectId: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'projectId']); requireUuid(input.requestId); requireUuid(input.projectId); await guard(peer);
        const grant = await meta({ kind: 'grant', id: input.grantId }); if (!grant) fail('APPROVAL_REQUIRED');
        const { intent } = await intentFor(peer, grant.canonicalIntent);
        if (intent.action !== 'start' || intent.targetId !== input.projectId) fail('APPROVAL_REQUIRED');
        return await this.start(peer, { requestId: input.requestId, grantId: input.grantId, canonicalIntent: grant.canonicalIntent });
      } catch (error) { return failure(error); }
    },
    async configureGranted(peer: AuthenticatedPeer, input: { requestId: string; grantId: string; binaryRealpath: string; modelId: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'binaryRealpath', 'modelId']); requireUuid(input.requestId); await guard(peer);
        const grant = await meta({ kind: 'grant', id: input.grantId }); if (!grant) fail('APPROVAL_REQUIRED');
        const { intent } = await intentFor(peer, grant.canonicalIntent);
        if (intent.action !== 'configure' || intent.payload.binaryRealpath !== input.binaryRealpath || intent.payload.modelId !== input.modelId) fail('APPROVAL_REQUIRED');
        return await this.configure(peer, { requestId: input.requestId, grantId: input.grantId, canonicalIntent: grant.canonicalIntent });
      } catch (error) { return failure(error); }
    },
    async preview(peer: AuthenticatedPeer, input: { requestId: string; projectId: string; expectedConfigRevision: string; selectors: readonly string[] }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'projectId', 'expectedConfigRevision', 'selectors']);
        const s = await guard(peer); requireUuid(input.projectId);
        if (!options.context || !options.artifacts || !storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
        const intent: DiscoveryIntent = { ownerUid: options.ownerUid, storeId: s.store.storeId, action: 'preview', targetId: input.projectId,
          configRevision: input.expectedConfigRevision, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: null,
          providerProfileDigest: null, modelId: null, payload: { selectors: input.selectors } };
        const canonicalIntent = canonicalDiscoveryIntent(intent);
        if (await original({ requestId: input.requestId, canonicalIntent, grantId: null }, 'preview')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        const request = await projectRequest(input.projectId, input.expectedConfigRevision, input.selectors, s.store.storeId);
        const accepted = await storage.admitDiscoveryOperation(admission(input.requestId, canonicalIntent, null));
        if (!accepted.ok) fail(accepted.code);
        if (accepted.value.inserted) job(async () => {
          try {
            const sealed = await sealDiscoveryContext(request, { context: options.context!, artifacts: options.artifacts!, saveSnapshot: async value => {
              await guard(peer);
              await projectRequest(request.projectId, request.configRevision, request.selectors, request.storeId);
              await commit({ kind: 'snapshot', value }); return { ok: true, value: undefined };
            } }, { deadline: makeDeadline(systemClock, DISCOVERY_LIMITS.contextMs) });
            if (!sealed.ok) fail(sealed.code);
            await commit({ kind: 'operation', requestId: input.requestId, outcome: 'SUCCEEDED', completedAt: new Date().toISOString(), result: { snapshotId: sealed.value.snapshotId }, error: null });
          } catch (error) { await blocked(input.requestId, error); }
        });
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async discard(peer: AuthenticatedPeer, input: { requestId: string; snapshotId: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'snapshotId']); requireUuid(input.snapshotId); const s = await guard(peer);
        if (!storage.admitDiscoveryOperation || !storage.discardDiscoveryPreview) fail('DISCOVERY_NOT_INITIALIZED');
        const canonicalIntent = canonicalDiscoveryIntent({ ownerUid: options.ownerUid, storeId: s.store.storeId, action: 'discard', targetId: input.snapshotId,
          configRevision: null, stateRevision: null, snapshotId: input.snapshotId, contextDigest: null, providerRevision: null, providerProfileDigest: null, modelId: null, payload: { snapshotId: input.snapshotId } });
        const accepted = await storage.admitDiscoveryOperation(admission(input.requestId, canonicalIntent, null)); if (!accepted.ok) fail(accepted.code);
        if (accepted.value.inserted) job(async () => {
          try {
            await guard(peer); const discarded = await storage.discardDiscoveryPreview!(input.snapshotId); if (!discarded.ok) fail(discarded.code);
            await commit({ kind: 'operation', requestId: input.requestId, outcome: 'SUCCEEDED', completedAt: new Date().toISOString(), result: { snapshotId: input.snapshotId }, error: null });
          } catch (error) { await blocked(input.requestId, error); }
        });
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async configure(peer: AuthenticatedPeer, input: DiscoveryCommand): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'grantId', 'canonicalIntent']);
        const { intent } = await intentFor(peer, input.canonicalIntent);
        if (intent.action !== 'configure') fail('INVALID_REQUEST');
        if (await original(input, 'configure')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        const previous = await configureIntent(intent);
        if (!input.grantId) fail('APPROVAL_REQUIRED');
        const grant = await meta({ kind: 'grant', id: input.grantId });
        if (!grant || validateDiscoveryGrant(grant, input.canonicalIntent, input.requestId, Date.now()) !== 'CONSUME') fail('APPROVAL_REQUIRED');
        // Explicit configuration only: create the dedicated non-secret UUID,
        // never copy credentials or invoke the login command.
        const auth = await options.inspection!.prepareAuthHome(); if (!auth.ok) fail(auth.code);
        const p = intent.payload;
        const configuration: ProviderConfiguration = { providerId: 'codex', revision: String(BigInt(previous?.revision ?? '0') + 1n),
          binaryRealpath: p.binaryRealpath as string, binarySha256: p.binarySha256 as string, binaryVersion: p.binaryVersion as string,
          modelId: p.modelId as string, authProfileRef: auth.value, policyVersion: CODEX_DISCOVERY_PIN.policyVersion,
          qualificationDigest: CODEX_DISCOVERY_QUALIFICATION.digest, configuredAt: new Date().toISOString() };
        await commit({ kind: 'configure', configuration, expectedRevision: previous?.revision ?? null, admission: admission(input.requestId, input.canonicalIntent, input.grantId) });
        lastCheck = null;
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async check(peer: AuthenticatedPeer, input: { requestId: string; expectedProviderRevision: string }): Promise<DiscoveryResult<DiscoveryAccepted>> {
      try {
        exact(input, ['requestId', 'expectedProviderRevision']);
        const s = await guard(peer);
        const intent: DiscoveryIntent = { ownerUid: options.ownerUid, storeId: s.store.storeId, action: 'check', targetId: s.store.storeId,
          configRevision: null, stateRevision: null, snapshotId: null, contextDigest: null, providerRevision: input.expectedProviderRevision,
          providerProfileDigest: null, modelId: null, payload: {} };
        const canonicalIntent = canonicalDiscoveryIntent(intent);
        if (await original({ requestId: input.requestId, canonicalIntent, grantId: null }, 'check')) return { ok: true, value: { accepted: true, requestId: input.requestId } };
        const c = await meta({ kind: 'provider' });
        if (!c) fail('PROVIDER_NOT_CONFIGURED');
        if (c.revision !== input.expectedProviderRevision) fail('APPROVAL_STALE');
        if (!storage.admitDiscoveryOperation) fail('DISCOVERY_NOT_INITIALIZED');
        const admitted = await storage.admitDiscoveryOperation!(admission(input.requestId, canonicalIntent, null));
        if (!admitted.ok) fail(admitted.code);
        if (admitted.value.inserted) {
          const job = (async () => {
            try {
              const checked = await options.provider.checkAvailability(c!);
              const current = await meta({ kind: 'provider' });
              if (current?.revision !== c!.revision) fail('APPROVAL_STALE');
              lastCheck = { revision: c!.revision, value: checked };
              await commit({ kind: 'operation', requestId: input.requestId, outcome: checked.state === 'AVAILABLE' ? 'SUCCEEDED' : 'BLOCKED',
                completedAt: new Date().toISOString(), result: { providerRevision: c!.revision }, error: checked.code });
            } catch (error) {
              await commit({ kind: 'operation', requestId: input.requestId, outcome: 'BLOCKED', completedAt: new Date().toISOString(), result: null, error: failure(error).code });
            }
          })();
          jobs.add(job); void job.finally(() => jobs.delete(job)).catch(() => {});
        }
        return { ok: true, value: { accepted: true, requestId: input.requestId } };
      } catch (error) { return failure(error); }
    },
    async get(peer: AuthenticatedPeer, requestId: string) { await guard(peer); requireUuid(requestId); return await storage.getDiscoveryOperation?.(requestId) ?? null; },
    async availability(peer: AuthenticatedPeer) { await guard(peer); const c = await meta({ kind: 'provider' }); return lastCheck?.revision === c?.revision ? lastCheck?.value ?? null : null; },
    async idle() { while (jobs.size) await Promise.allSettled([...jobs]); },
  };
}
