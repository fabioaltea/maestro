import { randomUUID } from 'node:crypto';
import type { StoragePort } from '../../ports/storage.js';
import type { ArchivePaths } from '../../ports/platform.js';
import type { DiscoveryArtifactPort, DiscoveryMetadataQuery, DiscoveryMetadataData } from '../../ports/discovery.js';
import type { DiscoveryContextPort } from '../../ports/discovery-context.js';
import type { ProviderPort } from '../../ports/provider.js';
import type { DiscoveryIntent } from '../../domain/discovery/intent.js';
import { validateDiscoveryText } from '../../domain/discovery/intent.js';
import { DISCOVERY_LIMITS as limits } from '../../domain/discovery/model.js';
import type { DiscoveryAnswer, DiscoveryQuestion } from '../../domain/discovery/model.js';
import type { DiscoveryQuestions } from '../../domain/discovery/documents.js';
import type { AgentProcessIdentity } from '../../ports/agent-runtime.js';
import { requireUuid } from '../../domain/identifiers.js';
import { prepareDiscoveryLaunch } from './launch.js';

interface Options { storage: Pick<StoragePort, 'readDiscoveryMetadata' | 'commitDiscoveryMetadata' | 'getProject'>; paths: ArchivePaths;
  context: DiscoveryContextPort; artifacts: DiscoveryArtifactPort; provider: ProviderPort }
export function createDiscoveryInterview(options: Options) {
  async function meta<Q extends DiscoveryMetadataQuery>(q: Q): Promise<DiscoveryMetadataData<Q>> {
    const r = await options.storage.readDiscoveryMetadata!(q); if (!r.ok) throw new Error(r.code); return r.value.data;
  }
  async function history<K extends 'questions' | 'answers'>(kind: K, id: string) {
    const all: (DiscoveryAnswer | DiscoveryQuestion)[] = []; let offset = 0;
    for (;;) { const page = await meta({ kind, id, offset, limit: 20 }); if (!page) throw new Error('ARTIFACT_CORRUPT'); all.push(...page.items); if (all.length > limits.questions) throw new Error('DISCOVERY_LIMIT'); if (page.nextOffset === null) break; if (page.nextOffset <= offset) throw new Error('ARTIFACT_CORRUPT'); offset = page.nextOffset; }
    return all as K extends 'questions' ? DiscoveryQuestion[] : DiscoveryAnswer[];
  }
  async function inspect(intent: DiscoveryIntent, accepted = false) {
    const p = intent.payload;
    if (intent.action !== 'answer' || Object.keys(p).length !== 6 || !['ANSWER', 'UNKNOWN'].includes(String(p.kind))) throw new Error('INVALID_REQUEST');
    requireUuid(p.questionId); requireUuid(p.answerId); validateDiscoveryText(p.text as string, limits.answerBytes);
    if (p.kind === 'ANSWER' && !(p.text as string).trim()) throw new Error('INVALID_REQUEST');
    const question = await meta({ kind: 'question', id: p.questionId as string });
    const d = question ? await meta({ kind: 'discovery', id: question.discoveryId }) : null;
    if (!question || !d || d.storeId !== intent.storeId || intent.targetId !== question.questionId || d.state !== 'WAITING_USER' || d.stateRevision !== intent.stateRevision
      || question.revision !== p.questionRevision || d.snapshotId !== intent.snapshotId || d.configRevision !== intent.configRevision || d.providerRevision !== intent.providerRevision || !d.currentRunId) throw new Error('APPROVAL_STALE');
    const run = await meta({ kind: 'run', id: d.currentRunId }), process = await meta({ kind: 'process', id: d.currentRunId });
    if (!run || run.phase !== 'FINALIZED' || run.outcome !== 'SUCCEEDED' || process && (process.releaseState !== 'RELEASED' || process.observation !== 'ABSENT')) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
    if (run.turnIndex >= limits.turns) throw new Error('DISCOVERY_LIMIT');
    const answers = await history('answers', d.discoveryId), previous = answers.filter(a => a.questionId === question.questionId).at(-1);
    if (accepted ? !previous || previous.answerId !== p.answerId || previous.revision !== p.answerRevision || previous.text !== p.text || previous.kind !== p.kind
      : p.answerRevision !== String(BigInt(previous?.revision ?? '0') + 1n)) throw new Error('ANSWER_CONFLICT');
    if (!accepted && answers.length >= limits.turns) throw new Error('DISCOVERY_LIMIT');
    const snapshot = await meta({ kind: 'snapshot', id: d.snapshotId }), configuration = await meta({ kind: 'provider' }), project = await options.storage.getProject(d.projectId);
    if (!project || project.project.removedAt !== null) throw new Error('PROJECT_REMOVED');
    if (project.project.configRevision !== d.configRevision || !snapshot || snapshot.state !== 'SEALED' || snapshot.projectId !== d.projectId || snapshot.contextDigest !== intent.contextDigest) throw new Error('CONTEXT_CHANGED');
    if (!configuration || configuration.revision !== intent.providerRevision || configuration.modelId !== intent.modelId || configuration.qualificationDigest !== intent.providerProfileDigest) throw new Error('APPROVAL_STALE');
    const request = { storeId: d.storeId, projectId: d.projectId, configRevision: d.configRevision, selectors: snapshot.selectors, checkoutPath: project.project.referenceCheckout.root.canonicalPath,
      excludedRoots: [options.paths.directory, options.paths.runtimeDirectory, configuration.authProfileRef] };
    return { discovery: d, previousRun: run, question, answers, snapshot, configuration, request, questions: await history('questions', d.discoveryId) };
  }
  return { inspect,
    async continuation(intent: DiscoveryIntent, requestId: string, grantId: string) {
      const current = await inspect(intent, true);
      const prepared = await prepareDiscoveryLaunch({ requestId, grantId, intent, snapshot: current.snapshot, configuration: current.configuration, contextRequest: current.request,
        continuation: { discovery: current.discovery, previousRun: current.previousRun, answers: current.answers, questions: current.questions } }, options);
      return { ...prepared, configuration: current.configuration };
    },
    async publish(identity: AgentProcessIdentity, result: DiscoveryQuestions) {
      if (Object.keys(result).sort().join(',') !== 'kind,questions' || result.kind !== 'QUESTIONS' || !Array.isArray(result.questions) || !result.questions.length || result.questions.length > limits.questions) throw new Error('PROVIDER_PROTOCOL_ERROR');
      const run = await meta({ kind: 'run', id: identity.runId }), process = await meta({ kind: 'process', id: identity.runId });
      const d = run ? await meta({ kind: 'discovery', id: run.discoveryId }) : null;
      if (!run || !d || run.generation !== identity.generation || run.phase !== 'EXIT_OBSERVED' || run.outcome !== 'SUCCEEDED' || d.currentRunId !== run.runId) throw new Error('STALE_TARGET');
      if (process && (process.releaseState !== 'RELEASED' || process.observation !== 'ABSENT')) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
      if ((await history('questions', d.discoveryId)).length + result.questions.length > limits.questions) throw new Error('DISCOVERY_LIMIT');
      const values: DiscoveryQuestion[] = result.questions.map(q => {
        if (Object.keys(q).sort().join(',') !== 'reason,section,text') throw new Error('PROVIDER_PROTOCOL_ERROR');
        validateDiscoveryText(q.text, limits.questionBytes); validateDiscoveryText(q.reason, limits.questionBytes); validateDiscoveryText(q.section, 256);
        if (!q.text.trim()) throw new Error('PROVIDER_PROTOCOL_ERROR');
        return { ...q, questionId: randomUUID(), discoveryId: d.discoveryId, runId: run.runId, revision: '1', status: 'OPEN' };
      });
      const saved = await options.storage.commitDiscoveryMetadata!({ kind: 'questions', discoveryId: d.discoveryId, runId: run.runId, generation: run.generation, expectedRevision: d.stateRevision, values });
      if (!saved.ok) throw new Error(saved.code);
    },
  };
}
