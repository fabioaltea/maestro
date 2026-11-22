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

export interface FeaturePlanningIdentity {
 readonly runId:string;readonly generation:string;readonly owningInstanceId:string;
}
/** The trusted host port emits this only after authenticating and observing both exits. */
export interface FeaturePlanningExit extends FeaturePlanningIdentity {
 readonly hostExited:true;readonly providerExited:true;
}
export interface FeaturePlanningAnswer {
 readonly answerId:string;readonly questionId:string;readonly text:string;
}
export interface FeaturePlanningConfiguration {
 readonly providerId:string;readonly modelId:string;readonly configurationRevision:string;readonly qualificationDigest:string;
}

export const UNAVAILABLE_FEATURE_PLANNING_CAPABILITIES = Object.freeze({ readonlyPlanning: false, qualified: false });

/** Produced only by an authoritative core revalidation, never accepted from a public DTO. */
export interface FeatureContextProof {
 readonly projectId:string;readonly configRevision:string;readonly discoveryApprovalId:string;readonly discoveryRevisionId:string;
 readonly contextDigest:string;readonly checkedAt:string;
}
