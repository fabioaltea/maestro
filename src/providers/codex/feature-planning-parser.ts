import { featureFields, featureIdentifier, featureObject, featureText, validateFeatureBundle } from '../../domain/features/bundle.js';
import type { FeaturePlanningResult, FeatureProvenanceScope, PlanningQuestion } from '../../ports/feature.js';
/** Data decoder availability never certifies the provider's runtime/authentication. */
export const FEATURE_PLANNING_CAPABILITIES = Object.freeze({ readonlyPlanning: false, qualified: false });
export function parseFeaturePlanningResult(value: unknown, scope: FeatureProvenanceScope = { sourceIds: [], answerIds: [] }): FeaturePlanningResult {
  const p = featureObject(value);
  if (p.kind === 'DRAFT') { featureFields(p, ['kind','bundle']); return { kind: 'DRAFT', bundle: validateFeatureBundle(p.bundle, scope) }; }
  featureFields(p, ['kind','questions']);
  if (p.kind !== 'QUESTIONS' || !Array.isArray(p.questions) || !p.questions.length || p.questions.length > 20) throw new Error('PROVIDER_PROTOCOL_ERROR');
  const questions: PlanningQuestion[] = p.questions.map(raw => { const q = featureObject(raw); featureFields(q, ['questionId','text','reason']);
    return { questionId: featureIdentifier(q.questionId), text: featureText(q.text, 4096, true), reason: featureText(q.reason, 4096, true) }; });
  if (new Set(questions.map(q => q.questionId)).size !== questions.length || new TextEncoder().encode(JSON.stringify(questions)).length > 256 * 1024) throw new Error('PROVIDER_PROTOCOL_ERROR');
  return { kind: 'QUESTIONS', questions };
}
