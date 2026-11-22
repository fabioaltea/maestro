import {EXECUTION_GRANTED,EXECUTION_OBSERVED,executionSessionStates} from '../domain/execution/model.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {requireFeatureEnvelope} from './feature.js';
import {workspaceRevision,workspaceUuid} from './workspace.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
import type {ExecutionProviderId} from '../ports/execution.js';

export const EXECUTION_READ_METHODS=['execution.provider.get','execution.list','execution.get','execution.operation.get','execution.artifact.get','execution.output.list'] as const;
const actions=[...EXECUTION_GRANTED,...EXECUTION_OBSERVED];
export const EXECUTION_MUTATION_METHODS=actions.map(action=>`execution.${action}`);
export const EXECUTION_METHODS=[...EXECUTION_READ_METHODS,...EXECUTION_MUTATION_METHODS,'execution.prepare'];
export const requireExecutionEnvelope=requireFeatureEnvelope;
export const executionMutation=(method:string)=>EXECUTION_MUTATION_METHODS.includes(method);

function oneOf<T extends string>(values:readonly T[],value:unknown):T{
 if(typeof value!=='string'||!values.includes(value as T))throw new Error('INVALID_REQUEST');
 return value as T;
}
export function executionProviderId(value:unknown):ExecutionProviderId{return oneOf(['codex','claude'],value);}
const fields:Record<typeof EXECUTION_GRANTED[number],readonly string[]>={
 'provider.configure':['providerId','binaryHandle','modelId','authProfileRef'],
 start:['featureId','workspaceId','profileResolutionId','envelopeId'],answer:['interactionId','expectedRevision','answerArtifactId'],
 pause:['sessionId','expectedStateRevision'],cancel:['sessionId','expectedStateRevision'],checkpoint:['sessionId','expectedStateRevision'],
 resume:['sessionId','checkpointId','providerId'],
};
export function validateExecutionParams(method:string,value:unknown){
 const p=featureObject(value);requireExecutionEnvelope(p);
 let body=p;
 if(method==='execution.prepare'){
   featureFields(p,['action','intent','expectedRevisions']);
   const action=oneOf(EXECUTION_GRANTED,p.action),revisions=featureObject(p.expectedRevisions);
   const revision=action==='provider.configure'?'configRevision':action==='start'?null:'stateRevision';
   featureFields(revisions,revision?[revision]:[]);
   if(revision&&(action!=='provider.configure'||revisions[revision]!==null))workspaceRevision(revisions[revision]);
   body=featureObject(p.intent);featureFields(body,fields[action],action==='start'?['reviewDecisionId']:[]);
   if((body.expectedRevision??body.expectedStateRevision??revisions.stateRevision)!==revisions.stateRevision)throw new Error('INVALID_REQUEST');
 }else if(method==='execution.provider.check')featureFields(p,['requestId','providerId','expectedConfigRevision']);
 else if(method==='execution.reconcile')featureFields(p,['requestId','sessionId']);
 else if(executionMutation(method))featureFields(p,['requestId','grantId']);
 else switch(method){
   case 'execution.provider.get':featureFields(p,['providerId']);break;
   case 'execution.list':
     featureFields(p,['projectId'],['limit','cursor','activeOnly']);
     if(p.activeOnly!==undefined&&(p.activeOnly!==true||p.limit!==undefined||p.cursor!==undefined))throw new Error('INVALID_REQUEST');
     break;
   case 'execution.get':featureFields(p,['sessionId']);break;
   case 'execution.operation.get':featureFields(p,['requestId']);break;
   case 'execution.artifact.get':featureFields(p,['artifactId'],['cursor']);break;
   case 'execution.output.list':featureFields(p,['runId'],['cursor']);break;
   default:throw new Error('UNSUPPORTED_VERSION');
 }
 for(const [key,v] of Object.entries(body)){
   if(key==='providerId')executionProviderId(v);
   else if(key==='modelId'){
     if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(v))throw new Error('INVALID_REQUEST');
   }else if(key.endsWith('Id')||key==='binaryHandle'||key==='authProfileRef')workspaceUuid(v);
   else if(key.startsWith('expected')&&key.endsWith('Revision'))workspaceRevision(v);
   else if(key==='cursor')featureText(v,1024,true);
   else if(key==='limit'&&(!Number.isInteger(v)||Number(v)<1||Number(v)>20))throw new Error('INVALID_REQUEST');
 }
}

const resultFields=['sessionId','runId','generation','answerId','checkpointId','digest','providerId','status','configRevision','capabilityDigest','state'] as const;
export function publicExecutionOperation(op:WorkflowOperationRecord){
 const {namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,result,error}=op;
 if(namespace!=='EXECUTION')throw new Error('OPERATION_NOT_FOUND');
 return{namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(resultFields.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]])),
   error:error===null?null:foundationError(error as ErrorCode,{operationId:requestId,persisted:true})};
}
export function decodeExecutionOperation(value:unknown){
 const p=featureObject(value);
 featureFields(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 const requestId=workspaceUuid(p.requestId);
 if(p.targetId!==null)workspaceUuid(p.targetId);
 if(p.namespace!=='EXECUTION')throw new Error('INVALID_REQUEST');
 oneOf(actions,p.action);oneOf(['ACCEPTED','WORKING','FINALIZED'],p.phase);
 const final=p.phase==='FINALIZED';
 if(final!==(p.completedAt!==null)||[p.acceptedAt,...(final?[p.completedAt]:[])].some(item=>typeof item!=='string'||!Number.isFinite(Date.parse(item))))
   throw new Error('INVALID_REQUEST');
 oneOf(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN'],p.outcome);
 if(p.result!==null){
   const fields=featureObject(p.result);featureFields(fields,[],resultFields);
   for(const [key,v] of Object.entries(fields)){
     if(key==='providerId')executionProviderId(v);
     else if(key.endsWith('Id')||key==='generation')workspaceUuid(v);
     else if(key==='configRevision')workspaceRevision(v);
     else if(key==='state')oneOf(executionSessionStates,v);
     else if(key==='status')oneOf(['UNQUALIFIED','BLOCKED','QUALIFIED'],v);
     else if((key!=='capabilityDigest'||v!==null)&&(typeof v!=='string'||!/^[0-9a-f]{64}$/.test(v)))throw new Error('INVALID_REQUEST');
   }
 }
 if(p.error!==null){
   const error=featureObject(p.error),safe=foundationError(error.code as ErrorCode,{operationId:requestId,persisted:true});
   featureFields(error,Object.keys(safe));
   if(Object.entries(safe).some(([key,v])=>error[key]!==v))throw new Error('INVALID_REQUEST');
 }
 return p as unknown as ReturnType<typeof publicExecutionOperation>;
}
export function executionCapabilities(value:unknown,method:string){
 const p=featureObject(value);
 if(p.executionVersion!==1||!Array.isArray(p.executionMethods)||!p.executionMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
