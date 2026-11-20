export type SchedulerClass='DISCOVERY'|'EXECUTION'|'INSTALL'|'VALIDATE';
export interface SchedulerLimits {readonly global:number;readonly install:number;readonly validate:number}
export interface SchedulerResource {
 readonly jobId:string;
 readonly generation:string;
 readonly projectId:string;
 readonly type:SchedulerClass;
 readonly workspaceId:string|null;
}
export interface SchedulerReservation extends SchedulerResource {
 readonly state:'RESERVED'|'RUNNING'|'RECONCILING'|'RELEASED';
 readonly goAuthorized:boolean;
}
export interface SchedulerReleaseProof {
 readonly jobId:string;
 readonly generation:string;
 readonly kind:'EXIT'|'NO_SPAWN';
 readonly verified:true;
}
export type SchedulerReservationEvent=
 |{readonly kind:'go';readonly generation:string}
 |{readonly kind:'owner-lost'}
 |{readonly kind:'release';readonly proof:SchedulerReleaseProof};

import type {WorkflowAdmission,WorkflowOperationRecord} from './workflow.js';
export const SCHEDULER_GRANTED=['enqueue','policy.configure','pause','cancel','schedule','provider-policy.configure','policy.revoke','switch'] as const;
export const schedulerJobStates=['QUEUED','RESERVED','RUNNING','WAITING_RESOURCE','WAITING_PROVIDER','WAITING_USER','PAUSED','CANCELLING',
 'CANCELLED','SUCCEEDED','FAILED','RECONCILING'] as const;
export type SchedulerJobState=typeof schedulerJobStates[number];
export interface SchedulerJob {
 readonly jobId:string;readonly intentId:string;readonly projectId:string;readonly workspaceId:string|null;readonly sessionId:string|null;
 readonly type:SchedulerClass;readonly priority:number;readonly queuedAt:string;readonly notBefore:string|null;
 readonly state:SchedulerJobState;readonly stateRevision:string;readonly reason:string|null;readonly attempts:number;
}
export interface SchedulerPolicy {readonly revision:string;readonly limits:SchedulerLimits}
export type SchedulerQuery=
 |{readonly kind:'policy'|'reservations'}
 |{readonly kind:'job';readonly id:string}
 |{readonly kind:'queue';readonly projectId:string|null;readonly offset?:number;readonly limit?:number};
export interface SchedulerRead {
 readonly policy?:SchedulerPolicy;readonly jobs?:readonly SchedulerJob[];readonly job?:SchedulerJob|null;
 readonly reservations?:readonly SchedulerReservation[];readonly revision?:string;readonly nextOffset?:number|null;
}
export type SchedulerChange=
 |{readonly kind:'enqueue';readonly admission:WorkflowAdmission}
 |{readonly kind:'policy.configure';readonly admission:WorkflowAdmission}
 |{readonly kind:'pause'|'cancel';readonly admission:WorkflowAdmission}
 |{readonly kind:'reserve';readonly instanceId:string;readonly resource:SchedulerResource;readonly expectedRevision:string;readonly at:string}
 |{readonly kind:'reservation';readonly instanceId:string;readonly generation:string;readonly jobId:string;readonly event:SchedulerReservationEvent;
   readonly success?:boolean}
 |{readonly kind:'recover';readonly instanceId:string};
export interface SchedulerWrite {
 readonly operation?:WorkflowOperationRecord;readonly inserted?:boolean;readonly reservation?:SchedulerReservation;readonly job?:SchedulerJob;
}
export interface SchedulerStoragePort {
 readSchedulerState?(query:SchedulerQuery):Promise<SchedulerRead>;
 commitSchedulerState?(change:SchedulerChange):Promise<SchedulerWrite>;
}
