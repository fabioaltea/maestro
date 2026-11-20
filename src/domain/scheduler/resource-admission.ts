import {requireUuid} from '../identifiers.js';
import type {SchedulerLimits,SchedulerReservation,SchedulerReservationEvent,SchedulerResource} from '../../ports/scheduler.js';

export const DEFAULT_SCHEDULER_LIMITS:SchedulerLimits=Object.freeze({global:4,install:2,validate:2});
export const SCHEDULER_CLASSES=['DISCOVERY','EXECUTION','INSTALL','VALIDATE'] as const;
export const SCHEDULER_PENDING_LIMIT=128;
export function validateSchedulerLimits(limits:SchedulerLimits):SchedulerLimits{
 for(const [value,maximum] of [[limits.global,4],[limits.install,2],[limits.validate,2]] as const){
   if(!Number.isSafeInteger(value)||value<1||value>maximum)throw new Error('INVALID_REQUEST');
 }
 return limits;
}
export function reserveSchedulerResource(resource:SchedulerResource):SchedulerReservation{
 requireUuid(resource.jobId);requireUuid(resource.generation);requireUuid(resource.projectId);
 if(!SCHEDULER_CLASSES.includes(resource.type))throw new Error('INVALID_REQUEST');
 if(resource.workspaceId!==null)requireUuid(resource.workspaceId);
 if(resource.type!=='DISCOVERY'&&resource.workspaceId===null)throw new Error('INVALID_REQUEST');
 return{...resource,state:'RESERVED',goAuthorized:false};
}
export type SchedulerAdmissionBlock='GLOBAL_LIMIT'|'INSTALL_LIMIT'|'VALIDATION_LIMIT'|'DISCOVERY_LIMIT'|'WORKSPACE_IN_USE'|'RESERVATION_UNKNOWN';
export function admissionBlock(limits:SchedulerLimits,reservations:readonly SchedulerReservation[],wanted:SchedulerResource):SchedulerAdmissionBlock|null{
 const active=reservations.filter(reservation=>reservation.state!=='RELEASED');
 if(active.some(r=>r.jobId===wanted.jobId||r.generation===wanted.generation))return 'RESERVATION_UNKNOWN';
 if(wanted.workspaceId!==null&&active.some(r=>r.workspaceId===wanted.workspaceId))return 'WORKSPACE_IN_USE';
 const sameClass=active.filter(r=>r.type===wanted.type).length;
 if(wanted.type==='DISCOVERY'&&sameClass>=1)return 'DISCOVERY_LIMIT';
 if(wanted.type==='INSTALL'&&sameClass>=limits.install)return 'INSTALL_LIMIT';
 if(wanted.type==='VALIDATE'&&sameClass>=limits.validate)return 'VALIDATION_LIMIT';
 return active.length>=limits.global?'GLOBAL_LIMIT':null;
}
export function schedulerReservationTransition(r:SchedulerReservation,event:SchedulerReservationEvent):SchedulerReservation{
 if(r.state==='RELEASED')throw new Error('INVALID_TRANSITION');
 if(event.kind==='owner-lost')return{...r,state:'RECONCILING'};
 if(event.kind==='go'){
   if(r.generation!==requireUuid(event.generation))throw new Error('STALE_TARGET');
   if(r.state!=='RESERVED')throw new Error('INVALID_TRANSITION');
   return{...r,state:'RUNNING',goAuthorized:true};
 }
 const {proof}=event;
 if(r.jobId!==requireUuid(proof.jobId)||r.generation!==requireUuid(proof.generation))throw new Error('STALE_TARGET');
 if(proof.verified!==true||!['EXIT','NO_SPAWN'].includes(proof.kind)||proof.kind==='NO_SPAWN'&&r.goAuthorized)
   throw new Error('RESERVATION_UNKNOWN');
 return{...r,state:'RELEASED'};
}
