import { randomUUID } from 'node:crypto';
import { validateDiscoveryDocument, type DiscoveryDocument } from '../../domain/discovery/documents.js';
import { validateDiscoveryText, type DiscoveryIntent } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS as limits, type DiscoveryRecord } from '../../domain/discovery/model.js';
import type { StoragePort } from '../../ports/storage.js';
import type { ArchivePaths } from '../../ports/platform.js';
import type { DiscoveryArtifactPort, DiscoveryMetadataQuery, DiscoveryMetadataData, DiscoveryMetadataChange } from '../../ports/discovery.js';
import type { DiscoveryContextPort } from '../../ports/discovery-context.js';
import type { ProviderPort } from '../../ports/provider.js';
import type { AgentProcessIdentity } from '../../ports/agent-runtime.js';
import { requireUuid } from '../../domain/identifiers.js';
import { makeDeadline, systemClock } from '../../ports/clock.js';
import { prepareDiscoveryLaunch, readDiscoverySnapshot, readDiscoveryArtifact } from './launch.js';

interface Options { readonly storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'getProject'>;
  readonly paths: ArchivePaths; readonly context: DiscoveryContextPort; readonly artifacts: DiscoveryArtifactPort; readonly provider: ProviderPort }
export function createDiscoveryReview(options: Options) {
  async function meta<Q extends DiscoveryMetadataQuery>(q: Q): Promise<DiscoveryMetadataData<Q>> {
    const r = await options.storage.readDiscoveryMetadata!(q); if (!r.ok) throw new Error(r.code); return r.value.data;
  }
  async function commit(c: DiscoveryMetadataChange) { const r = await options.storage.commitDiscoveryMetadata!(c); if (!r.ok) throw new Error(r.code); }
  async function history<K extends 'questions' | 'answers'>(kind: K, id: string) {
    const all: unknown[] = []; let offset = 0;
    for (;;) { const p = await meta({ kind, id, offset, limit: 20 }); if (!p) throw new Error('ARTIFACT_CORRUPT'); all.push(...p.items); if (all.length > limits.questions) throw new Error('DISCOVERY_LIMIT'); if (p.nextOffset === null) break; if (p.nextOffset <= offset) throw new Error('ARTIFACT_CORRUPT'); offset = p.nextOffset; }
    return all as K extends 'questions' ? import('../../domain/discovery/model.js').DiscoveryQuestion[] : import('../../domain/discovery/model.js').DiscoveryAnswer[];
  }
  async function scope(d: DiscoveryRecord) {
    const project = await options.storage.getProject(d.projectId), snapshot = await meta({ kind: 'snapshot', id: d.snapshotId }), configuration = await meta({ kind: 'provider' });
    if (!project || project.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
    if (project.project.configRevision !== d.configRevision || !snapshot || snapshot.projectId !== d.projectId || snapshot.configRevision !== d.configRevision) throw new Error('CONTEXT_CHANGED');
    if (!configuration || configuration.revision !== d.providerRevision) throw new Error('APPROVAL_STALE');
    const request = { storeId: d.storeId, projectId: d.projectId, configRevision: d.configRevision, selectors: snapshot.selectors, checkoutPath: project.project.referenceCheckout.root.canonicalPath,
      excludedRoots: [options.paths.directory, options.paths.runtimeDirectory, configuration.authProfileRef] };
    return { snapshot, configuration, request };
  }
  async function fresh(d: DiscoveryRecord) {
    try {
      const current = await scope(d), sealed = await readDiscoverySnapshot(options.artifacts, current.snapshot, d.storeId);
      const controller = new AbortController(), deadline = makeDeadline(systemClock, limits.contextMs); let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const fingerprint = await Promise.race([options.context.revalidate(current.request, sealed.manifest, { deadline, signal: controller.signal }), new Promise<never>((_r, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('DEADLINE_EXCEEDED')); }, deadline.remainingMs()); })]);
        if (!fingerprint.ok) throw new Error(fingerprint.code);
        if (fingerprint.value.freshness === 'UNKNOWN') throw new Error('CONTEXT_UNSTABLE');
        if (fingerprint.value.freshness !== 'CURRENT' || fingerprint.value.contextDigest !== current.snapshot.contextDigest) throw new Error('CONTEXT_CHANGED');
        const latest = await meta({ kind: 'discovery', id: d.discoveryId });
        if (!latest || latest.stateRevision !== d.stateRevision || latest.currentRunId !== d.currentRunId || latest.latestDocumentRevisionId !== d.latestDocumentRevisionId) throw new Error('APPROVAL_STALE');
        // Re-read mutable configuration after filesystem I/O. This is a current
        // photograph; no claim of an atomic filesystem/SQLite transaction.
        await scope(d); return { ...current, sealed, checkedAt: fingerprint.value.checkedAt };
      } finally { clearTimeout(timer); controller.abort(); }
    } catch (error) {
      if (error instanceof Error && ['CONTEXT_CHANGED', 'APPROVAL_STALE', 'PROJECT_REMOVED'].includes(error.message)) {
        const latest = await meta({ kind: 'discovery', id: d.discoveryId });
        const run = latest?.currentRunId ? await meta({ kind: 'run', id: latest.currentRunId }) : null;
        const process = latest?.currentRunId ? await meta({ kind: 'process', id: latest.currentRunId }) : null;
        const absent = (!process || process.releaseState === 'RELEASED' && process.observation === 'ABSENT') && (!run || ['FINALIZED', 'EXIT_OBSERVED'].includes(run.phase));
        if (absent && latest?.stateRevision === d.stateRevision && ['RUNNING', 'UPDATING', 'WAITING_USER', 'READY_FOR_REVIEW', 'APPROVED'].includes(latest.state)) await commit({ kind: 'state', discoveryId: d.discoveryId, expectedRevision: d.stateRevision, next: 'STALE', exitVerified: true });
      }
      throw error;
    }
  }
  async function bundle(d: DiscoveryRecord, revisionId: string) {
    const revision = await meta({ kind: 'revision', id: revisionId });
    if (!revision || revision.discoveryId !== d.discoveryId || revision.revisionId !== d.latestDocumentRevisionId || !revision.provenanceValidated || revision.status !== 'READY_FOR_REVIEW') throw new Error('APPROVAL_STALE');
    const current = await scope(d), sealed = await readDiscoverySnapshot(options.artifacts, current.snapshot, d.storeId);
    if (revision.snapshotId !== d.snapshotId || revision.contextDigest !== current.snapshot.contextDigest) throw new Error('APPROVAL_STALE');
    const bytes = await readDiscoveryArtifact(options.artifacts, revision.artifactId, limits.documentBytes);
    const artifact = await meta({ kind: 'artifact', id: revision.artifactId });
    if (bytes.length !== revision.bytes || artifact?.sha256 !== revision.bundleDigest) throw new Error('ARTIFACT_CORRUPT');
    const checked = validateDiscoveryDocument(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), { sources: sealed.sources, answers: await history('answers', d.discoveryId) });
    return { ...current, ...checked, revision };
  }
  async function inspect(intent: DiscoveryIntent) {
    if (!['correct', 'approve'].includes(intent.action)) throw new Error('INVALID_REQUEST');
    const d = await meta({ kind: 'discovery', id: intent.targetId });
    if (!d || d.storeId !== intent.storeId || d.stateRevision !== intent.stateRevision || d.snapshotId !== intent.snapshotId || d.configRevision !== intent.configRevision || d.providerRevision !== intent.providerRevision
      || !(intent.action === 'correct' ? ['READY_FOR_REVIEW', 'APPROVED'] : ['READY_FOR_REVIEW']).includes(d.state)) throw new Error('APPROVAL_STALE');
    requireUuid(intent.payload.revisionId); const b = await bundle(d, intent.payload.revisionId as string);
    if (intent.contextDigest !== b.snapshot.contextDigest || intent.modelId !== b.configuration.modelId || intent.providerProfileDigest !== b.configuration.qualificationDigest) throw new Error('APPROVAL_STALE');
    const previousRun = d.currentRunId ? await meta({ kind: 'run', id: d.currentRunId }) : null, process = d.currentRunId ? await meta({ kind: 'process', id: d.currentRunId }) : null;
    if (!previousRun || previousRun.phase !== 'FINALIZED' || previousRun.outcome !== 'SUCCEEDED' || process && (process.observation !== 'ABSENT' || process.releaseState !== 'RELEASED')) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    if (intent.action === 'correct') { requireUuid(intent.payload.correctionId); validateDiscoveryText(intent.payload.correction as string, limits.answerBytes); if (!(intent.payload.correction as string).trim() || previousRun.turnIndex >= limits.turns) throw new Error('DISCOVERY_LIMIT'); }
    if (intent.action === 'approve') {
      if (Object.keys(intent.payload).length !== 3 || intent.payload.bundleDigest !== b.revision.bundleDigest || !Array.isArray(intent.payload.acceptedUnknownIds)) throw new Error('APPROVAL_REQUIRED');
      const required = [...b.unknownIds, ...(await history('questions', d.discoveryId)).filter(q => q.status === 'OPEN').map(q => q.questionId)];
      const accepted = intent.payload.acceptedUnknownIds;
      if (new Set(accepted).size !== accepted.length || accepted.some(id => typeof id !== 'string' || !required.includes(id)) || required.some(id => !accepted.includes(id))) throw new Error('APPROVAL_REQUIRED');
    }
    return { ...b, discovery: d, previousRun };
  }
  return { inspect, fresh, bundle, history, meta, commit,
    async approve(intent: DiscoveryIntent, requestId: string) {
      const c = await inspect(intent), current = await fresh(c.discovery);
      await inspect(intent);
      const required = [...c.unknownIds, ...(await history('questions', c.discovery.discoveryId)).filter(q => q.status === 'OPEN').map(q => q.questionId)];
      await commit({ kind: 'approval', expectedRevision: c.discovery.stateRevision, requiredUnknownIds: required,
        value: { approvalId: randomUUID(), requestId, storeId: c.discovery.storeId, projectId: c.discovery.projectId, discoveryId: c.discovery.discoveryId, revisionId: c.revision.revisionId, bundleDigest: c.revision.bundleDigest,
          configRevision: c.discovery.configRevision, contextDigest: c.revision.contextDigest, acceptedUnknownIds: intent.payload.acceptedUnknownIds as string[], ownerUid: intent.ownerUid, approvedAt: new Date().toISOString(), checkedAt: current.checkedAt } });
    },
    async eligibility(projectId: string): Promise<Omit<import('../../domain/discovery/approval.js').DiscoveryEligibility, 'checkId'>> {
      const base = { projectId, eligible: false, reason: 'APPROVAL_REQUIRED' as const, revisionId: null, approvalId: null, contextDigest: null, checkedAt: new Date().toISOString(), freshness: 'UNKNOWN' as const };
      const project = await options.storage.getProject(projectId); if (!project || project.project.removedAt !== null) return { ...base, reason: 'PROJECT_REMOVED' };
      const records: DiscoveryRecord[] = []; let offset = 0;
      for (;;) { const p = await meta({ kind: 'discoveries', id: projectId, offset, limit: 20 }); records.push(...p.items); if (records.length > limits.archiveDiscoveries) throw new Error('DISCOVERY_LIMIT'); if (p.nextOffset === null) break; offset = p.nextOffset; }
      const d = records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.discoveryId.localeCompare(a.discoveryId))[0];
      if (!d || d.state !== 'APPROVED' || !d.latestDocumentRevisionId) return { ...base, reason: d?.state === 'STALE' ? 'APPROVAL_STALE' : 'APPROVAL_REQUIRED', revisionId: d?.latestDocumentRevisionId ?? null };
      const approval = await meta({ kind: 'approval', id: d.latestDocumentRevisionId });
      if (!approval || approval.projectId !== projectId || approval.storeId !== d.storeId || approval.configRevision !== d.configRevision) return base;
      try {
        const current = await fresh(d), b = await bundle(d, d.latestDocumentRevisionId);
        if (approval.bundleDigest !== b.revision.bundleDigest || approval.contextDigest !== b.revision.contextDigest || approval.revisionId !== d.latestDocumentRevisionId) throw new Error('APPROVAL_STALE');
        return { ...base, eligible: true, reason: 'CURRENT_APPROVAL', revisionId: b.revision.revisionId, approvalId: approval.approvalId, contextDigest: b.revision.contextDigest, freshness: 'CURRENT', checkedAt: current.checkedAt };
      } catch (error) { return { ...base, reason: error instanceof Error && ['CONTEXT_CHANGED', 'APPROVAL_STALE', 'PROJECT_REMOVED'].includes(error.message) ? 'APPROVAL_STALE' : 'UNKNOWN', revisionId: d.latestDocumentRevisionId, approvalId: approval.approvalId }; }
    },
    async continuation(intent: DiscoveryIntent, requestId: string, grantId: string) {
      const c = await inspect(intent);
      const prepared = await prepareDiscoveryLaunch({ requestId, grantId, intent, snapshot: c.snapshot, configuration: c.configuration, contextRequest: c.request,
        continuation: { discovery: c.discovery, previousRun: c.previousRun, answers: await history('answers', c.discovery.discoveryId), questions: await history('questions', c.discovery.discoveryId) }, correction: { priorDraft: c.document, text: intent.payload.correction as string } }, options);
      return { ...prepared, configuration: c.configuration };
    },
    async publish(identity: AgentProcessIdentity, document: DiscoveryDocument) {
      const run = await meta({ kind: 'run', id: identity.runId }), process = await meta({ kind: 'process', id: identity.runId });
      const d = run ? await meta({ kind: 'discovery', id: run.discoveryId }) : null;
      if (!run || !d || run.generation !== identity.generation || run.phase !== 'EXIT_OBSERVED' || run.outcome !== 'SUCCEEDED' || d.currentRunId !== run.runId || !['RUNNING', 'UPDATING'].includes(d.state)) throw new Error('STALE_TARGET');
      if (process && (process.releaseState !== 'RELEASED' || process.observation !== 'ABSENT')) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      const c = await fresh(d); validateDiscoveryDocument(document, { sources: c.sealed.sources, answers: await history('answers', d.discoveryId) });
      const bytes = new TextEncoder().encode(JSON.stringify(document)), reserved = await options.artifacts.reserve('DOCUMENT', bytes.length); if (!reserved.ok) throw new Error(reserved.code);
      const published = await options.artifacts.publish(reserved.value.artifactId, bytes); if (!published.ok) throw new Error(published.code);
      await scope(d); const previous = d.latestDocumentRevisionId ? await meta({ kind: 'revision', id: d.latestDocumentRevisionId }) : null;
      await commit({ kind: 'revision', runId: run.runId, generation: run.generation, expectedRevision: d.stateRevision, value: { revisionId: randomUUID(), discoveryId: d.discoveryId, revisionNumber: String(BigInt(previous?.revisionNumber ?? '0') + 1n), parentRevisionId: previous?.revisionId ?? null,
        snapshotId: d.snapshotId, contextDigest: run.contextDigest, artifactId: published.value.artifactId, bundleDigest: published.value.sha256!, bytes: bytes.length, provenanceValidated: true, status: 'READY_FOR_REVIEW' } });
    },
  };
}
