import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {ENVIRONMENT_GRANTED_ACTIONS,ENVIRONMENT_OBSERVATION_ACTIONS} from '../domain/environments/state.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import {requireFeatureEnvelope} from './feature.js';
import {workspaceRevision,workspaceUuid} from './workspace.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';

export const requireEnvironmentEnvelope=requireFeatureEnvelope;
export const ENVIRONMENT_READ_METHODS=['environment.get','environment.list','environment.operation.get','environment.artifact.get','environment.output.list','environment.job.get'] as const;
export const ENVIRONMENT_MUTATION_METHODS=['environment.plan','environment.attest','environment.prepare','environment.cancel','environment.validate','environment.reconcile'] as const;
export const ENVIRONMENT_METHODS=[...ENVIRONMENT_READ_METHODS,...ENVIRONMENT_MUTATION_METHODS] as const;

const digest=(value:unknown)=>{
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('INVALID_REQUEST');
};
function page(p:Record<string,unknown>,optionalLimit=true){
 if(p.cursor!==undefined)featureText(p.cursor,4096,true);
 if(optionalLimit&&p.limit!==undefined&&(typeof p.limit!=='number'||!Number.isSafeInteger(p.limit)||p.limit<1||p.limit>20))throw new Error('INVALID_REQUEST');
}
export function environmentMutation(method:string,params:Readonly<Record<string,unknown>>){
 return (ENVIRONMENT_MUTATION_METHODS as readonly string[]).includes(method)&&(method!=='environment.prepare'||!Object.hasOwn(params,'action'));
}
function authorization(p:Record<string,unknown>){
 featureFields(p,['action','intent','expectedRevisions']);
 const intent=featureObject(p.intent),revisions=featureObject(p.expectedRevisions);
 featureFields(revisions,['stateRevision']);workspaceRevision(revisions.stateRevision);
 switch(p.action){
   case 'prepare':featureFields(intent,['planId','planDigest']);workspaceUuid(intent.planId);digest(intent.planDigest);break;
   case 'attest':{
     featureFields(intent,['workspaceId','inputDigest','limitations']);workspaceUuid(intent.workspaceId);digest(intent.inputDigest);
     if(!Array.isArray(intent.limitations)||!intent.limitations.length||intent.limitations.length>8)throw new Error('INVALID_REQUEST');
     for(const limitation of intent.limitations)featureText(limitation,256,true);
     break;
   }
   case 'cancel':featureFields(intent,['jobId']);workspaceUuid(intent.jobId);break;
   case 'validate':featureFields(intent,['environmentId','commandSpecId','inputDigest']);workspaceUuid(intent.environmentId);workspaceUuid(intent.commandSpecId);digest(intent.inputDigest);break;
   default:throw new Error('INVALID_REQUEST');
 }
}
export function validateEnvironmentParams(method:string,value:unknown){
 const p=featureObject(value);requireEnvironmentEnvelope(p);
 if(method==='environment.prepare'&&Object.hasOwn(p,'action')){authorization(p);return;}
 switch(method){
   case 'environment.prepare':case 'environment.attest':case 'environment.cancel':case 'environment.validate':
     featureFields(p,['requestId','grantId']);break;
   case 'environment.plan':featureFields(p,['requestId','workspaceId','expectedStateRevision']);break;
   case 'environment.reconcile':featureFields(p,['requestId','jobId','expectedStateRevision']);break;
   case 'environment.get':featureFields(p,['workspaceId']);break;
   case 'environment.operation.get':featureFields(p,['requestId']);break;
   case 'environment.job.get':featureFields(p,['jobId']);break;
   case 'environment.list':featureFields(p,['projectId'],['cursor','limit']);page(p);break;
   case 'environment.output.list':featureFields(p,['jobId'],['cursor','limit']);page(p);break;
   case 'environment.artifact.get':featureFields(p,['artifactId'],['cursor']);page(p,false);break;
   default:throw new Error('UNSUPPORTED_VERSION');
 }
 for(const [key,v] of Object.entries(p)){
   if(key.endsWith('Id'))workspaceUuid(v);
   if(key==='expectedStateRevision')workspaceRevision(v);
 }
}

const resultKeys=['workspaceId','environmentId','stateRevision','planId','jobId','attestationId','artifactId'] as const;
export function publicEnvironmentOperation(operation:WorkflowOperationRecord){
 const {namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,result,error}=operation;
 if(namespace!=='ENVIRONMENT')throw new Error('OPERATION_NOT_FOUND');
 return{namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(resultKeys.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]])),
   error:error===null?null:foundationError(error as ErrorCode,{operationId:requestId,persisted:true})};
}
export function decodeEnvironmentOperation(value:unknown){
 const p=featureObject(value);
 featureFields(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 const id=workspaceUuid(p.requestId);
 workspaceUuid(p.targetId);
 if(p.namespace!=='ENVIRONMENT'||![...ENVIRONMENT_GRANTED_ACTIONS,...ENVIRONMENT_OBSERVATION_ACTIONS].includes(String(p.action))
   ||!['ACCEPTED','WORKING','FINALIZED'].includes(String(p.phase)))throw new Error('INVALID_REQUEST');
 const final=p.phase==='FINALIZED';
 if(final!==(p.completedAt!==null)||!(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']).includes(String(p.outcome))
   ||[p.acceptedAt,...(final?[p.completedAt]:[])].some(v=>typeof v!=='string'||!Number.isFinite(Date.parse(v))))throw new Error('INVALID_REQUEST');
 if(p.result!==null){
   const result=featureObject(p.result);featureFields(result,[],resultKeys);
   for(const [key,v] of Object.entries(result))key==='stateRevision'?workspaceRevision(v):workspaceUuid(v);
   if(result.workspaceId!==undefined&&result.workspaceId!==p.targetId)throw new Error('INVALID_REQUEST');
 }
 if(p.error!==null){
   const error=featureObject(p.error),safe=foundationError(error.code as ErrorCode,{operationId:id,persisted:true});
   featureFields(error,Object.keys(safe));
   if(Object.entries(safe).some(([key,v])=>error[key]!==v))throw new Error('INVALID_REQUEST');
 }
 requireEnvironmentEnvelope(p);
 return p as unknown as ReturnType<typeof publicEnvironmentOperation>;
}
export function environmentCapabilities(value:unknown,method:string){
 const p=featureObject(value);
 if(p.environmentVersion!==1||!Array.isArray(p.environmentMethods)||!p.environmentMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
