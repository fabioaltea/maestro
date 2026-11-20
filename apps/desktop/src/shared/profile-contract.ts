import type {Params} from './bridge-contract.ts';
import {keys,record,revision,text,uuid} from './input.ts';
import {CORE_ERRORS} from './core-errors.ts';

export const PROFILE_MUTATIONS=['create','revise','disable','resolve','skill.preview','skill.import','skill.bind','tool.import','tool.enable','artifact.import'] as const;
export const PROFILE_QUERIES={
 listProfiles:'list',getProfile:'get',getProfileResolution:'resolution',getProfileOperation:'operation',getProfileArtifact:'artifact',
 getProfileCapabilities:'capabilities',getSkillPreview:'preview',suggestProfileExtensions:'suggest',
} as const;
export const PROFILE_BRIDGE_METHODS=['prepareProfileAction','confirmProfileAction','cancelProfileAction','chooseProfileSkill',...Object.keys(PROFILE_QUERIES) as (keyof typeof PROFILE_QUERIES)[]] as const;
const kind=(value:unknown)=>oneOf(value,['PROFILE','SKILL','TOOL']);
const digest=(value:unknown)=>{if(!/^[a-f0-9]{64}$/.test(text(value,64)))throw new Error('INVALID_INPUT');return value;};
const oneOf=(value:unknown,values:readonly string[])=>{
 if(typeof value!=='string'||!values.includes(value))throw new Error('INVALID_INPUT');
};
function fields(p:Params,required:readonly string[],optional:readonly string[]=[]){
 keys(p,[...required,...optional]);
 if(required.some(field=>!Object.hasOwn(p,field)))throw new Error('INVALID_INPUT');
}
function bundle(value:unknown){
 const p=record(value);
 fields(p,['alias','title','role','instructions'],['preferredProviders','permissions','requiredRefs','recommendedRefs','toolRefs','validationRefs']);
 text(p.alias,64);text(p.title,100);text(p.role,64);text(p.instructions,16384);
 if(new TextEncoder().encode(JSON.stringify(p)).length>24576)throw new Error('INVALID_INPUT');
 return p;
}
const permissionNames=['WORKSPACE_READ','WORKSPACE_WRITE','COMMAND_VALIDATE','TOOL_LOCAL','TOOL_MCP','NETWORK_LOOPBACK'];
function permissions(raw:unknown){
 if(!Array.isArray(raw)||raw.length>6||new Set(raw).size!==raw.length)throw new Error('INVALID_INPUT');
 for(const value of raw)oneOf(value,permissionNames);
}
function permissionDocument(raw:unknown){
 const p=record(raw);fields(p,['allow','deny','required']);permissions(p.allow);permissions(p.deny);permissions(p.required);
}
function profileRefs(raw:unknown){
 if(!Array.isArray(raw)||raw.length>20)throw new Error('INVALID_INPUT');
 for(const value of raw){const item=record(value);fields(item,['entityId','revisionId']);uuid(item.entityId);uuid(item.revisionId);}
}
export function profileBridgeAction(raw:unknown){
 const {action,...params}=record(raw);
 switch(action){
   case 'create':
     fields(params,['scope','bundle'],['projectId']);oneOf(params.scope,['GLOBAL','PROJECT']);bundle(params.bundle);
     if(params.scope==='PROJECT')uuid(params.projectId);else if(params.projectId!==undefined)throw new Error('INVALID_INPUT');
     break;
   case 'revise':
     fields(params,['entityId','stateRevision','bundle']);uuid(params.entityId);revision(params.stateRevision);bundle(params.bundle);break;
   case 'disable':
     fields(params,['entityId','stateRevision']);uuid(params.entityId);revision(params.stateRevision);break;
   case 'tool.import':{
     fields(params,['manifest']);
     const manifest=record(params.manifest);
     fields(manifest,['alias','title','version','kind','argvSchema','inputBytes','outputBytes','requiredPermissions','credentialRequirements','networkScope'],
       ['scope','projectId','commandSpecId','endpointRef']);
     if(manifest.kind==='LOCAL_COMMAND'&&manifest.endpointRef===undefined)uuid(manifest.commandSpecId);
     else if(manifest.kind==='MCP'&&manifest.commandSpecId===undefined)uuid(manifest.endpointRef);
     else throw new Error('INVALID_INPUT');
     permissions(manifest.requiredPermissions);
     if(new TextEncoder().encode(JSON.stringify(manifest)).length>16384)throw new Error('INVALID_INPUT');
     break;
   }
   case 'tool.enable':
     fields(params,['entityId','stateRevision','revisionId','permissions']);uuid(params.entityId);uuid(params.revisionId);revision(params.stateRevision);
     permissions(params.permissions);break;
   case 'skill.import':
     fields(params,['previewId','sourceDigest']);uuid(params.previewId);digest(params.sourceDigest);break;
   case 'skill.bind':
     fields(params,['entityId','stateRevision','revisionId','requiredRefs','recommendedRefs']);uuid(params.entityId);uuid(params.revisionId);revision(params.stateRevision);
     profileRefs(params.requiredRefs);profileRefs(params.recommendedRefs);break;
   case 'resolve':
     fields(params,['entityId','stateRevision','revisionId','projectId','providerCapabilityDigest']);
     uuid(params.entityId);revision(params.stateRevision);uuid(params.revisionId);uuid(params.projectId);digest(params.providerCapabilityDigest);break;
   default:throw new Error('INVALID_INPUT');
 }
 return{action,params};
}
export function validateProfileBridge(method:string,raw:Params){
 const {bridgeVersion:_version,callId:_call,selectionEpoch:_epoch,...p}=raw;
 switch(method){
   case 'prepareProfileAction':fields(p,['params']);profileBridgeAction(p.params);break;
   case 'confirmProfileAction':case 'cancelProfileAction':fields(p,['confirmationId']);uuid(p.confirmationId);break;
   case 'listProfiles':
     fields(p,['kind'],['projectId','cursor','limit']);kind(p.kind);
     if(p.projectId!==undefined)uuid(p.projectId);
     if(p.cursor!==undefined)text(p.cursor,4096);
     if(p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20))throw new Error('INVALID_INPUT');
     break;
   case 'getProfile':
     fields(p,['entityId'],['revisionId']);uuid(p.entityId);if(p.revisionId!==undefined)uuid(p.revisionId);break;
   case 'getProfileResolution':fields(p,['resolutionId']);uuid(p.resolutionId);break;
   case 'getProfileOperation':fields(p,['requestId']);uuid(p.requestId);break;
   case 'getProfileArtifact':
     fields(p,['artifactId'],['cursor']);uuid(p.artifactId);if(p.cursor!==undefined)text(p.cursor,4096);break;
   case 'getProfileCapabilities':fields(p,[]);break;
   case 'suggestProfileExtensions':fields(p,['profileId','projectId']);uuid(p.profileId);uuid(p.projectId);break;
   case 'getSkillPreview':fields(p,['previewId']);uuid(p.previewId);break;
   case 'chooseProfileSkill':
     fields(p,['scope'],['projectId','ownerProfileId']);oneOf(p.scope,['GLOBAL','PROJECT','PROFILE']);
     if(p.scope==='GLOBAL'&&(p.projectId!==undefined||p.ownerProfileId!==undefined)||p.scope==='PROJECT'&&(p.projectId===undefined||p.ownerProfileId!==undefined)||
       p.scope==='PROFILE'&&p.ownerProfileId===undefined)throw new Error('INVALID_INPUT');
     if(p.projectId!==undefined)uuid(p.projectId);
     if(p.ownerProfileId!==undefined)uuid(p.ownerProfileId);
     break;
   default:throw new Error('INVALID_INPUT');
 }
}
function profileRecord(value:unknown){
 const p=record(value);
 fields(p,['entityId','kind','scope','projectId','ownerProfileId','alias','state','stateRevision','revisionId','updatedAt']);
 uuid(p.entityId);kind(p.kind);oneOf(p.scope,['GLOBAL','PROJECT','PROFILE']);text(p.alias,64);revision(p.stateRevision);
 oneOf(p.state,['DRAFT','REVIEWED','ENABLED','DISABLED']);
 for(const field of ['projectId','ownerProfileId','revisionId'])if(p[field]!==null)uuid(p[field]);
 if(!Number.isFinite(Date.parse(text(p.updatedAt,64))))throw new Error('INVALID_INPUT');
 return p;
}
function operation(value:unknown,artifact:boolean){
 const op=record(value);
 fields(op,['requestId','namespace','action','targetId','phase','outcome','acceptedAt','completedAt','result','error'],artifact?['owningInstanceId','storeId','targetKind']:[]);
 uuid(op.requestId);
 if(artifact){if(op.namespace!=='ARTIFACT'||op.action!=='seal')throw new Error('INVALID_INPUT');}
 else{if(op.namespace!=='PROFILE')throw new Error('INVALID_INPUT');uuid(op.targetId);oneOf(op.action,PROFILE_MUTATIONS);}
 oneOf(op.phase,['ACCEPTED','WORKING','FINALIZED']);
 oneOf(op.outcome,op.phase==='FINALIZED'?['SUCCEEDED','FAILED','BLOCKED','INTERRUPTED']:['IN_PROGRESS','UNKNOWN']);
 if(op.result!==null){
   const result=record(op.result);keys(result,['entityId','revisionId','stateRevision','resolutionId','previewId','artifactId']);
   for(const [key,value] of Object.entries(result))key==='stateRevision'?revision(value):uuid(value);
 }
 return{...op,error:op.error===null?null:safeError(op.error)};
}
function safeError(value:unknown){
 const {code}=record(value);
 if(typeof code!=='string'||!Object.hasOwn(CORE_ERRORS,code))throw new Error('INVALID_INPUT');
 return CORE_ERRORS[code as keyof typeof CORE_ERRORS];
}
const allowedDocument=['title','role','preferredProviders','permissions','requiredPermissions','requiredRefs','recommendedRefs','toolRefs','validationRefs',
 'kind','endpointRef','commandSpecId','networkScope','sourceDigest','provenance','enabledPermissions','minRuntime'];
export function validateProfileData(action:string,raw:unknown):Params{
 try{
   const p=record(raw),out={...p};
   const shapes:Record<string,readonly string[]>={list:['items','nextCursor'],get:['record','revision'],operation:['operation'],resolution:['resolution','currentness'],
     artifact:['artifactId','sha256','totalBytes','offset','base64','nextCursor'],authorize:['grantId','expiresAtMs','canonicalIntentHash','summary'],
     capabilities:['capability'],preview:['preview'],'artifact.import':['operation','artifact'],'skill.preview':['operation','preview'],suggest:['suggestions']};
   const shape=Object.hasOwn(shapes,action)?shapes[action]:(PROFILE_MUTATIONS as readonly string[]).includes(action)?['operation']:undefined;
   if(!shape||new TextEncoder().encode(JSON.stringify(p)).length>32768)throw new Error('INVALID_INPUT');
   keys(p,[...shape,'storeId','freshness','error','code']);
   if(p.storeId!==undefined)uuid(p.storeId);
   if(p.error!==undefined&&p.error!==null)out.error=safeError(p.error);
   if(p.items!==undefined){
     if(!Array.isArray(p.items)||p.items.length>20)throw new Error('INVALID_INPUT');
     out.items=p.items.map(profileRecord);
   }
   if(p.record!==undefined)out.record=profileRecord(p.record);
   if(p.revision!==undefined&&p.revision!==null){
     const r=record(p.revision);fields(r,['revisionId','entityId','previousId','digest','artifactId','byteLength','document','createdAt']);
     uuid(r.revisionId);uuid(r.entityId);digest(r.digest);
     const doc=record(r.document);keys(doc,allowedDocument);
     if(doc.permissions!==undefined)permissionDocument(doc.permissions);
     for(const field of ['requiredPermissions','enabledPermissions'])if(doc[field]!==undefined)permissions(doc[field]);
     for(const field of ['requiredRefs','recommendedRefs','toolRefs'])if(doc[field]!==undefined)profileRefs(doc[field]);
   }
   if(p.preview!==undefined){
     const view=record(p.preview);fields(view,['previewId','scope','projectId','ownerProfileId','alias','sourceDigest','artifactId','byteLength','files',
       'requiredPermissions','provenance','expiresAtMs']);
     permissions(view.requiredPermissions);uuid(view.previewId);uuid(view.artifactId);digest(view.sourceDigest);text(view.alias,64);oneOf(view.provenance,['UNKNOWN','USER_REVIEWED']);
     if(!Array.isArray(view.files)||view.files.length>17)throw new Error('INVALID_INPUT');
     for(const value of view.files){
       const file=record(value);fields(file,['path','sha256','bytes']);text(file.path,120);digest(file.sha256);
       if(!Number.isInteger(file.bytes)||Number(file.bytes)<0||Number(file.bytes)>65536)throw new Error('INVALID_INPUT');
     }
   }
   if(p.operation!==undefined)out.operation=operation(p.operation,action==='artifact.import');
   if(p.artifact!==undefined){
     const a=record(p.artifact);
     fields(a,['artifactId','expectedBytes','sha256','offsetBytes','state']);
     uuid(a.artifactId);digest(a.sha256);if(a.state!=='SEALED'||!Number.isInteger(a.expectedBytes)||Number(a.expectedBytes)>262144||Number(a.expectedBytes)<1||a.offsetBytes!==a.expectedBytes)throw new Error('INVALID_INPUT');
   }
   if(p.capability!==undefined){
     const c=record(p.capability);fields(c,['policyRevision','allow','deny','digest']);digest(c.digest);revision(c.policyRevision);
     permissions(c.allow);permissions(c.deny);
   }
   if(p.summary!==undefined){
     const summary=record(p.summary);
     fields(summary,['action','entityId','projectId','stateRevision'],['alias','scope','artifactDigest','permissions','revisionId','previewId','sourceDigest','kind','requiredRefs','recommendedRefs']);
     uuid(summary.entityId);uuid(p.grantId);digest(p.canonicalIntentHash);oneOf(summary.action,PROFILE_MUTATIONS);
     if(summary.projectId!==null)uuid(summary.projectId);
     if(summary.stateRevision!==null)revision(summary.stateRevision);
     if(summary.alias!==undefined)text(summary.alias,64);
     if(summary.permissions!==undefined){
       if(Array.isArray(summary.permissions))permissions(summary.permissions);else permissionDocument(summary.permissions);
     }
     if(summary.requiredRefs!==undefined)profileRefs(summary.requiredRefs);
     if(summary.recommendedRefs!==undefined)profileRefs(summary.recommendedRefs);
   }
   if(p.suggestions!==undefined){
     if(!Array.isArray(p.suggestions)||p.suggestions.length>20)throw new Error('INVALID_INPUT');
     for(const value of p.suggestions){
       const suggestion=record(value);fields(suggestion,['entityId','revisionId','alias','kind','reason']);
       uuid(suggestion.entityId);uuid(suggestion.revisionId);text(suggestion.alias,64);oneOf(suggestion.kind,['SKILL','TOOL']);
       oneOf(suggestion.reason,['PERMISSIONS_COMPATIBLE']);
     }
   }
   if(p.resolution!==undefined){
     const r=record(p.resolution);fields(r,['resolutionId','profileId','revisionId','projectId','projectRevision','capabilityDigest','digest','snapshot','dependencyVersions','createdAt']);
     uuid(r.resolutionId);uuid(r.profileId);digest(r.digest);
     keys(record(r.snapshot),['schemaVersion','policyRevision','profileId','profileRevisionId','profileDigest','projectId','projectRevision','providerCapabilityDigest',
       'effectivePermissions','skills','tools','omitted','validationRefs','preferredProviders']);
     permissions(record(r.snapshot).effectivePermissions);
     if(!Array.isArray(r.dependencyVersions)||r.dependencyVersions.length>31)throw new Error('INVALID_INPUT');
   }
   if(p.base64!==undefined){
     uuid(p.artifactId);digest(p.sha256);
     if(!/^[a-zA-Z0-9+/]+={0,2}$/.test(text(p.base64,10924))||!Number.isSafeInteger(p.offset)||!Number.isSafeInteger(p.totalBytes)||
       Number(p.offset)<0||Number(p.offset)>=Number(p.totalBytes)||Number(p.totalBytes)>262144)throw new Error('INVALID_INPUT');
   }
   if(p.nextCursor!==undefined&&p.nextCursor!==null)text(p.nextCursor,4096);
   return out;
 }catch{throw new Error('CLIENT_PROTOCOL_ERROR');}
}
