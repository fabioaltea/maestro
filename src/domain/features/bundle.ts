import type { FeatureBundle, FeatureProvenanceScope } from '../../ports/feature.js';
export const FEATURE_LIMITS = Object.freeze({ requestBytes: 16 * 1024, bundleBytes: 256 * 1024, criteria: 50, questions: 20, turns: 20, revisions: 50, features: 1000, grantMs: 300_000, activeGrants: 32, chunkBytes: 8192 });
export function featureObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as null)) throw new Error('INVALID_REQUEST');
  return value as Record<string, unknown>;
}
export function featureFields(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): void {
  if (required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k))) throw new Error('INVALID_REQUEST');
}
export function featureText(value: unknown, maximum = 4096, nonempty = false): string {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') || new TextEncoder().encode(value).length > maximum || nonempty && !value.trim()) throw new Error('INVALID_REQUEST');
  return value;
}
export function featureIdentifier(value: unknown): string {
  const text = featureText(value, 64, true); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(text)) throw new Error('INVALID_REQUEST'); return text;
}
function array(value: unknown, maximum: number): unknown[] { if (!Array.isArray(value) || value.length > maximum) throw new Error('INVALID_REQUEST'); return value; }
function texts(value: unknown): void { for (const item of array(value, 50)) featureText(item, 4096, true); }
function unique(values: readonly string[]): void { if (new Set(values).size !== values.length) throw new Error('INVALID_REQUEST'); }
/** Schema validation is not semantic certification or an approval. */
export function validateFeatureBundle(value: unknown, scope?: FeatureProvenanceScope): FeatureBundle {
  const b = featureObject(value);
  featureFields(b, ['version','title','request','specification','implementationPlan','acceptanceCriteria','provenance','unknowns']);
  if (b.version !== 1) throw new Error('INVALID_REQUEST');
  const title = featureText(b.title, 480, true); if ([...title].length > 120 || /\p{Cc}/u.test(title)) throw new Error('INVALID_REQUEST');
  featureText(b.request, FEATURE_LIMITS.requestBytes, true);
  const spec = featureObject(b.specification); featureFields(spec, ['scope','users','stories','exclusions']); featureText(spec.scope, 16 * 1024); texts(spec.users); texts(spec.exclusions);
  const stories = array(spec.stories, 50).map(item => { const s = featureObject(item); featureFields(s, ['storyId','text']); featureText(s.text, 8192, true); return featureIdentifier(s.storyId); }); unique(stories);
  const plan = featureObject(b.implementationPlan); featureFields(plan, ['approach','dependencies','risks']); featureText(plan.approach, 32 * 1024); texts(plan.dependencies); texts(plan.risks);
  const criteria = array(b.acceptanceCriteria, FEATURE_LIMITS.criteria).map(item => {
    const c = featureObject(item); featureFields(c, ['criterionId','storyId','text','verification','required']);
    const id = featureIdentifier(c.criterionId); if (!stories.includes(featureIdentifier(c.storyId)) || typeof c.required !== 'boolean') throw new Error('INVALID_REQUEST');
    featureText(c.text, 4096, true); featureText(c.verification, 4096, true); return id;
  }); unique(criteria);
  for (const item of array(b.provenance, 200)) {
    const p = featureObject(item); featureFields(p, ['kind','text','sourceId','answerId']); featureText(p.text, 4096, true);
    if (!['CODE','USER_CONFIRMED','HYPOTHESIS','UNKNOWN'].includes(String(p.kind))) throw new Error('INVALID_REQUEST');
    if (p.sourceId !== null) featureText(p.sourceId, 128, true); if (p.answerId !== null) featureIdentifier(p.answerId);
    if (p.kind === 'CODE' && (p.sourceId === null || p.answerId !== null || scope && !scope.sourceIds.includes(String(p.sourceId)))) throw new Error('INVALID_REQUEST');
    if (p.kind === 'USER_CONFIRMED' && (p.answerId === null || p.sourceId !== null || scope && !scope.answerIds.includes(String(p.answerId)))) throw new Error('INVALID_REQUEST');
    if (['HYPOTHESIS','UNKNOWN'].includes(String(p.kind)) && (p.sourceId !== null || p.answerId !== null)) throw new Error('INVALID_REQUEST');
  }
  const unknowns = array(b.unknowns, 200).map(item => { const u = featureObject(item); featureFields(u, ['unknownId','text','impact','decision']);
    featureText(u.text, 4096, true); if (!['BLOCKING','NON_BLOCKING'].includes(String(u.impact)) || !['OPEN','ACCEPTED'].includes(String(u.decision))) throw new Error('INVALID_REQUEST'); return featureIdentifier(u.unknownId); }); unique(unknowns);
  const encoded = JSON.stringify(b); if (new TextEncoder().encode(encoded).length > FEATURE_LIMITS.bundleBytes) throw new Error('CONTEXT_LIMIT');
  // Detach from the caller: changing its object after validation cannot change a seal.
  return JSON.parse(encoded) as FeatureBundle;
}
export function requireApprovableBundle(bundle: FeatureBundle, acceptedUnknownIds: readonly string[]): void {
  validateFeatureBundle(bundle);
  if (!bundle.specification.scope.trim() || !bundle.implementationPlan.approach.trim() || !bundle.specification.users.length || !bundle.specification.stories.length || !bundle.acceptanceCriteria.length
    || bundle.specification.stories.some(s => !bundle.acceptanceCriteria.some(c => c.storyId === s.storyId))) throw new Error('APPROVAL_REQUIRED');
  const accepted = bundle.unknowns.filter(u => u.impact === 'NON_BLOCKING').map(u => u.unknownId).sort();
  if (bundle.unknowns.some(u => u.impact === 'BLOCKING') || new Set(acceptedUnknownIds).size !== acceptedUnknownIds.length
    || JSON.stringify([...acceptedUnknownIds].sort()) !== JSON.stringify(accepted)) throw new Error('APPROVAL_REQUIRED');
}
