import {validatePlanningResult} from '../../domain/features/planning.js';
import type {FeaturePlanningResult,FeatureProvenanceScope} from '../../ports/feature.js';

/** Data decoder availability never certifies the provider's runtime/authentication. */
export {UNAVAILABLE_FEATURE_PLANNING_CAPABILITIES as FEATURE_PLANNING_CAPABILITIES} from '../../ports/feature.js';
export function parseFeaturePlanningResult(value:unknown,scope:FeatureProvenanceScope={sourceIds:[],answerIds:[]}):FeaturePlanningResult {
  return validatePlanningResult(value,scope);
}
