import {featureFields,featureIdentifier,featureObject,featureText,validateFeatureBundle} from './bundle.js';
import type {FeatureRecord} from './model.js';
import type {FeaturePlanningConfiguration,FeaturePlanningIdentity,FeaturePlanningExit,FeaturePlanningResult,FeatureProvenanceScope} from '../../ports/feature.js';
import {requireDecimal} from '../identifiers.js';

export const FEATURE_PLANNING_LIMITS = Object.freeze({turns:20,questions:20,answerBytes:4096,resultBytes:262144,runMs:600000,contextMs:30000,cancelMs:5000});
export const FEATURE_PLANNING_ACTIONS = ['generate','answer','cancel'] as const;
export type PlanningPhase = 'ACCEPTED'|'RUNNING'|'WAITING_USER'|'SUCCEEDED'|'FAILED'|'INTERRUPTED'|'RECONCILING'|'CANCELLED';

export interface PlanningAnswerRef {
  readonly turnId:string;
  readonly questionId:string;
  readonly artifactId:string;
}

export interface PlanningTurn extends FeaturePlanningIdentity {
  readonly turnId:string;
  readonly featureId:string;
  readonly requestId:string;
  readonly stateRevision:string;
  readonly revisionId:string;
  readonly contextSnapshotId:string;
  readonly inputDigest:string;
  readonly configuration?:FeaturePlanningConfiguration;
  readonly turnIndex:number;
  readonly phase:PlanningPhase;
  readonly questionIds:readonly string[];
  readonly answer:PlanningAnswerRef|null;
  readonly resultArtifactId:string|null;
  readonly cancelRequestId:string|null;
  readonly createdAt:string;
  readonly completedAt:string|null;
  readonly error:string|null;
}

export function planningConfiguration(input:unknown):FeaturePlanningConfiguration {
  const configuration=featureObject(input);
  featureFields(configuration,['providerId','modelId','configurationRevision','qualificationDigest']);
  const providerId=featureText(configuration.providerId,64,true),modelId=featureText(configuration.modelId,128,true);
  const qualificationDigest=featureText(configuration.qualificationDigest,64,true);
  const configurationRevision=requireDecimal(configuration.configurationRevision);
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(providerId)||!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(modelId)
    ||!(/^[a-f0-9]{64}$/).test(qualificationDigest)||configurationRevision==='0')throw new Error('PROVIDER_UNSAFE');
  return{providerId,modelId,configurationRevision,qualificationDigest};
}

export function requirePlanningFence(
  feature:Pick<FeatureRecord,'featureId'|'currentRevisionId'|'stateRevision'|'state'>,
  turn:Pick<PlanningTurn,'runId'|'generation'|'owningInstanceId'|'featureId'|'revisionId'|'stateRevision'|'phase'>,
  identity:FeaturePlanningIdentity,
):void {
  if (turn.runId!==identity.runId||turn.generation!==identity.generation||turn.owningInstanceId!==identity.owningInstanceId
    ||feature.featureId!==turn.featureId||feature.currentRevisionId!==turn.revisionId||feature.stateRevision!==turn.stateRevision
    ||feature.state!=='PLANNING'||turn.phase!=='RUNNING') throw new Error('STALE_TARGET');
}

export function requirePlanningExit(identity:FeaturePlanningIdentity,proof:FeaturePlanningExit|null):asserts proof is FeaturePlanningExit {
  if (!proof||proof.runId!==identity.runId||proof.generation!==identity.generation||proof.owningInstanceId!==identity.owningInstanceId
    ||proof.hostExited!==true||proof.providerExited!==true) throw new Error('RESOURCE_IDENTITY_UNKNOWN');
}

export function validatePlanningResult(input:unknown,scope:FeatureProvenanceScope):FeaturePlanningResult {
  try {
    const value=featureObject(input);
    if(value.kind==='DRAFT'){
      featureFields(value,['kind','bundle']);
      return{kind:'DRAFT',bundle:validateFeatureBundle(value.bundle,scope)};
    }
    featureFields(value,['kind','questions']);
    if(value.kind!=='QUESTIONS'||!Array.isArray(value.questions)||!value.questions.length||value.questions.length>FEATURE_PLANNING_LIMITS.questions)throw new Error();
    const questions=value.questions.map(raw=>{
      const q=featureObject(raw);
      featureFields(q,['questionId','text','reason']);
      return{questionId:featureIdentifier(q.questionId),text:featureText(q.text,4096,true),reason:featureText(q.reason,4096,true)};
    });
    if(new Set(questions.map(q=>q.questionId)).size!==questions.length
      ||new TextEncoder().encode(JSON.stringify(questions)).length>FEATURE_PLANNING_LIMITS.resultBytes)throw new Error();
    return{kind:'QUESTIONS',questions};
  }catch{throw new Error('PROVIDER_PROTOCOL_ERROR');}
}
