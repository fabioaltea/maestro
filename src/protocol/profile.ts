import {PROFILE_GRANTED,PROFILE_KINDS,PROFILE_OBSERVED,PROFILE_SCOPES} from '../domain/profiles/model.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {requireFeatureEnvelope} from './feature.js';
import {workspaceRevision,workspaceUuid} from './workspace.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';

export const PROFILE_READ_METHODS=['profile.list','profile.get','profile.skill.preview.get','profile.resolution.get','profile.artifact.get','profile.operation.get'] as const;
export const PROFILE_ACTION_METHODS=[
 'profile.create','profile.revise','profile.disable','profile.resolve','profile.skill.preview','profile.skill.import','profile.skill.bind','profile.tool.import','profile.tool.enable',
] as const;
export const PROFILE_METHODS=[...PROFILE_READ_METHODS,...PROFILE_ACTION_METHODS,'profile.prepare','profile.skill.source','profile.capabilities','profile.suggest'] as const;

export function profileDigest(value:unknown){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('INVALID_REQUEST');
 return value;
}
const oneOf=(values:readonly string[],value:unknown)=>{
 if(typeof value!=='string'||!values.includes(value))throw new Error('INVALID_REQUEST');
};
export function validateProfileScope(value:Record<string,unknown>,ownerAllowed=false){
 oneOf(ownerAllowed?PROFILE_SCOPES:PROFILE_SCOPES.slice(0,2),value.scope);
 if(value.scope==='GLOBAL'&&(Object.hasOwn(value,'projectId')||Object.hasOwn(value,'ownerProfileId'))||
   value.scope==='PROJECT'&&(!Object.hasOwn(value,'projectId')||Object.hasOwn(value,'ownerProfileId'))||
   value.scope==='PROFILE'&&!Object.hasOwn(value,'ownerProfileId'))throw new Error('INVALID_REQUEST');
}
function refs(value:unknown){
 if(!Array.isArray(value)||value.length>20)throw new Error('INVALID_REQUEST');
 for(const element of value){
   const item=featureObject(element);featureFields(item,['entityId','revisionId']);workspaceUuid(item.entityId);workspaceUuid(item.revisionId);
 }
}
const intentFields:Record<string,{required:readonly string[];optional:readonly string[];updates?:true}>={
 create:{required:['scope','bundleArtifactId'],optional:['projectId']},
 revise:{required:['profileId','bundleArtifactId'],optional:[],updates:true},
 disable:{required:['targetId','expectedStateRevision'],optional:[],updates:true},
 'skill.import':{required:['previewId','sourceDigest'],optional:[]},
 'skill.bind':{required:['profileId','revisionId','requiredRefs','recommendedRefs'],optional:[],updates:true},
 'tool.import':{required:['manifestArtifactId','sourceDigest'],optional:[]},
 'tool.enable':{required:['toolId','revisionId','permissions'],optional:[],updates:true},
};
export const requireProfileEnvelope=requireFeatureEnvelope;
export function profileMutation(method:string){
 return (PROFILE_ACTION_METHODS as readonly string[]).includes(method);
}
export function validateProfileParams(method:string,value:unknown){
 const p=featureObject(value);requireProfileEnvelope(p);
 let fields=p;
 if(method==='profile.prepare'){
   featureFields(p,['action','intent','expectedRevisions']);
   const action=featureText(p.action,32,true);
   const shape=Object.hasOwn(intentFields,action)?intentFields[action]:undefined;
   if(!shape)throw new Error('INVALID_REQUEST');
   const r=featureObject(p.expectedRevisions);
   featureFields(r,shape.updates?['stateRevision']:[]);
   if(shape.updates)workspaceRevision(r.stateRevision);
   fields=featureObject(p.intent);featureFields(fields,shape.required,shape.optional);
   if(action==='create')validateProfileScope(fields);
   if(action==='disable'&&r.stateRevision!==fields.expectedStateRevision)throw new Error('INVALID_REQUEST');
   if(action==='skill.bind'){refs(fields.requiredRefs);refs(fields.recommendedRefs);}
   if(action==='tool.enable'&&(!Array.isArray(fields.permissions)||fields.permissions.length>20||
     fields.permissions.some(item=>typeof item!=='string'||!/^[A-Z][A-Z0-9_]{0,47}$/.test(item))))throw new Error('INVALID_REQUEST');
 }else if(method==='profile.resolve')featureFields(p,['requestId','profileId','revisionId','projectId','providerCapabilityDigest']);
 else if(method==='profile.skill.preview'){
   featureFields(p,['requestId','importHandle','scope'],['projectId','ownerProfileId']);
   workspaceUuid(p.importHandle);validateProfileScope(p,true);
 }else if(profileMutation(method))featureFields(p,['requestId','grantId']);
 else switch(method){
   case 'profile.list':
     featureFields(p,['kind'],['projectId','cursor','limit']);oneOf(PROFILE_KINDS,p.kind);
     if(p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20))throw new Error('INVALID_REQUEST');
     break;
   case 'profile.skill.preview.get':featureFields(p,['previewId']);break;
   case 'profile.get':featureFields(p,['entityId'],['revisionId']);break;
   case 'profile.resolution.get':featureFields(p,['resolutionId']);break;
   case 'profile.operation.get':featureFields(p,['requestId']);break;
   case 'profile.suggest':featureFields(p,['profileId','projectId']);break;
   case 'profile.artifact.get':featureFields(p,['artifactId'],['cursor']);break;
   case 'profile.capabilities':featureFields(p,[]);break;
   case 'profile.skill.source':
     featureFields(p,['source']);
     if(!featureText(p.source,4096,true).startsWith('/'))throw new Error('INVALID_REQUEST');
     break;
   default:throw new Error('UNSUPPORTED_VERSION');
 }
 for(const [key,v] of Object.entries(fields)){
   if(key.endsWith('Id'))workspaceUuid(v);
   if(key.endsWith('Digest'))profileDigest(v);
   if(key==='cursor')featureText(v,4096,true);
   if(key==='expectedStateRevision')workspaceRevision(v);
 }
}
const results=['entityId','revisionId','stateRevision','resolutionId','previewId','artifactId'];
const actions=[...PROFILE_GRANTED,...PROFILE_OBSERVED] as readonly string[];
export function publicProfileOperation(operation:WorkflowOperationRecord){
 const {namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,result,error}=operation;
 if(namespace!=='PROFILE')throw new Error('OPERATION_NOT_FOUND');
 return{namespace,action,phase,outcome,requestId,targetId,acceptedAt,completedAt,
   result:result===null?null:Object.fromEntries(results.filter(key=>Object.hasOwn(result,key)).map(key=>[key,result[key]])),
   error:error===null?null:foundationError(error as ErrorCode,{operationId:requestId,persisted:true})};
}
export function decodeProfileOperation(value:unknown){
 const p=featureObject(value);
 featureFields(p,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
 const requestId=workspaceUuid(p.requestId);workspaceUuid(p.targetId);
 if(p.namespace!=='PROFILE')throw new Error('INVALID_REQUEST');
 oneOf(actions,p.action);oneOf(['ACCEPTED','WORKING','FINALIZED'],p.phase);
 const final=p.phase==='FINALIZED';
 if(final!==(p.completedAt!==null)||[p.acceptedAt,...(final?[p.completedAt]:[])].some(item=>typeof item!=='string'||!Number.isFinite(Date.parse(item))))
   throw new Error('INVALID_REQUEST');
 oneOf(final?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN'],p.outcome);
 if(p.result!==null){
   const result=featureObject(p.result);featureFields(result,[],results);
   for(const [key,v] of Object.entries(result))key==='stateRevision'?workspaceRevision(v):workspaceUuid(v);
 }
 if(p.error!==null){
   const error=featureObject(p.error),safe=foundationError(error.code as ErrorCode,{operationId:requestId,persisted:true});
   featureFields(error,Object.keys(safe));
   if(Object.entries(safe).some(([key,v])=>error[key]!==v))throw new Error('INVALID_REQUEST');
 }
 requireProfileEnvelope(p);
 return p as unknown as ReturnType<typeof publicProfileOperation>;
}
export function profileCapabilities(value:unknown,method:string){
 const p=featureObject(value);
 if(p.profileVersion!==1||!Array.isArray(p.profileMethods)||!p.profileMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');
}
