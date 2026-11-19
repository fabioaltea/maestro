import type {Params} from './bridge-contract.ts';
import {record,keys,text,uuid,revision} from './input.ts';
import {CORE_ERRORS} from './core-errors.ts';

export const ENVIRONMENT_MUTATIONS=['plan','attest'] as const;
export const ENVIRONMENT_QUERIES={
 getEnvironment:{action:'get',key:'workspaceId'},
 listEnvironments:{action:'list',key:'projectId'},
 getEnvironmentOperation:{action:'operation',key:'requestId'},
} as const;
export const ENVIRONMENT_BRIDGE_METHODS=['prepareEnvironmentAction','confirmEnvironmentAction','cancelEnvironmentAction',
 ...Object.keys(ENVIRONMENT_QUERIES) as (keyof typeof ENVIRONMENT_QUERIES)[]] as const;
function fields(p:Params,required:readonly string[],optional:readonly string[]=[]){
 keys(p,[...required,...optional]);
 if(required.some(name=>!Object.hasOwn(p,name)))throw new Error('INVALID_INPUT');
}
function sha(value:unknown){if(!/^[a-f0-9]{64}$/.test(text(value,64)))throw new Error('INVALID_INPUT');}
function version(value:unknown){if(!/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(text(value,14)))throw new Error('INVALID_INPUT');}
function limitations(value:unknown){
 if(!Array.isArray(value)||!value.length||value.length>8)throw new Error('INVALID_INPUT');
 for(const item of value)if(!text(item,256).trim()||new TextEncoder().encode(item).length>256)throw new Error('INVALID_INPUT');
}
export function environmentBridgeAction(raw:unknown){
 const {action,...params}=record(raw);
 if(action==='plan'){
   fields(params,['workspaceId','expectedStateRevision'],['managerVersion']);
   uuid(params.workspaceId);revision(params.expectedStateRevision);if(params.managerVersion!==undefined)version(params.managerVersion);
 }else if(action==='attest'){
   fields(params,['workspaceId','stateRevision','inputDigest','limitations']);
   uuid(params.workspaceId);revision(params.stateRevision);sha(params.inputDigest);limitations(params.limitations);
 }else throw new Error('INVALID_INPUT');
 return{action,params};
}
export function validateEnvironmentBridge(method:string,p:Params){
 const {bridgeVersion:_version,callId:_id,selectionEpoch:_epoch,...body}=p;
 if(method==='prepareEnvironmentAction'){fields(body,['params']);environmentBridgeAction(body.params);return;}
 if(method==='confirmEnvironmentAction'||method==='cancelEnvironmentAction'){fields(body,['confirmationId']);uuid(body.confirmationId);return;}
 const q=Object.hasOwn(ENVIRONMENT_QUERIES,method)?ENVIRONMENT_QUERIES[method as keyof typeof ENVIRONMENT_QUERIES]:undefined;
 if(!q)throw new Error('INVALID_INPUT');
 fields(body,[q.key],q.action==='list'?['limit','cursor']:[]);uuid(body[q.key]);
 if(body.cursor!==undefined)text(body.cursor,4096);
 if(body.limit!==undefined&&(!Number.isInteger(body.limit)||Number(body.limit)<1||Number(body.limit)>20))throw new Error('INVALID_INPUT');
}

const states=['UNCONFIGURED','PLANNED','MANUAL_REQUIRED','MANUAL_VERIFIED','PREPARING','READY','STALE','BLOCKED','RECONCILING'];
const valueIn=(value:unknown,allowed:readonly string[])=>{if(typeof value!=='string'||!allowed.includes(value))throw new Error('INVALID_INPUT');};
const date=(value:unknown)=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))throw new Error('INVALID_INPUT');};
function safeCode(value:unknown){
 if(typeof value!=='string'||!Object.hasOwn(CORE_ERRORS,value))throw new Error('INVALID_INPUT');
 return value as keyof typeof CORE_ERRORS;
}
function safeError(value:unknown){return CORE_ERRORS[safeCode(record(value).code)];}
function environment(value:unknown){
 const p=record(value);
 fields(p,['workspaceId','state','stateRevision'],['environmentId','currentPlanId','attestationId','preparedDigest','safeError','checkedAt','createdAt','updatedAt']);
 uuid(p.workspaceId);valueIn(p.state,states);
 if(p.state==='UNCONFIGURED'&&p.stateRevision===null)return p;
 revision(p.stateRevision);uuid(p.environmentId);
 for(const field of ['currentPlanId','attestationId'])if(p[field]!==null)uuid(p[field]);
 if(p.preparedDigest!==null)sha(p.preparedDigest);
 if(p.safeError!==null)safeCode(p.safeError);
 if(p.checkedAt!==null)date(p.checkedAt);
 date(p.createdAt);date(p.updatedAt);
 return p;
}
function plan(value:unknown){
 const p=record(value);
 fields(p,['planId','digest','inputDigest','artifactId','createdAt','manager','managerVersion','pin','disposition','reason','scriptNames','inputFiles','networkScope']);
 uuid(p.planId);uuid(p.artifactId);sha(p.digest);sha(p.inputDigest);date(p.createdAt);
 valueIn(p.manager,['pnpm','npm','yarn','bun','UNKNOWN']);
 if(p.managerVersion!==null)version(p.managerVersion);
 valueIn(p.disposition,['PLANNED','MANUAL_REQUIRED']);
 valueIn(p.networkScope,['OFFLINE','LOOPBACK']);
 if(p.reason!==null)safeCode(p.reason);
 if(!Array.isArray(p.scriptNames)||p.scriptNames.length>64||p.scriptNames.some(x=>typeof x!=='string'||!/^[a-zA-Z0-9:_-]{1,64}$/.test(x))||
   !Number.isSafeInteger(p.inputFiles)||Number(p.inputFiles)<0||Number(p.inputFiles)>200)throw new Error('INVALID_INPUT');
 if(p.pin!==null){
   const pin=record(p.pin);fields(pin,['manager','version','nodeVersion','entryDigest','distributionDigest','nodeDigest','profileDigest','descendants','importMethod']);
   if(pin.manager!=='pnpm'||pin.descendants!=='DENIED'||pin.importMethod!=='clone-or-copy')throw new Error('INVALID_INPUT');
   version(pin.version);version(pin.nodeVersion);for(const field of ['entryDigest','distributionDigest','nodeDigest','profileDigest'])sha(pin[field]);
 }
 return p;
}
function operation(value:unknown){
 const op=record(value);
 fields(op,['requestId','namespace','action','phase','outcome','targetId','acceptedAt','completedAt','result','error']);
 uuid(op.requestId);uuid(op.targetId);date(op.acceptedAt);
 if(op.namespace!=='ENVIRONMENT')throw new Error('INVALID_INPUT');
 valueIn(op.action,ENVIRONMENT_MUTATIONS);valueIn(op.phase,['ACCEPTED','WORKING','FINALIZED']);
 if(op.phase==='FINALIZED'){date(op.completedAt);valueIn(op.outcome,['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']);}
 else{if(op.completedAt!==null)throw new Error('INVALID_INPUT');valueIn(op.outcome,['IN_PROGRESS','UNKNOWN']);}
 if(op.result!==null){
   const result=record(op.result);keys(result,['workspaceId','environmentId','planId','jobId','attestationId','artifactId','stateRevision']);
   for(const [key,value] of Object.entries(result))key==='stateRevision'?revision(value):uuid(value);
   if(result.workspaceId!==undefined&&result.workspaceId!==op.targetId)throw new Error('INVALID_INPUT');
 }
 return{...op,error:op.error===null?null:safeError(op.error)};
}
export function validateEnvironmentData(action:string,raw:unknown):Params{
 try{
   const p=record(raw),out={...p};
   const extra:Record<string,readonly string[]>={get:['environment','plan','currentness','qualificationKind'],list:['items','nextCursor'],operation:['operation'],
     authorize:['grantId','expiresAtMs','canonicalIntentHash','summary'],plan:['accepted','requestId','workspaceId','stateRevision','operation'],attest:['operation']};
   if(!Object.hasOwn(extra,action)||new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('INVALID_INPUT');
   keys(p,[...extra[action]!,'storeId','freshness','code','error']);
   if(p.storeId!==undefined)uuid(p.storeId);
   if(p.code!==undefined)safeCode(p.code);
   if(p.error!=null)out.error=safeError(p.error);
   if(p.freshness!==undefined)valueIn(p.freshness,['CURRENT','LAST_KNOWN']);
   if(p.environment!==undefined)out.environment=environment(p.environment);
   if(p.plan!=null)out.plan=plan(p.plan);
   if(p.currentness!==undefined)valueIn(p.currentness,['UNKNOWN','STALE','LAST_CHECKED']);
   if(p.qualificationKind!==undefined)valueIn(p.qualificationKind,['NONE','MANUAL','QUALIFIED']);
   if(p.items!==undefined){
     if(!Array.isArray(p.items)||p.items.length>20)throw new Error('INVALID_INPUT');
     out.items=p.items.map(environment);
   }
   if(p.nextCursor!=null)text(p.nextCursor,4096);
   if(p.operation!==undefined)out.operation=operation(p.operation);
   if(p.accepted!==undefined){
     if(p.accepted!==true)throw new Error('INVALID_INPUT');
     uuid(p.requestId);uuid(p.workspaceId);revision(p.stateRevision);
   }
   if(p.summary!==undefined){
     const summary=record(p.summary);
     fields(summary,['action','workspaceId','planId','stateRevision','inputDigest','limitations']);
     if(summary.action!=='attest')throw new Error('INVALID_INPUT');
     uuid(summary.workspaceId);uuid(summary.planId);revision(summary.stateRevision);sha(summary.inputDigest);limitations(summary.limitations);
     uuid(p.grantId);sha(p.canonicalIntentHash);
     if(!Number.isSafeInteger(p.expiresAtMs))throw new Error('INVALID_INPUT');
   }
   return out;
 }catch{throw new Error('CLIENT_PROTOCOL_ERROR');}
}
