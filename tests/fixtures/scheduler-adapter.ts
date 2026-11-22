import type {SchedulerReservation,SchedulerResource} from '../../src/ports/scheduler.js';
import {admissionBlock,DEFAULT_SCHEDULER_LIMITS,reserveSchedulerResource} from '../../src/domain/scheduler/resource-admission.js';

export function schedulerAdmissionFixture(){
 const reservations:SchedulerReservation[]=[];
 return{reserve(resource:SchedulerResource){
   const blocked=admissionBlock(DEFAULT_SCHEDULER_LIMITS,reservations,resource);
   if(blocked)return{blocked};
   const reservation=reserveSchedulerResource(resource);reservations.push(reservation);return{reservation};
 }};
}
