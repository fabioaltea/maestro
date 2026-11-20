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
