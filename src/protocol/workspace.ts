import {requireUuid,requireDecimal} from '../domain/identifiers.js';
import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
import {requireFeatureEnvelope as requireWorkspaceEnvelope} from './feature.js';

export {requireWorkspaceEnvelope};
export const WORKSPACE_READ_METHODS=['workspace.list','workspace.get','workspace.operation.get','workspace.cleanup.get'] as const;
export const WORKSPACE_MUTATION_METHODS=['workspace.create','workspace.refresh','workspace.remove'] as const;
export const WORKSPACE_PREPARE_METHODS=['workspace.prepare','workspace.cleanup.prepare'] as const;
export const WORKSPACE_METHODS=[...WORKSPACE_READ_METHODS,...WORKSPACE_MUTATION_METHODS,...WORKSPACE_PREPARE_METHODS] as const;
const ids=new Set(['projectId','featureId','workspaceId','envelopeId','requestId','grantId','observationId','operationId']);

export function workspaceUuid(value:unknown){
 try{return requireUuid(value);}catch{throw new Error('INVALID_REQUEST');}
}
export function workspaceRevision(value:unknown){
 try{const revision=requireDecimal(value);if(revision!=='0')return revision;}catch{/* Blunt public error. */}
 throw new Error('INVALID_REQUEST');
}
export function validateWorkspaceParams(method:string,value:unknown){
 const p=featureObject(value);requireWorkspaceEnvelope(p);
 switch(method){
   case 'workspace.prepare':featureFields(p,['featureId','envelopeId']);break;
   case 'workspace.create':featureFields(p,['requestId','grantId']);break;
   case 'workspace.list':{
     featureFields(p,['projectId'],['limit','cursor']);
     if(Object.hasOwn(p,'cursor'))featureText(p.cursor,4096,true);
     if(Object.hasOwn(p,'limit')&&(typeof p.limit!=='number'||!Number.isInteger(p.limit)||p.limit<1||p.limit>20))throw new Error('INVALID_REQUEST');
     break;
   }
   case 'workspace.get':
   case 'workspace.cleanup.get':featureFields(p,['workspaceId']);break;
   case 'workspace.operation.get':featureFields(p,['requestId']);break;
   case 'workspace.refresh':featureFields(p,['requestId','workspaceId','expectedStateRevision']);break;
   case 'workspace.cleanup.prepare':{
     featureFields(p,['workspaceId','targetRef','targetOid']);
     if(typeof p.targetRef!=='string'||!/^refs\/heads\/[!-~]{1,1024}$/.test(p.targetRef)
       ||typeof p.targetOid!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.targetOid))
       throw new Error('INVALID_REQUEST');
     break;
   }
   case 'workspace.remove':featureFields(p,['requestId','grantId','expectedStateRevision']);break;
   default:throw new Error('UNSUPPORTED_VERSION');
 }
 for(const [key,value] of Object.entries(p)){
   if(ids.has(key))workspaceUuid(value);
   else if(key==='expectedStateRevision')workspaceRevision(value);
 }
}

const resultKeys=['workspaceId','stateRevision','observationId'] as const;
export function publicWorkspaceOperation(o:WorkflowOperationRecord){
 const {requestId,namespace,action,phase,outcome,targetId,acceptedAt,completedAt,result,error}=o;
 if(namespace!=='WORKSPACE')throw new Error('OPERATION_NOT_FOUND');
 return{requestId,namespace,action,phase,outcome,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(resultKeys.filter(k=>Object.hasOwn(result,k)).map(k=>[k,result[k]])),
   error:error===null?null:foundationError(error as ErrorCode,{persisted:true,operationId:requestId})};
}
export function decodeWorkspaceOperation(data:unknown){
 const view=featureObject(data);
 featureFields(view,['requestId','namespace','action','phase','outcome','targetId','acceptedAt','completedAt','result','error']);
 workspaceUuid(view.requestId);workspaceUuid(view.targetId);
 if(view.namespace!=='WORKSPACE'||!['create','refresh','remove'].includes(String(view.action))
   ||!['ACCEPTED','WORKING','FINALIZED'].includes(String(view.phase)))throw new Error('INVALID_REQUEST');
 const final=view.phase==='FINALIZED';
 if(!(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']).includes(String(view.outcome))
   ||final!==(view.completedAt!==null))throw new Error('INVALID_REQUEST');
 for(const time of [view.acceptedAt,...(final?[view.completedAt]:[])])if(typeof time!=='string'||!Number.isFinite(Date.parse(time)))throw new Error('INVALID_REQUEST');
 if(view.result!==null){
   const result=featureObject(view.result);featureFields(result,[],resultKeys);
   for(const [key,value] of Object.entries(result))key==='stateRevision'?workspaceRevision(value):workspaceUuid(value);
   if(result.workspaceId!==undefined&&result.workspaceId!==view.targetId)throw new Error('INVALID_REQUEST');
 }
 if(view.error!==null){
   const e=featureObject(view.error),expected=foundationError(e.code as ErrorCode,{persisted:true,operationId:String(view.requestId)});
   featureFields(e,Object.keys(expected));
   if(Object.entries(expected).some(([key,value])=>e[key]!==value))throw new Error('INVALID_REQUEST');
 }
 requireWorkspaceEnvelope(view);
 return view as unknown as ReturnType<typeof publicWorkspaceOperation>;
}
export function workspaceCapabilities(data:unknown,method:string){
 const p=featureObject(data);
 if(p.workspaceVersion!==1||!Array.isArray(p.workspaceMethods)||!p.workspaceMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
