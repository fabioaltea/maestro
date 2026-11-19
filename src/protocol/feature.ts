import {requireUuid,requireDecimal} from '../domain/identifiers.js';
import {featureFields,featureObject,featureText} from '../domain/features/bundle.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import type {WorkflowOperationRecord} from '../ports/workflow.js';
export const FEATURE_READ_METHODS=['feature.get','feature.list','feature.revisions.list','feature.revision.get','feature.approval.get','feature.envelope.get','feature.eligibility.get','feature.operation.get','feature.artifact.get','feature.artifact.budget','feature.provider.get','feature.planning.get','feature.questions.list','feature.output.list'] as const;
export const FEATURE_ACTIONS=['create','revise','archive','approve','handoff','generate','answer','cancel'] as const;
export type FeatureAction=typeof FEATURE_ACTIONS[number];
export const FEATURE_ADMISSION_METHODS=[...FEATURE_ACTIONS.map(a=>`feature.${a}`),'feature.artifact.reserve','feature.artifact.append','feature.artifact.seal','feature.artifact.discard'] as const;
export const FEATURE_METHODS=[...FEATURE_READ_METHODS,'feature.prepare',...FEATURE_ADMISSION_METHODS] as const;
export function requireFeatureEnvelope(value:unknown):void {let json:string|undefined;try{json=JSON.stringify(value);}catch{throw new Error('INVALID_REQUEST');}if(json===undefined||Buffer.byteLength(json)>32768)throw new Error('CONTEXT_LIMIT');}
function uuid(value:unknown){try{requireUuid(value);}catch{throw new Error('INVALID_REQUEST');}}
function revision(value:unknown){try{requireDecimal(value);if(value==='0')throw new Error();}catch{throw new Error('INVALID_REQUEST');}}
const digest=(v:unknown)=>{if(typeof v!=='string'||!/^[a-f0-9]{64}$/.test(v))throw new Error('INVALID_REQUEST');};
function page(p:Record<string,unknown>){if(p.limit!==undefined&&(typeof p.limit!=='number'||!Number.isSafeInteger(p.limit)||p.limit<1||p.limit>20))throw new Error('INVALID_REQUEST');if(p.cursor!==undefined)featureText(p.cursor,4096,true);}
export function validateFeatureParams(method:string,input:unknown):void {
 const p=featureObject(input);requireFeatureEnvelope(p);
 if(method==='feature.prepare'){
 const a=p.action;const map:Record<string,readonly string[]>={create:['projectId','expectedConfigRevision','bundleArtifactId'],revise:['featureId','expectedStateRevision','bundleArtifactId'],approve:['featureId','expectedStateRevision','revisionId','acceptedUnknownIds'],handoff:['featureId','expectedStateRevision','revisionId'],archive:['featureId','expectedStateRevision'],generate:['featureId','expectedStateRevision'],answer:['featureId','expectedStateRevision','turnId','questionId','answerText'],cancel:['featureId','expectedStateRevision']};
 if(typeof a!=='string'||!Object.hasOwn(map,a))throw new Error('INVALID_REQUEST');featureFields(p,['action',...map[a]!]);
 for(const k of ['projectId','featureId','bundleArtifactId','revisionId','turnId'])if(p[k]!==undefined)uuid(p[k]);
 for(const k of ['expectedConfigRevision','expectedStateRevision'])if(p[k]!==undefined)revision(p[k]);
 if(p.acceptedUnknownIds!==undefined){if(!Array.isArray(p.acceptedUnknownIds)||p.acceptedUnknownIds.length>200||new Set(p.acceptedUnknownIds).size!==p.acceptedUnknownIds.length)throw new Error('INVALID_REQUEST');for(const id of p.acceptedUnknownIds)featureText(id,64,true);}
 if(a==='answer'){featureText(p.questionId,64,true);featureText(p.answerText,4096,true);}return;
 }
 if(FEATURE_ACTIONS.some(a=>method===`feature.${a}`)){
 featureFields(p,['requestId','grantId'],['featureId','projectId']);uuid(p.requestId);uuid(p.grantId);if(p.featureId!==undefined)uuid(p.featureId);if(p.projectId!==undefined)uuid(p.projectId);return;
 }
 if(method==='feature.artifact.reserve'){featureFields(p,['requestId','kind','expectedBytes','sha256'],['targetId']);uuid(p.requestId);if(!['BUNDLE','INPUT'].includes(String(p.kind))||typeof p.expectedBytes!=='number'||!Number.isSafeInteger(p.expectedBytes)||p.expectedBytes<1||p.expectedBytes>262144)throw new Error('INVALID_REQUEST');digest(p.sha256);if(p.targetId!==undefined&&p.targetId!==null)uuid(p.targetId);return;}
 if(method==='feature.artifact.append'){featureFields(p,['requestId','uploadId','offset','chunkSha256','base64']);uuid(p.requestId);uuid(p.uploadId);digest(p.chunkSha256);if(typeof p.offset!=='number'||!Number.isSafeInteger(p.offset)||p.offset<0||typeof p.base64!=='string'||p.base64.length>10924)throw new Error('INVALID_REQUEST');const b=Buffer.from(p.base64,'base64');if(b.length<1||b.length>8192||b.toString('base64')!==p.base64)throw new Error('INVALID_REQUEST');return;}
 if(method==='feature.artifact.seal'){featureFields(p,['requestId','uploadId','expectedBytes','sha256']);uuid(p.requestId);uuid(p.uploadId);digest(p.sha256);if(typeof p.expectedBytes!=='number'||!Number.isSafeInteger(p.expectedBytes)||p.expectedBytes<1||p.expectedBytes>262144)throw new Error('INVALID_REQUEST');return;}
 if(method==='feature.artifact.discard'){featureFields(p,['requestId','uploadId']);uuid(p.requestId);uuid(p.uploadId);return;}
 if(method==='feature.provider.get'||method==='feature.artifact.budget'){featureFields(p,[]);return;}
 if(method==='feature.eligibility.get'){featureFields(p,['featureId'],['checkId']);uuid(p.featureId);if(p.checkId!==undefined)uuid(p.checkId);return;}
 const singles:Record<string,string>={'feature.get':'featureId','feature.revision.get':'revisionId','feature.approval.get':'revisionId','feature.envelope.get':'envelopeId','feature.operation.get':'requestId','feature.artifact.get':'artifactId','feature.planning.get':'turnId'};
 if(singles[method]){const key=singles[method]!;featureFields(p,[key],method==='feature.artifact.get'?['cursor']:[]);uuid(p[key]);page(p);return;}
 const lists:Record<string,string>={'feature.list':'projectId','feature.revisions.list':'featureId','feature.questions.list':'featureId','feature.output.list':'turnId'};
 if(lists[method]){const key=lists[method]!;featureFields(p,[key],['limit','cursor']);uuid(p[key]);page(p);return;}
 throw new Error('UNSUPPORTED_VERSION');
}
export function publicFeatureOperation(o:WorkflowOperationRecord){
 const {requestId,namespace,action,phase,outcome,targetId,acceptedAt,completedAt,result,error}=o;
 const safeResult=result===null?null:Object.fromEntries(Object.entries(result).filter(([k,v])=>['featureId','revisionId','approvalId','envelopeId','artifactId','turnId','stateRevision','offsetBytes'].includes(k)&&(typeof v==='string'||typeof v==='number')));
 const visible={requestId,namespace,action,phase,outcome,targetId,acceptedAt,completedAt,result:safeResult,error:error===null?null:foundationError(error as ErrorCode,{persisted:true,operationId:requestId})};requireFeatureEnvelope(visible);return visible;
}
export function requireFeatureCapability(value:unknown):void{const p=featureObject(value);if(p.featureVersion!==1)throw new Error('UNSUPPORTED_VERSION');}
export function validateFeatureAdmission(value:unknown):void{const p=featureObject(value);featureFields(p,['accepted','requestId'],['featureId','revisionId','turnId','stateRevision','operationId']);if(p.accepted!==true)throw new Error('INVALID_REQUEST');uuid(p.requestId);for(const k of ['featureId','revisionId','turnId','operationId'])if(p[k]!==undefined)uuid(p[k]);if(p.stateRevision!==undefined)revision(p.stateRevision);requireFeatureEnvelope(p);}
export type PublicFeatureOperation=ReturnType<typeof publicFeatureOperation>;
export function decodeFeatureOperationView(value:unknown):PublicFeatureOperation{
 const p=featureObject(value);featureFields(p,['requestId','namespace','action','phase','outcome','targetId','acceptedAt','completedAt','result','error']);uuid(p.requestId);if(p.targetId!==null)uuid(p.targetId);
 if(!['FEATURE','ARTIFACT'].includes(String(p.namespace))||!['ACCEPTED','WORKING','FINALIZED'].includes(String(p.phase))||!['IN_PROGRESS','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED','UNKNOWN'].includes(String(p.outcome)))throw new Error('INVALID_REQUEST');
 const actions=p.namespace==='FEATURE'?[...FEATURE_ACTIONS]:['reserve','append','seal','discard'];if(!actions.includes(p.action as FeatureAction))throw new Error('INVALID_REQUEST');
 if((p.phase==='FINALIZED')!==(p.completedAt!==null)||p.phase==='FINALIZED'&&['IN_PROGRESS','UNKNOWN'].includes(String(p.outcome)))throw new Error('INVALID_REQUEST');
 for(const key of ['acceptedAt',...(p.completedAt===null?[]:['completedAt'])])if(typeof p[key]!=='string'||!Number.isFinite(Date.parse(p[key] as string)))throw new Error('INVALID_REQUEST');
 if(p.result!==null){const result=featureObject(p.result);featureFields(result,[],['featureId','revisionId','approvalId','envelopeId','artifactId','turnId','stateRevision','offsetBytes']);for(const [k,v] of Object.entries(result)){if(k==='stateRevision')revision(v);else if(k==='offsetBytes'){if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>262144)throw new Error('INVALID_REQUEST');}else uuid(v);}}
 if(p.error!==null){const e=featureObject(p.error);const expected=foundationError(e.code as ErrorCode,{persisted:true,operationId:p.requestId as string});featureFields(e,Object.keys(expected));if(Object.entries(expected).some(([k,v])=>e[k]!==v))throw new Error('INVALID_REQUEST');}
 requireFeatureEnvelope(p);return p as unknown as PublicFeatureOperation;
}
