import type {Params} from './bridge-contract.ts';
import {CORE_ERRORS} from './core-errors.ts';
export const FEATURE_ACTIONS=['create','revise','archive'] as const;
export const FEATURE_MUTATIONS=[...FEATURE_ACTIONS,'artifact.import'] as const;
export const FEATURE_QUERIES:Readonly<Record<string,{action:string;key?:string;page?:boolean}>>={listFeatures:{action:'list',key:'projectId',page:true},getFeature:{action:'get',key:'featureId'},getFeatureRevisions:{action:'revisions',key:'featureId',page:true},getFeatureRevision:{action:'revision',key:'revisionId'},getFeatureArtifact:{action:'artifact.get',key:'artifactId',page:true},getFeatureOperation:{action:'operation',key:'requestId'},getFeatureProvider:{action:'provider.get'}};
export const FEATURE_BRIDGE_METHODS=['chooseFeatureBundle','importFeatureBundle','prepareFeatureAction','confirmFeatureAction','cancelFeatureAction','listFeatures','getFeature','getFeatureRevisions','getFeatureRevision','getFeatureArtifact','getFeatureOperation','getFeatureProvider'] as const;
function fail():never{throw new Error('INVALID_INPUT');}
function obj(v:unknown):Params{if(!v||typeof v!=='object'||Array.isArray(v)||![Object.prototype,null].includes(Object.getPrototypeOf(v)))return fail();return v as Params;}
function fields(p:Params,required:readonly string[],optional:readonly string[]=[]){if(required.some(k=>!Object.hasOwn(p,k))||Object.keys(p).some(k=>!required.includes(k)&&!optional.includes(k)))fail();}
function str(v:unknown,max=4096){if(typeof v!=='string'||!v.length||!v.isWellFormed()||v.includes('\0')||new TextEncoder().encode(v).length>max)return fail();return v;}
function id(v:unknown){if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(str(v,36)))fail();}
function rev(v:unknown){if(!/^[1-9][0-9]*$/.test(str(v,19))||BigInt(v as string)>9223372036854775807n)fail();}
export function validateFeatureAction(action:unknown,raw:unknown):Params{
 const p=obj(raw);
 if(action==='feature.artifact.import'){fields(p,[],['bundle','bundleHandle']);if(!!p.bundle===!!p.bundleHandle)fail();if(p.bundle!==undefined)str(p.bundle,24000);else id(p.bundleHandle);return p;}
 const a=String(action).replace(/^feature\./,'');if(!(FEATURE_ACTIONS as readonly string[]).includes(a))return fail();
 const map:Record<string,string[]>={create:['projectId','expectedConfigRevision','bundleArtifactId'],revise:['featureId','expectedStateRevision','bundleArtifactId'],archive:['featureId','expectedStateRevision']};fields(p,map[a]!);
 for(const [k,v]of Object.entries(p))if(k.endsWith('Revision'))rev(v);else id(v);return p;
}
export function validateFeatureBridge(method:string,p:Params){
 const base=['bridgeVersion','callId','selectionEpoch'];
 if(method==='chooseFeatureBundle')fields(p,base);
 else if(method==='importFeatureBundle'){fields(p,base,['bundle','bundleHandle']);const{bridgeVersion:_v,callId:_c,selectionEpoch:_e,...body}=p;validateFeatureAction('feature.artifact.import',body);}
 else if(method==='prepareFeatureAction'){fields(p,[...base,'params']);const params=obj(p.params),{action,...body}=params;validateFeatureAction(`feature.${action}`,body);}
 else if(method==='confirmFeatureAction'||method==='cancelFeatureAction'){fields(p,[...base,'confirmationId']);id(p.confirmationId);}
 else{const q=FEATURE_QUERIES[method];if(!q)return fail();fields(p,[...base,...(q.key?[q.key]:[])],q.page?['cursor',...(q.action==='artifact.get'?[]:['limit'])]:[]);if(q.key)id(p[q.key]);if(p.cursor!==undefined)str(p.cursor);if(p.limit!==undefined&&(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20))fail();}
}
const safeKeys=new Set(('feature featureId projectId title state stateRevision currentRevisionId createdAt updatedAt archivedAt revision revisionId revisionNumber parentRevisionId artifactId bundleDigest discoveryApprovalId discoveryRevisionId contextDigest configRevision items nextCursor freshness storeId observabilityDegraded code error artifact operation requestId namespace action phase outcome targetId acceptedAt completedAt result offsetBytes sha256 expectedBytes base64 totalBytes offset accepted capabilities readonlyPlanning qualified reason').split(' '));
function safe(v:unknown,key='',depth=0):unknown{
 if(depth>10)return fail();if(v===null||typeof v==='boolean')return v;
 if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<0)fail();return v;}
 if(typeof v==='string'){str(v,key==='base64'?10924:8192);if(key.endsWith('Id')&&key!=='sourceId')id(v);if(key.endsWith('Revision')||key==='revisionNumber')rev(v);return v;}
 if(Array.isArray(v)){if(v.length>20)fail();return v.map(x=>safe(x,'',depth+1));}
 const p=obj(v),out:Params={};for(const[k,x]of Object.entries(p)){if(!safeKeys.has(k))fail();if(k==='error'&&x!==null){const code=typeof x==='string'?x:obj(x).code;if(typeof code!=='string'||!Object.hasOwn(CORE_ERRORS,code))fail();out[k]=typeof x==='string'?code:CORE_ERRORS[code as keyof typeof CORE_ERRORS];}else out[k]=safe(x,k,depth+1);}return out;
}
export function validateFeatureData(action:string,raw:unknown):Params{
 try{const p=obj(raw);if(new TextEncoder().encode(JSON.stringify(p)).length>32768)fail();
 if(action==='prepare'){fields(p,['grantId','canonicalIntent','expiresAtMs','summary'],['storeId','observabilityDegraded']);id(p.grantId);str(p.canonicalIntent,32768);if(!Number.isSafeInteger(p.expiresAtMs))fail();obj(p.summary);return p;}
 const expected=action==='get'?['feature']:action==='revision'?['revision']:action==='operation'?['operation']:action==='artifact.get'?['artifactId','sha256','totalBytes','offset','base64','nextCursor']:action==='provider.get'?['capabilities','reason']:['list','revisions'].includes(action)?['items','nextCursor']:['accepted','requestId','featureId','revisionId','turnId','stateRevision','operation','artifact'];
 fields(p,[],[...expected,'freshness','storeId','observabilityDegraded','code','error']);
 if(p.operation!==undefined){const o=obj(p.operation);fields(o,['requestId','namespace','action','phase','outcome','targetId','acceptedAt','completedAt','result','error']);id(o.requestId);if(!['FEATURE','ARTIFACT'].includes(String(o.namespace))||!['ACCEPTED','WORKING','FINALIZED'].includes(String(o.phase))||!['IN_PROGRESS','UNKNOWN','SUCCEEDED','FAILED','BLOCKED','INTERRUPTED'].includes(String(o.outcome))||(o.phase==='FINALIZED')!==(o.completedAt!==null)||o.phase==='FINALIZED'&&['IN_PROGRESS','UNKNOWN'].includes(String(o.outcome)))fail();}
 return safe(p) as Params;
 }catch{throw new Error('CLIENT_PROTOCOL_ERROR');}
}
