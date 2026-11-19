/** Provider-neutral feature document. These are data, never grants or commands. */
export interface FeatureBundle {
  readonly version: 1; readonly title: string; readonly request: string;
  readonly specification: { readonly scope: string; readonly users: readonly string[]; readonly stories: readonly { readonly storyId: string; readonly text: string }[]; readonly exclusions: readonly string[] };
  readonly implementationPlan: { readonly approach: string; readonly dependencies: readonly string[]; readonly risks: readonly string[] };
  readonly acceptanceCriteria: readonly { readonly criterionId: string; readonly storyId: string; readonly text: string; readonly verification: string; readonly required: boolean }[];
  readonly provenance: readonly { readonly kind: 'CODE' | 'USER_CONFIRMED' | 'HYPOTHESIS' | 'UNKNOWN'; readonly text: string; readonly sourceId: string | null; readonly answerId: string | null }[];
  readonly unknowns: readonly { readonly unknownId: string; readonly text: string; readonly impact: 'BLOCKING' | 'NON_BLOCKING'; readonly decision: 'OPEN' | 'ACCEPTED' }[];
}
export interface PlanningQuestion { readonly questionId: string; readonly text: string; readonly reason: string }
export type FeaturePlanningResult = { readonly kind: 'DRAFT'; readonly bundle: FeatureBundle }
  | { readonly kind: 'QUESTIONS'; readonly questions: readonly PlanningQuestion[] };
export interface FeatureProvenanceScope { readonly sourceIds: readonly string[]; readonly answerIds: readonly string[] }
