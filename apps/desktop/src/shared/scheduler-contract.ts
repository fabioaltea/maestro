import type {Params} from './bridge-contract.ts';
import {keys,record,revision,text,uuid} from './input.ts';

export const SCHEDULER_BRIDGE_METHODS=['listScheduledJobs'] as const;
const states=['QUEUED','RESERVED','RUNNING','WAITING_RESOURCE','WAITING_PROVIDER','WAITING_USER','PAUSED',
 'CANCELLING','CANCELLED','SUCCEEDED','FAILED','RECONCILING'];
const classes=['DISCOVERY','EXECUTION','INSTALL','VALIDATE'];

export function validateSchedulerBridge(p:Params){
 keys(p,['bridgeVersion','callId','selectionEpoch','projectId','cursor']);
 if(p.projectId!==undefined)uuid(p.projectId);
 if(p.cursor!==undefined)text(p.cursor,1024);
}
export function validateSchedulerQueue(value:unknown,project:unknown){
 const p=record(value);
 if(new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('CLIENT_PROTOCOL_ERROR');
 keys(p,['policy','jobs','reservations','nextCursor','dispatchAvailable','systemLoad','storeId','freshness','observabilityDegraded']);
 if(!Object.keys(p).length)return p;
 if(p.storeId!==undefined)uuid(p.storeId);
 if(!['CURRENT','LAST_KNOWN'].includes(String(p.freshness))||typeof p.dispatchAvailable!=='boolean'||
    p.freshness==='LAST_KNOWN'&&p.dispatchAvailable||p.systemLoad!=='UNKNOWN')throw new Error('CLIENT_PROTOCOL_ERROR');
 if(p.nextCursor!==null)text(p.nextCursor,1024);
 const policy=record(p.policy);keys(policy,['revision','limits']);revision(policy.revision);
 const limits=record(policy.limits);keys(limits,['global','install','validate']);
 for(const [name,max] of [['global',4],['install',2],['validate',2]] as const)
   if(!Number.isInteger(limits[name])||Number(limits[name])<1||Number(limits[name])>max)throw new Error('CLIENT_PROTOCOL_ERROR');
 if(!Array.isArray(p.jobs)||p.jobs.length>20||!Array.isArray(p.reservations)||p.reservations.length>4)throw new Error('CLIENT_PROTOCOL_ERROR');
 function scope(value:Params){
   uuid(value.jobId);uuid(value.projectId);
   if(value.workspaceId!==null)uuid(value.workspaceId);
   if(project!==undefined&&project!==value.projectId||!classes.includes(String(value.type)))throw new Error('CLIENT_PROTOCOL_ERROR');
 }
 for(const item of p.jobs){
   const job=record(item);
   keys(job,['jobId','projectId','workspaceId','sessionId','type','priority','queuedAt','notBefore','state','stateRevision','reason','attempts']);
   scope(job);if(job.sessionId!==null)uuid(job.sessionId);
   revision(job.stateRevision);text(job.queuedAt,30);
   if(job.notBefore!==null)text(job.notBefore,30);
   if(job.reason!==null&&!/^[A-Z][A-Z0-9_]{0,47}$/.test(text(job.reason,48)))throw new Error('CLIENT_PROTOCOL_ERROR');
   if(!states.includes(String(job.state))||!Number.isInteger(job.priority)||Number(job.priority)<0||Number(job.priority)>2||
      !Number.isInteger(job.attempts)||Number(job.attempts)<0||Number(job.attempts)>3)throw new Error('CLIENT_PROTOCOL_ERROR');
 }
 for(const item of p.reservations){
   const reservation=record(item);keys(reservation,['jobId','projectId','workspaceId','type','state','goAuthorized']);scope(reservation);
   if(!['RESERVED','RUNNING','RECONCILING'].includes(String(reservation.state))||typeof reservation.goAuthorized!=='boolean')throw new Error('CLIENT_PROTOCOL_ERROR');
 }
 return p;
}
