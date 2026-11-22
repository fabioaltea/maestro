import {createHash} from 'node:crypto';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {featureObject} from '../../domain/features/bundle.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {StoragePort} from '../../ports/storage.js';
import type {SchedulerChange} from '../../ports/scheduler.js';
import type {SchedulerAction} from './dispatch.js';
import {publicSchedulerOperation,schedulerLimits} from '../../protocol/scheduler.js';

export function createSchedulerAdmission(options:{storage:StoragePort;paths:ArchivePaths;instanceId:string;accepting():boolean;wake():void}){
 const {storage,instanceId}=options,auth=createWorkflowAuthorization(options);
 async function prepare(p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const snapshot=await auth.guard(peer),action=String(p.action),input=featureObject(p.intent);
   const base={version:1 as const,namespace:'SCHEDULER' as const,storeId:snapshot.store.storeId,ownerUid:options.paths.ownerUid,configRevision:null};
   const query=storage.readSchedulerState!;
   let intent:WorkflowIntent;
   if(action==='enqueue'){
     const jobIntentId=String(input.jobIntentId),{grant}=await storage.readFeatureState!({kind:'grant',id:jobIntentId});
     const now=Date.now();
     if(!grant||grant.consumedByRequestId!==null||now<grant.createdAtMs||now>=grant.expiresAtMs)throw new Error('APPROVAL_STALE');
     const delegated=JSON.parse(grant.canonicalIntent) as WorkflowIntent;
     if(!delegated.projectId||delegated.storeId!==snapshot.store.storeId||
       !(delegated.namespace==='EXECUTION'&&['start','resume'].includes(delegated.action)||
         delegated.namespace==='ENVIRONMENT'&&['prepare','validate'].includes(delegated.action)))throw new Error('APPROVAL_REQUIRED');
     const project=await storage.getProject(delegated.projectId);
     if(!project||project.project.removedAt!==null)throw new Error('PROJECT_REMOVED');
     intent={...base,action,targetId:jobIntentId,projectId:delegated.projectId,expectedRevision:null,
       payload:{jobIntentId,priority:input.priority,notBefore:input.notBefore??null}};
   }else if(action==='policy.configure'){
     const {policy}=await query({kind:'policy'});
     if(!policy||policy.revision!==input.expectedRevision)throw new Error('APPROVAL_STALE');
     intent={...base,action,targetId:null,projectId:null,expectedRevision:policy.revision,payload:{limits:schedulerLimits(input.limits)}};
   }else if(action==='cancel'||action==='pause'){
     const {job}=await query({kind:'job',id:String(input.jobId)});
     if(!job||job.stateRevision!==input.expectedStateRevision)throw new Error('APPROVAL_STALE');
     intent={...base,action,targetId:job.jobId,projectId:job.projectId,expectedRevision:job.stateRevision,payload:{}};
   }else throw new Error('UNSUPPORTED_VERSION');
   const grant=await auth.prepare(peer,intent);
   return{grantId:grant.grantId,canonicalIntentHash:createHash('sha256').update(grant.canonicalIntent).digest('hex'),
     summary:grant.summary,expiresAt:grant.expiresAtMs};
 }
 const actions:Record<string,SchedulerAction>={'scheduler.prepare':prepare};
 for(const kind of ['enqueue','policy.configure','cancel','pause'] as const){
   actions[`scheduler.${kind}`]=async(p,peer)=>{
     if(!options.accepting())throw new Error('BLOCKED');
     await auth.guard(peer);
     const requestId=String(p.requestId);
     const {grant,intent,operation}=await originalWorkflowGrant(storage,requestId,String(p.grantId),kind,'SCHEDULER');
     if(operation)return{operation:publicSchedulerOperation(operation)};
     const admission=workflowAdmission({requestId,intent,grantId:grant.grantId,instanceId,nowMs:Date.now()});
     const change:SchedulerChange={kind,admission};
     const result=await storage.commitSchedulerState!(change);
     if(result.inserted)options.wake();
     if(!result.operation)throw new Error('STATE_CORRUPT');
     return{operation:publicSchedulerOperation(result.operation)};
   };
 }
 return actions;
}
