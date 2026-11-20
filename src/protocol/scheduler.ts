import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {schedulerDate,schedulerPriority} from '../domain/scheduler/queue.js';
import {validateSchedulerLimits} from '../domain/scheduler/resource-admission.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import {SCHEDULER_GRANTED,type SchedulerLimits} from '../ports/scheduler.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
import {requireFeatureEnvelope} from './feature.js';
import {workspaceRevision,workspaceUuid} from './workspace.js';

export const requireSchedulerEnvelope=requireFeatureEnvelope;
export const SCHEDULER_READ_METHODS=['scheduler.queue.list','scheduler.get','scheduler.operation.get'] as const;
export const SCHEDULER_MUTATIONS=SCHEDULER_GRANTED.map(action=>`scheduler.${action}`);
export const SCHEDULER_METHODS=[...SCHEDULER_READ_METHODS,...SCHEDULER_MUTATIONS,'scheduler.prepare','scheduler.wait.get','scheduler.switch.preview'];
export const schedulerMutation=(method:string)=>SCHEDULER_MUTATIONS.includes(method);
export function schedulerLimits(value:unknown){
 const limits=featureObject(value);featureFields(limits,['global','install','validate']);
 return validateSchedulerLimits(limits as unknown as SchedulerLimits);
}
export function validateSchedulerParams(method:string,value:unknown){
 const p=featureObject(value);requireSchedulerEnvelope(p);
 if(schedulerMutation(method)){
   featureFields(p,['requestId','grantId']);workspaceUuid(p.requestId);workspaceUuid(p.grantId);return;
 }
 switch(method){
   case 'scheduler.queue.list':
     featureFields(p,[],['projectId','cursor','limit']);
     if(p.projectId!==undefined)workspaceUuid(p.projectId);
     if(p.cursor!==undefined)featureText(p.cursor,1024,true);
     if(p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20))throw new Error('INVALID_REQUEST');
     break;
   case 'scheduler.operation.get':
     featureFields(p,['requestId']);workspaceUuid(p.requestId);break;
   case 'scheduler.get':
     featureFields(p,['jobId']);workspaceUuid(p.jobId);break;
   case 'scheduler.wait.get':
     featureFields(p,['sessionId']);workspaceUuid(p.sessionId);break;
   case 'scheduler.switch.preview':
     featureFields(p,['sessionId','checkpointId','targetProviderId']);workspaceUuid(p.sessionId);workspaceUuid(p.checkpointId);
     if(p.targetProviderId!=='codex'&&p.targetProviderId!=='claude')throw new Error('INVALID_REQUEST');break;
   case 'scheduler.prepare':{
     featureFields(p,['action','intent','expectedRevisions']);
     const intent=featureObject(p.intent),revisions=featureObject(p.expectedRevisions);
     if(p.action==='enqueue'){
       featureFields(intent,['jobIntentId','priority'],['notBefore']);featureFields(revisions,[]);
       workspaceUuid(intent.jobIntentId);schedulerPriority(intent.priority);if(intent.notBefore!==undefined)schedulerDate(intent.notBefore);
     }else if(p.action==='policy.configure'){
       featureFields(intent,['limits','expectedRevision']);featureFields(revisions,['policyRevision']);
       schedulerLimits(intent.limits);workspaceRevision(intent.expectedRevision);
       if(intent.expectedRevision!==revisions.policyRevision)throw new Error('INVALID_REQUEST');
     }else if(p.action==='pause'||p.action==='cancel'){
       featureFields(intent,['jobId','expectedStateRevision']);featureFields(revisions,['stateRevision']);
       workspaceUuid(intent.jobId);workspaceRevision(intent.expectedStateRevision);
       if(intent.expectedStateRevision!==revisions.stateRevision)throw new Error('INVALID_REQUEST');
     }else throw new Error('UNSUPPORTED_VERSION');
     break;
   }
   default:throw new Error('UNSUPPORTED_VERSION');
 }
}

const ids=['jobId','sessionId','policyId','newRunId'] as const;
const revisions=['stateRevision','policyRevision','revokedRevision'] as const;
const resultFields=[...ids,...revisions,'position'];
export function publicSchedulerOperation(op:WorkflowOperationRecord){
 const {namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,result,error}=op;
 if(namespace!=='SCHEDULER')throw new Error('OPERATION_NOT_FOUND');
 return{namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(resultFields.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]])),
   error:error===null?null:foundationError(error as ErrorCode,{operationId:requestId,persisted:true})};
}
export function decodeSchedulerOperation(value:unknown){
 const p=featureObject(value);
 featureFields(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 const id=workspaceUuid(p.requestId);
 if(p.targetId!==null)workspaceUuid(p.targetId);
 if(p.namespace!=='SCHEDULER'||!(SCHEDULER_GRANTED as readonly string[]).includes(String(p.action))||
    !['ACCEPTED','WORKING','FINALIZED'].includes(String(p.phase)))throw new Error('INVALID_REQUEST');
 const final=p.phase==='FINALIZED';
 if(final!==(p.completedAt!==null)||[p.acceptedAt,...(final?[p.completedAt]:[])].some(item=>typeof item!=='string'||!Number.isFinite(Date.parse(item)))||
    !(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']).includes(String(p.outcome)))throw new Error('INVALID_REQUEST');
 if(p.result!==null){
   const result=featureObject(p.result);featureFields(result,[],resultFields);
   for(const [key,v] of Object.entries(result)){
     if(key==='position'){if(!Number.isInteger(v)||Number(v)<1||Number(v)>128)throw new Error('INVALID_REQUEST');}
     else if(key.endsWith('Revision'))workspaceRevision(v);
     else workspaceUuid(v);
   }
 }
 if(p.error!==null){
   const error=featureObject(p.error),safe=foundationError(error.code as ErrorCode,{operationId:id,persisted:true});
   featureFields(error,Object.keys(safe));
   if(Object.entries(safe).some(([key,v])=>error[key]!==v))throw new Error('INVALID_REQUEST');
 }
 requireSchedulerEnvelope(p);
 return p as unknown as ReturnType<typeof publicSchedulerOperation>;
}
export function schedulerCapabilities(value:unknown,method:string){
 const p=featureObject(value);
 if(p.schedulerVersion!==1||!Array.isArray(p.schedulerMethods)||!p.schedulerMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
