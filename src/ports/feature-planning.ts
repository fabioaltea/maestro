import type {Deadline} from './clock.js';
import type {FeatureBundle,FeaturePlanningAnswer,FeaturePlanningExit,FeaturePlanningIdentity,FeatureProvenanceScope,PlanningQuestion} from './feature.js';

/** A qualified readonly host owns process identity, authenticated exit observation and containment. */
export interface FeaturePlanningPort {
  readonly capabilities:{readonly readonlyPlanning:boolean;readonly qualified:boolean};
  check(deadline:Deadline):Promise<void>;
  run(input:{
    readonly identity:FeaturePlanningIdentity;
    readonly contextSnapshotId:string;
    readonly bundle:FeatureBundle;
    readonly provenance:FeatureProvenanceScope;
    readonly priorQuestions:readonly PlanningQuestion[];
    readonly answers:readonly FeaturePlanningAnswer[];
    readonly signal:AbortSignal;
    readonly deadline:Deadline;
  }):Promise<{readonly exit:FeaturePlanningExit;readonly value:unknown}>;
  cancel(identity:FeaturePlanningIdentity,deadline:Deadline):Promise<FeaturePlanningExit|null>;
  reconcile(identity:FeaturePlanningIdentity,deadline:Deadline):Promise<FeaturePlanningExit|null>;
}
