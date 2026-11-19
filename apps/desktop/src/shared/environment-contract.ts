import type {Params} from './bridge-contract.ts';
import {record,keys,text,uuid,revision} from './input.ts';
import {CORE_ERRORS} from './core-errors.ts';

export const ENVIRONMENT_MUTATIONS=['plan','attest','prepare','cancel'] as const;
export const ENVIRONMENT_QUERIES={
 getEnvironment:{action:'get',key:'workspaceId'},
 listEnvironments:{action:'list',key:'projectId'},
 getEnvironmentOperation:{action:'operation',key:'requestId'},
 getEnvironmentJob:{action:'job',key:'jobId'},
 getEnvironmentOutput:{action:'output',key:'jobId'},
 getEnvironmentArtifact:{action:'artifact',key:'artifactId'},
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
 }else if(action==='prepare'){
   fields(params,['workspaceId','stateRevision','planId','planDigest']);uuid(params.workspaceId);uuid(params.planId);revision(params.stateRevision);sha(params.planDigest);
 }else if(action==='cancel'){
   fields(params,['workspaceId','stateRevision','jobId']);uuid(params.workspaceId);uuid(params.jobId);revision(params.stateRevision);
 }else throw new Error('INVALID_INPUT');
 return{action,params};
}
export function validateEnvironmentBridge(method:string,p:Params){
 const {bridgeVersion:_version,callId:_id,selectionEpoch:_epoch,...body}=p;
 if(method==='prepareEnvironmentAction'){fields(body,['params']);environmentBridgeAction(body.params);return;}
 if(method==='confirmEnvironmentAction'||method==='cancelEnvironmentAction'){fields(body,['confirmationId']);uuid(body.confirmationId);return;}
 const q=Object.hasOwn(ENVIRONMENT_QUERIES,method)?ENVIRONMENT_QUERIES[method as keyof typeof ENVIRONMENT_QUERIES]:undefined;
 if(!q)throw new Error('INVALID_INPUT');
 fields(body,[q.key],['list','output'].includes(q.action)?['limit','cursor']:q.action==='artifact'?['cursor']:[]);uuid(body[q.key]);
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
function job(value:unknown){
 const p=record(value);
 fields(p,['jobId','environmentId','planId','requestId','kind','commandSpecId','phase','stateRevision','inputDigest','outputWatermark','truncated',
   'exitProof','safeError','createdAt','completedAt']);
 for(const key of ['jobId','environmentId','planId','requestId'])uuid(p[key]);
 if(p.commandSpecId!==null)uuid(p.commandSpecId);
 valueIn(p.kind,['INSTALL','VALIDATE']);valueIn(p.phase,['QUEUED','RUNNING','CANCELLING','SUCCEEDED','FAILED','CANCELLED','RECONCILING']);
 revision(p.stateRevision);sha(p.inputDigest);date(p.createdAt);
 if(p.completedAt!==null)date(p.completedAt);
 if(p.safeError!==null)safeCode(p.safeError);
 if(!/^(0|[1-9][0-9]*)$/.test(text(p.outputWatermark,19))||typeof p.truncated!=='boolean')throw new Error('INVALID_INPUT');
 if(p.exitProof!==null){
   const proof=record(p.exitProof);fields(proof,['verified','code','reason']);
   if(proof.verified!==true||proof.code!==null&&(!Number.isInteger(proof.code)||Number(proof.code)<0||Number(proof.code)>255))throw new Error('INVALID_INPUT');
   if(proof.reason!==null)safeCode(proof.reason);
 }
 return p;
}
export function validateEnvironmentData(action:string,raw:unknown):Params{
 try{
   const p=record(raw),out={...p};
   const accepted=['accepted','requestId','workspaceId','stateRevision','jobId','operation'];
   const extra:Record<string,readonly string[]>={get:['environment','plan','job','currentness','qualificationKind'],list:['items','nextCursor'],operation:['operation'],
     authorize:['grantId','expiresAtMs','canonicalIntentHash','summary'],plan:accepted,attest:['operation'],prepare:accepted,cancel:accepted,job:['job'],
     output:['jobId','chunks','watermark','truncated','nextCursor'],artifact:['artifactId','sha256','totalBytes','offset','base64','nextCursor']};
   if(!Object.hasOwn(extra,action)||new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('INVALID_INPUT');
   keys(p,[...extra[action]!,'storeId','freshness','code','error']);
   if(p.storeId!==undefined)uuid(p.storeId);
   if(p.code!==undefined)safeCode(p.code);
   if(p.error!=null)out.error=safeError(p.error);
   if(p.freshness!==undefined)valueIn(p.freshness,['CURRENT','LAST_KNOWN']);
   if(p.environment!==undefined)out.environment=environment(p.environment);
   if(p.plan!=null)out.plan=plan(p.plan);
   if(p.job!=null)out.job=job(p.job);
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
     if(p.jobId!==undefined)uuid(p.jobId);
   }
   if(p.summary!==undefined){
     const summary=record(p.summary);
     uuid(summary.workspaceId);revision(summary.stateRevision);
     if(summary.action==='attest'){
       fields(summary,['action','workspaceId','planId','stateRevision','inputDigest','limitations']);
       uuid(summary.planId);sha(summary.inputDigest);limitations(summary.limitations);
     }else if(summary.action==='prepare'){
       fields(summary,['action','workspaceId','planId','planDigest','stateRevision','inputDigest','managerVersion','networkScope','scriptPolicy','importMethod']);
       uuid(summary.planId);sha(summary.planDigest);sha(summary.inputDigest);version(summary.managerVersion);valueIn(summary.networkScope,['OFFLINE','LOOPBACK']);
       if(summary.scriptPolicy!=='DISABLED'||summary.importMethod!=='clone-or-copy')throw new Error('INVALID_INPUT');
     }else if(summary.action==='cancel'){
       fields(summary,['action','workspaceId','jobId','stateRevision']);uuid(summary.jobId);
     }else throw new Error('INVALID_INPUT');
     uuid(p.grantId);sha(p.canonicalIntentHash);
     if(!Number.isSafeInteger(p.expiresAtMs))throw new Error('INVALID_INPUT');
   }
   if(p.chunks!==undefined){
     uuid(p.jobId);
     if(!Array.isArray(p.chunks)||p.chunks.length>20||typeof p.truncated!=='boolean'||!/^(0|[1-9][0-9]*)$/.test(text(p.watermark,19)))throw new Error('INVALID_INPUT');
     for(const value of p.chunks){
       const chunk=record(value);fields(chunk,['seq','artifactId','sha256','bytes']);revision(chunk.seq);uuid(chunk.artifactId);sha(chunk.sha256);
       if(!Number.isInteger(chunk.bytes)||Number(chunk.bytes)<1||Number(chunk.bytes)>8192)throw new Error('INVALID_INPUT');
     }
   }
   if(p.base64!==undefined){
     uuid(p.artifactId);sha(p.sha256);
     if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(text(p.base64,10924))||!Number.isInteger(p.offset)||!Number.isInteger(p.totalBytes)||
       Number(p.offset)<0||Number(p.offset)>=Number(p.totalBytes)||Number(p.totalBytes)>262144)throw new Error('INVALID_INPUT');
   }
   return out;
 }catch{throw new Error('CLIENT_PROTOCOL_ERROR');}
}
