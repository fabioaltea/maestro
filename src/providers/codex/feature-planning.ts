import type {FeaturePlanningResult,FeatureProvenanceScope} from '../../ports/feature.js';
import {FEATURE_PLANNING_LIMITS} from '../../domain/features/planning.js';
import {parseFeaturePlanningResult} from './feature-planning-parser.js';

/** Decodes a single bounded result from the qualified readonly invocation. */
export function decodeCodexPlanningResult(bytes:Uint8Array,scope:FeatureProvenanceScope):FeaturePlanningResult{
 if(bytes.length===0||bytes.length>FEATURE_PLANNING_LIMITS.resultBytes)throw new Error('PROVIDER_OUTPUT_LIMIT');
 try{
   const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
   return parseFeaturePlanningResult(raw,scope);
 }catch{throw new Error('PROVIDER_PROTOCOL_ERROR');}
}
