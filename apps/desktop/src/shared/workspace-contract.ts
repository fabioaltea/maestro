import type {Params} from './bridge-contract.ts';
import {CORE_ERRORS} from './core-errors.ts';
import {keys,record,revision,text,uuid} from './validation.ts';

export const WORKSPACE_MUTATIONS=['create','refresh'] as const;
export const WORKSPACE_QUERIES={
 listWorkspaces:{action:'list',key:'projectId'},
 getWorkspace:{action:'get',key:'workspaceId'},
 getWorkspaceOperation:{action:'operation',key:'requestId'},
} as const;
export const WORKSPACE_BRIDGE_METHODS=[
 'prepareWorkspaceAction','confirmWorkspaceAction','cancelWorkspaceAction',
 ...Object.keys(WORKSPACE_QUERIES) as (keyof typeof WORKSPACE_QUERIES)[],
] as const;

function requireFields(p:Params,required:readonly string[],optional:readonly string[]=[]){
 keys(p,[...required,...optional]);
 if(required.some(key=>!Object.hasOwn(p,key)))throw new Error('INVALID_INPUT');
}
export function validateWorkspaceAction(action:string,p:Params){
 if(action==='workspace.create'){
   requireFields(p,['featureId','envelopeId']);uuid(p.featureId);uuid(p.envelopeId);
 }else if(action==='workspace.refresh'){
   requireFields(p,['workspaceId','expectedStateRevision']);uuid(p.workspaceId);revision(p.expectedStateRevision);
 }else throw new Error('INVALID_INPUT');
}
export function workspaceBridgeAction(raw:unknown){
 const {action='create',...params}=record(raw);
 if(typeof action!=='string')throw new Error('INVALID_INPUT');
 const method=`workspace.${action}`;
 validateWorkspaceAction(method,params);
 return{method,params};
}
export function validateWorkspaceBridge(method:string,p:Params){
 const {bridgeVersion:_version,callId:_id,selectionEpoch:_epoch,...body}=p;
 if(method==='prepareWorkspaceAction'){
   requireFields(body,['params']);workspaceBridgeAction(body.params);
 }else if(method==='confirmWorkspaceAction'||method==='cancelWorkspaceAction'){
   requireFields(body,['confirmationId']);uuid(body.confirmationId);
 }else{
   const query=Object.hasOwn(WORKSPACE_QUERIES,method)?WORKSPACE_QUERIES[method as keyof typeof WORKSPACE_QUERIES]:undefined;
   if(!query)throw new Error('INVALID_INPUT');
   requireFields(body,[query.key],query.action==='list'?['cursor','limit']:[]);
   uuid(body[query.key]);
   if(body.cursor!==undefined)text(body.cursor,4096);
   if(body.limit!==undefined&&(!Number.isInteger(body.limit)||Number(body.limit)<1||Number(body.limit)>20))throw new Error('INVALID_INPUT');
 }
}
const states=['REQUESTED','CREATING','READY','IN_USE','BLOCKED','RECONCILING','REMOVING','REMOVED'];
function enumValue(value:unknown,allowed:readonly string[]){
 if(typeof value!=='string'||!allowed.includes(value))throw new Error('INVALID_INPUT');
}
function gitScope(p:Params){
 if(!/^refs\/heads\/[!-~]{1,1024}$/.test(text(p.baseRef,1035))
   ||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(p.baseOid,64))
   ||p.branchRef!==`refs/heads/maestro/feature/${uuid(p.featureId)}/${uuid(p.workspaceId)}`)throw new Error('INVALID_INPUT');
}
function time(value:unknown){
 if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('INVALID_INPUT');
}
function safeCode(value:unknown){
 if(typeof value!=='string'||!Object.hasOwn(CORE_ERRORS,value))throw new Error('INVALID_INPUT');
 return value as keyof typeof CORE_ERRORS;
}
function sanitizedError(value:unknown){return CORE_ERRORS[safeCode(record(value).code)];}
function workspace(value:unknown){
 const p=record(value);
 requireFields(p,['workspaceId','featureId','projectId','envelopeId','state','stateRevision','baseRef','baseOid','branchRef',
   'ownership','updatedAt','createdAt','safeError'],['observation']);
 uuid(p.projectId);uuid(p.envelopeId);revision(p.stateRevision);gitScope(p);
 enumValue(p.state,states);enumValue(p.ownership,['RECORDED','UNKNOWN']);time(p.updatedAt);time(p.createdAt);
 if(p.safeError!==null)safeCode(p.safeError);
 if(p.observation!==undefined&&p.observation!==null){
   const observation=record(p.observation);
   requireFields(observation,['observationId','checkedAt','headOid','branchRef','ownership','tracked','untracked','ignored','conflicts']);
   uuid(observation.observationId);time(observation.checkedAt);enumValue(observation.ownership,['VERIFIED','UNKNOWN','ABSENT']);
   if(observation.ownership==='VERIFIED'){
     if(observation.branchRef!==p.branchRef||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(text(observation.headOid,64)))throw new Error('INVALID_INPUT');
   }else if(observation.branchRef!==null||observation.headOid!==null)throw new Error('INVALID_INPUT');
   for(const key of ['tracked','untracked','ignored','conflicts'])if(observation.ownership==='VERIFIED'?typeof observation[key]!=='boolean':observation[key]!==null)throw new Error('INVALID_INPUT');
 }
 return p;
}
function operation(value:unknown){
 const p=record(value);
 requireFields(p,['requestId','namespace','action','phase','outcome','targetId','acceptedAt','completedAt','result','error']);
 uuid(p.requestId);uuid(p.targetId);time(p.acceptedAt);
 if(p.namespace!=='WORKSPACE')throw new Error('INVALID_INPUT');
 enumValue(p.action,WORKSPACE_MUTATIONS);
 enumValue(p.phase,['ACCEPTED','WORKING','FINALIZED']);
 if(p.phase==='FINALIZED'){time(p.completedAt);enumValue(p.outcome,['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']);}
 else{if(p.completedAt!==null)throw new Error('INVALID_INPUT');enumValue(p.outcome,['IN_PROGRESS','UNKNOWN']);}
 if(p.result!==null){
   const result=record(p.result);
   keys(result,['workspaceId','stateRevision','observationId']);
   if(result.workspaceId!==undefined&&uuid(result.workspaceId)!==p.targetId)throw new Error('INVALID_INPUT');
   if(result.stateRevision!==undefined)revision(result.stateRevision);
   if(result.observationId!==undefined)uuid(result.observationId);
 }
 return {...p,error:p.error===null?null:sanitizedError(p.error)};
}
export function validateWorkspaceData(action:string,raw:unknown):Params{
 try{
   const p=record(raw),out={...p};
   if(new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('INVALID_INPUT');
   const expected:Readonly<Record<string,readonly string[]>>={
     prepare:['grantId','canonicalIntentHash','expiresAtMs','summary'],list:['items','nextCursor'],get:['workspace'],
     operation:['operation'],create:['accepted','requestId','workspaceId','stateRevision','operation'],
     refresh:['accepted','requestId','workspaceId','stateRevision','operation'],
   };
   if(!Object.hasOwn(expected,action))throw new Error('INVALID_INPUT');
   keys(p,[...expected[action]!,'freshness','storeId','observabilityDegraded','code','error']);
   if(p.storeId!==undefined)uuid(p.storeId);
   if(p.code!==undefined)safeCode(p.code);
   if(p.error!==undefined&&p.error!==null)out.error=sanitizedError(p.error);
   if(p.freshness!==undefined)enumValue(p.freshness,['CURRENT','LAST_KNOWN']);
   if(p.items!==undefined){
     if(!Array.isArray(p.items)||p.items.length>20)throw new Error('INVALID_INPUT');
     out.items=p.items.map(workspace);
   }
   if(p.nextCursor!==undefined&&p.nextCursor!==null)text(p.nextCursor,4096);
   if(p.workspace!==undefined)out.workspace=workspace(p.workspace);
   if(p.operation!==undefined)out.operation=operation(p.operation);
   if(p.accepted!==undefined){
     if(p.accepted!==true)throw new Error('INVALID_INPUT');
     uuid(p.requestId);uuid(p.workspaceId);revision(p.stateRevision);
   }
   if(p.summary!==undefined){
     const s=record(p.summary);
     requireFields(s,['workspaceId','projectId','featureId','envelopeId','featureRevision','baseRef','baseOid','branchRef']);
     uuid(s.projectId);uuid(s.envelopeId);revision(s.featureRevision);gitScope(s);
     uuid(p.grantId);
     if(!/^[a-f0-9]{64}$/.test(text(p.canonicalIntentHash,64))||!Number.isSafeInteger(p.expiresAtMs))throw new Error('INVALID_INPUT');
   }
   return out;
 }catch{throw new Error('CLIENT_PROTOCOL_ERROR');}
}
