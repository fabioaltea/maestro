import type {Params} from './bridge-contract.ts';
import {keys,record,revision,text,uuid} from './input.ts';
import {CORE_ERRORS} from './core-errors.ts';

export const EXECUTION_QUERIES={
 listExecutionSessions:'list',getExecutionSession:'get',listExecutionOutput:'output.list',getExecutionArtifact:'artifact',
 getExecutionProvider:'provider.get',
} as const;
export const EXECUTION_BRIDGE_METHODS=['listExecutionSessions','getExecutionSession','listExecutionOutput','getExecutionArtifact',
 'getExecutionProvider','prepareExecutionAction','confirmExecutionAction','cancelExecutionAction'] as const;
export const EXECUTION_MUTATIONS=['provider.configure','provider.check','start','answer','pause','cancel','checkpoint','resume','reconcile'] as const;
const actions:Record<typeof EXECUTION_MUTATIONS[number],readonly string[]>={
 'provider.configure':['providerId','binaryHandle','modelId','authProfileRef','configRevision'],
 'provider.check':['providerId','expectedConfigRevision'],start:['featureId','workspaceId','profileResolutionId','envelopeId'],
 answer:['interactionId','expectedRevision','answerArtifactId'],pause:['sessionId','expectedStateRevision'],
 cancel:['sessionId','expectedStateRevision'],checkpoint:['sessionId','expectedStateRevision'],
 resume:['sessionId','checkpointId','providerId','stateRevision'],reconcile:['sessionId'],
};
export function executionProvider(value:unknown){
 if(value!=='codex'&&value!=='claude')throw new Error('INVALID_INPUT');
 return value;
}
export function executionBridgeAction(value:unknown){
 const raw=record(value),action=String(raw.action) as keyof typeof actions;
 if(!Object.hasOwn(actions,action))throw new Error('INVALID_INPUT');
 keys(raw,['action',...actions[action]]);
 const {action:_route,...params}=raw;
 for(const name of actions[action]){
   const value=params[name];
   if(name==='providerId')executionProvider(value);
   else if(name==='modelId'){
     if(!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(text(value,96)))throw new Error('INVALID_INPUT');
   }else if(name.toLowerCase().endsWith('revision')){
     if(name!=='configRevision'||value!==null)revision(value);
   }else uuid(value);
 }
 return{action,params};
}
export function validateExecutionBridge(method:string,p:Params){
 const common=['bridgeVersion','callId','selectionEpoch'];
 switch(method){
   case 'listExecutionSessions':
     keys(p,[...common,'projectId','cursor','activeOnly']);uuid(p.projectId);
     if(p.activeOnly!==undefined&&(p.activeOnly!==true||p.cursor!==undefined))throw new Error('INVALID_INPUT');
     break;
   case 'getExecutionSession':
     keys(p,[...common,'sessionId']);uuid(p.sessionId);break;
   case 'listExecutionOutput':
     keys(p,[...common,'runId','cursor']);uuid(p.runId);break;
   case 'getExecutionArtifact':
     keys(p,[...common,'artifactId','cursor']);uuid(p.artifactId);break;
   case 'getExecutionProvider':
     keys(p,[...common,'providerId']);executionProvider(p.providerId);break;
   case 'prepareExecutionAction':
     keys(p,[...common,'params']);executionBridgeAction(p.params);break;
   case 'confirmExecutionAction':case 'cancelExecutionAction':
     keys(p,[...common,'confirmationId']);uuid(p.confirmationId);break;
   default:throw new Error('INVALID_INPUT');
 }
 if(p.cursor!==undefined)text(p.cursor,1024);
}
const sessionStates=['CREATED','RUNNING','WAITING_USER','PAUSING','PAUSED','CANCELLING','CANCELLED','READY_FOR_REVIEW','FAILED','INTERRUPTED','RECONCILING'];
const outcomes=['IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED','UNKNOWN'];
function enumValue(value:unknown,allowed:readonly string[]){
 if(typeof value!=='string'||!allowed.includes(value))throw new Error('CLIENT_PROTOCOL_ERROR');
}
function idFields(p:Params,names:readonly string[]){for(const name of names)uuid(p[name]);}
function digest(v:unknown){if(!/^[a-f0-9]{64}$/.test(text(v,64)))throw new Error('CLIENT_PROTOCOL_ERROR');}
function decimal(v:unknown){if(!/^(0|[1-9][0-9]{0,18})$/.test(text(v,19)))throw new Error('CLIENT_PROTOCOL_ERROR');}
function page(value:unknown,maximum:number){if(!Array.isArray(value)||value.length>maximum)throw new Error('CLIENT_PROTOCOL_ERROR');return value.map(record);}
function session(value:unknown){
 const p=record(value);
 keys(p,['sessionId','featureId','workspaceId','projectId','profileResolutionId','envelopeId','state','stateRevision','runId','checkpointId','createdAt','updatedAt']);
 idFields(p,['sessionId','featureId','workspaceId','projectId','profileResolutionId','envelopeId','runId']);
 if(p.checkpointId!==null)uuid(p.checkpointId);
 revision(p.stateRevision);enumValue(p.state,sessionStates);text(p.createdAt,64);text(p.updatedAt,64);return p;
}
export interface ExecutionAgentRun {
  runId: string; providerId: 'codex' | 'claude'; modelId: string | null; phase: string; featureTitle: string | null;
}
function agent(value:unknown,runId:unknown,providerId?:unknown,phase?:unknown){
 const r=record(value);
 keys(r,['runId','providerId','modelId','phase','featureTitle']);
 if(uuid(r.runId)!==runId || providerId!==undefined&&r.providerId!==providerId || phase!==undefined&&r.phase!==phase)
   throw new Error('CLIENT_PROTOCOL_ERROR');
 executionProvider(r.providerId);
 if(r.modelId!==null&&!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(text(r.modelId,96)))throw new Error('CLIENT_PROTOCOL_ERROR');
 if(r.featureTitle!==null)text(r.featureTitle,512);
 enumValue(r.phase,['PREPARED','HOST_READY','START_AUTHORIZED','RUNNING','EXIT_OBSERVED','FINALIZED']);
}
export function validateExecutionData(action:string,value:unknown):Params{
 const p=record(value);
 if(new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('CLIENT_PROTOCOL_ERROR');
 const {storeId:_,observabilityDegraded:_degraded,freshness,code,error:rawError,...rest}=p;
 const meta={...(p.storeId===undefined?{}:{storeId:uuid(p.storeId)}),...(freshness===undefined?{}:{freshness:enumChecked(freshness,['CURRENT','LAST_KNOWN'])})};
 if(code!==undefined){const error=safe(code);return{...meta,code:error.code,error};}
 if(rawError!==undefined)throw new Error('CLIENT_PROTOCOL_ERROR');
 if(!Object.keys(rest).length)return meta;
 if(rest.operation!==undefined){
   keys(rest,['operation']);const o=record(rest.operation);
   keys(o,['namespace','action','phase','outcome','requestId','targetId','acceptedAt','completedAt','result','error']);
   if(o.namespace!=='EXECUTION')throw new Error('CLIENT_PROTOCOL_ERROR');
   enumValue(o.action,EXECUTION_MUTATIONS);enumValue(o.phase,['ACCEPTED','WORKING','FINALIZED']);enumValue(o.outcome,outcomes);
   uuid(o.requestId);if(o.targetId!==null)uuid(o.targetId);
   text(o.acceptedAt,64);if(o.completedAt!==null)text(o.completedAt,64);
   if(o.result!==null){
     const r=record(o.result);
     keys(r,['sessionId','runId','generation','answerId','checkpointId','digest','providerId','status','configRevision','capabilityDigest','state']);
     for(const [key,v] of Object.entries(r)){
       if(key==='providerId')executionProvider(v);
       else if(key.endsWith('Id')||key==='generation')uuid(v);
       else if(key==='configRevision')revision(v);
       else if(key==='state')enumValue(v,sessionStates);
       else if(key==='status')enumValue(v,['UNQUALIFIED','QUALIFIED','BLOCKED']);
       else if(v!==null||key!=='capabilityDigest')digest(v);
     }
   }
   return{...meta,operation:{...o,error:o.error===null?null:safe(record(o.error).code)}};
 }
 switch(action){
   case 'authorize':{
     keys(rest,['grantId','canonicalIntentHash','expiresAt','summary']);
     uuid(rest.grantId);digest(rest.canonicalIntentHash);
     if(!Number.isSafeInteger(rest.expiresAt))throw new Error('CLIENT_PROTOCOL_ERROR');
     const summary=record(rest.summary);
     keys(summary,['action','targetId','projectId','expectedRevision','configRevision','payload']);
     enumValue(summary.action,EXECUTION_MUTATIONS);
     for(const key of ['projectId','targetId'])if(summary[key]!==null)uuid(summary[key]);
     for(const key of ['expectedRevision','configRevision'])if(summary[key]!==null)revision(summary[key]);
     const payload=record(summary.payload);
     keys(payload,['providerId','modelId','featureId','workspaceId','envelopeId','profileResolutionId','capabilityDigest','featureRevision',
       'workspaceRevision','environmentRevision','profileDigest','inputDigest','treeDigest','checkpointId','digest','patchArtifactId',
       'runId','generation','answerArtifactId','answerDigest']);
     for(const [key,v] of Object.entries(payload)){
       if(key==='providerId')executionProvider(v);
       else if(key==='modelId')text(v,96);
       else if(key.endsWith('Revision'))revision(v);
       else if(key.endsWith('Digest')||key==='digest')digest(v);
       else uuid(v);
     }
     break;
   }
   case 'list':{
     keys(rest,['items','nextCursor','agent']);const items=page(rest.items,20).map(session);
     if(rest.agent!==undefined){
       if(items.length>1||rest.nextCursor!==null||((rest.agent===null)!==(items.length===0)))throw new Error('CLIENT_PROTOCOL_ERROR');
       if(rest.agent!==null)agent(rest.agent,items[0]?.runId);
     }
     break;
   }
   case 'get':{
     keys(rest,['session','run','checkpoint','interactions','checkedAt','agent']);
     const s=session(rest.session),r=record(rest.run);
     keys(r,['runId','sessionId','generation','providerId','configRevision','phase','outcome','requested','outputWatermark','truncated']);
     idFields(r,['runId','sessionId','generation']);executionProvider(r.providerId);revision(r.configRevision);decimal(r.outputWatermark);
     if(r.runId!==s.runId||r.sessionId!==s.sessionId||typeof r.truncated!=='boolean')throw new Error('CLIENT_PROTOCOL_ERROR');
     enumValue(r.phase,['PREPARED','HOST_READY','START_AUTHORIZED','RUNNING','EXIT_OBSERVED','FINALIZED']);enumValue(r.outcome,outcomes);
     if(rest.agent!==undefined)agent(rest.agent,r.runId,r.providerId,r.phase);
     if(r.requested!==null)enumValue(r.requested,['PAUSE','CANCEL']);
     if(rest.checkpoint!==null){
       const c=record(rest.checkpoint);
       keys(c,['checkpointId','sessionId','runId','inputDigest','treeDigest','patchArtifactId','digest','createdAt']);
       idFields(c,['checkpointId','sessionId','runId','patchArtifactId']);digest(c.inputDigest);digest(c.treeDigest);digest(c.digest);text(c.createdAt,64);
       if(c.sessionId!==s.sessionId||c.checkpointId!==s.checkpointId)throw new Error('CLIENT_PROTOCOL_ERROR');
     }
     for(const q of page(rest.interactions,20)){
       keys(q,['interactionId','runId','generation','expectedRevision','textArtifactId','type','status','answerArtifactId']);
       idFields(q,['interactionId','runId','generation','textArtifactId']);revision(q.expectedRevision);
       if(q.runId!==r.runId||q.generation!==r.generation)throw new Error('CLIENT_PROTOCOL_ERROR');
       enumValue(q.type,['QUESTION','TOOL_REQUEST']);enumValue(q.status,['OPEN','ANSWERED']);if(q.answerArtifactId!==null)uuid(q.answerArtifactId);
     }
     text(rest.checkedAt,64);break;
   }
   case 'output.list':
     keys(rest,['runId','chunks','watermark','truncated','nextCursor']);uuid(rest.runId);decimal(rest.watermark);
     if(typeof rest.truncated!=='boolean')throw new Error('CLIENT_PROTOCOL_ERROR');
     for(const chunk of page(rest.chunks,20)){
       keys(chunk,['seq','artifactId','sha256','bytes']);decimal(chunk.seq);uuid(chunk.artifactId);digest(chunk.sha256);
       if(!Number.isInteger(chunk.bytes)||Number(chunk.bytes)<1||Number(chunk.bytes)>8192)throw new Error('CLIENT_PROTOCOL_ERROR');
     }
     break;
   case 'artifact':
     keys(rest,['artifactId','sha256','totalBytes','offset','base64','nextCursor']);uuid(rest.artifactId);digest(rest.sha256);
     if(!Number.isInteger(rest.totalBytes)||Number(rest.totalBytes)<1||Number(rest.totalBytes)>262144||
        !Number.isInteger(rest.offset)||Number(rest.offset)<0||Number(rest.offset)>=Number(rest.totalBytes)||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(text(rest.base64,10924))||atob(String(rest.base64)).length>8192)throw new Error('CLIENT_PROTOCOL_ERROR');
     break;
   case 'provider.get':{
     keys(rest,['provider']);const provider=record(rest.provider);
     keys(provider,['providerId','configRevision','modelId','status','capabilityDigest','safeError','nativeResume']);
     executionProvider(provider.providerId);enumValue(provider.status,['UNCONFIGURED','UNQUALIFIED','QUALIFIED','BLOCKED']);
     if(provider.nativeResume!==false)throw new Error('CLIENT_PROTOCOL_ERROR');
     if(provider.configRevision!==null)revision(provider.configRevision);
     if(provider.modelId!==undefined)text(provider.modelId,96);
     if(provider.capabilityDigest!=null)digest(provider.capabilityDigest);
     if(provider.safeError!=null)safe(provider.safeError);
     break;
   }
   default:throw new Error('CLIENT_PROTOCOL_ERROR');
 }
 if(rest.nextCursor!=null)text(rest.nextCursor,1024);
 return{...meta,...rest};
}
function enumChecked(v:unknown,values:readonly string[]){enumValue(v,values);return v;}
function safe(value:unknown){
 if(typeof value!=='string'||!Object.hasOwn(CORE_ERRORS,value))throw new Error('CLIENT_PROTOCOL_ERROR');
 return CORE_ERRORS[value as keyof typeof CORE_ERRORS];
}
