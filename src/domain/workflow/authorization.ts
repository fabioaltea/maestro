import { requireUuid,requireDecimal } from '../identifiers.js';
import { featureObject,featureFields,featureText } from '../features/bundle.js';
export type WorkflowNamespace='FEATURE'|'ARTIFACT'|'WORKSPACE'|'ENVIRONMENT'|'PROFILE'|'EXECUTION'|'SCHEDULER'|'REVIEW';
export interface WorkflowIntent {
 readonly version:1;readonly storeId:string;readonly ownerUid:number;readonly namespace:WorkflowNamespace;readonly action:string;
 readonly targetId:string|null;readonly projectId:string|null;readonly expectedRevision:string|null;readonly configRevision:string|null;readonly payload:Readonly<Record<string,unknown>>;
}
export interface WorkflowGrant {readonly grantId:string;readonly canonicalIntent:string;readonly createdAtMs:number;readonly expiresAtMs:number;readonly consumedByRequestId:string|null}
function sorted(value:unknown,depth=0):unknown {
 if(depth>8)throw new Error('INVALID_REQUEST');
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string'){featureText(value,32768);return value;}
 if(typeof value==='number'&&Number.isSafeInteger(value))return value;
 if(Array.isArray(value)){if(value.length>200)throw new Error('INVALID_REQUEST');return value.map(v=>sorted(v,depth+1));}
 const p=featureObject(value);if(Object.keys(p).length>40)throw new Error('INVALID_REQUEST');
 return Object.fromEntries(Object.keys(p).sort().map(k=>{if(['__proto__','constructor','prototype'].includes(k))throw new Error('INVALID_REQUEST');return[k,sorted(p[k],depth+1)];}));
}
export function canonicalWorkflowIntent(value:unknown):string {
 const i=featureObject(value);featureFields(i,['version','storeId','ownerUid','namespace','action','targetId','projectId','expectedRevision','configRevision','payload']);
 if(i.version!==1||!Number.isSafeInteger(i.ownerUid)||(i.ownerUid as number)<0||!['FEATURE','ARTIFACT','WORKSPACE','ENVIRONMENT','PROFILE','EXECUTION','SCHEDULER','REVIEW'].includes(String(i.namespace)))throw new Error('INVALID_REQUEST');
 requireUuid(i.storeId);for(const k of ['targetId','projectId'])if(i[k]!==null)requireUuid(i[k]);
 for(const k of ['expectedRevision','configRevision'])if(i[k]!==null){requireDecimal(i[k]);if(i[k]==='0')throw new Error('INVALID_REQUEST');}
 featureText(i.action,64,true);featureObject(i.payload);
 const result=JSON.stringify(sorted(i));featureText(result,32768,true);return result;
}
export function validateWorkflowGrant(grant:WorkflowGrant,canonicalIntent:string,requestId:string,nowMs:number):'CONSUME'|'REPLAY' {
 requireUuid(grant.grantId);requireUuid(requestId);
 if(grant.canonicalIntent!==canonicalIntent)throw new Error('APPROVAL_REQUIRED');
 if(grant.consumedByRequestId===requestId)return 'REPLAY';
 if(grant.consumedByRequestId!==null)throw new Error('APPROVAL_REQUIRED');
 if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(grant.createdAtMs)||!Number.isSafeInteger(grant.expiresAtMs)||grant.expiresAtMs-grant.createdAtMs>300000||nowMs<grant.createdAtMs||nowMs>=grant.expiresAtMs)throw new Error('APPROVAL_STALE');
 return 'CONSUME';
}
