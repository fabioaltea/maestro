import {featureFields,featureObject,featureText} from '../features/bundle.js';
import {requireUuid} from '../identifiers.js';
import {PROFILE_LIMITS} from './model.js';
import {parseProfilePermissions,permitsProfilePermissions,type ProfilePermissions} from './permissions.js';

export interface ProfileReference{readonly entityId:string;readonly revisionId:string}
export interface ProfileDocument{
 readonly alias:string;readonly title:string;readonly role:string;readonly instructions:string;
 readonly preferredProviders:readonly string[];readonly permissions:ProfilePermissions;
 readonly requiredRefs:readonly ProfileReference[];readonly recommendedRefs:readonly ProfileReference[];readonly toolRefs:readonly ProfileReference[];
 readonly validationRefs:readonly string[];
}
export function profileAlias(value:unknown){
 const alias=featureText(value,64,true);
 if(!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(alias))throw new Error('INVALID_REQUEST');
 return alias;
}
export function profileReferences(raw:unknown,limit:number):ProfileReference[]{
 if(!Array.isArray(raw)||raw.length>limit)throw new Error('INVALID_REQUEST');
 const values=raw.map(value=>{
   const p=featureObject(value);featureFields(p,['entityId','revisionId']);
   return{entityId:requireUuid(p.entityId),revisionId:requireUuid(p.revisionId)};
 });
 if(new Set(values.map(value=>value.entityId)).size!==values.length)throw new Error('PROFILE_CONFLICT');
 return values.sort((a,b)=>a.entityId.localeCompare(b.entityId,'en-US'));
}
export function parseProfileDocument(raw:unknown):ProfileDocument{
 const p=featureObject(raw);
 featureFields(p,['alias','title','role','instructions'],['preferredProviders','permissions','requiredRefs','recommendedRefs','toolRefs','validationRefs']);
 const identity=profileAlias(p.alias),title=featureText(p.title,100,true),role=featureText(p.role,64,true);
 if(/[\r\n]/.test(title+role))throw new Error('INVALID_REQUEST');
 const instructions=featureText(p.instructions,16384,true);
 const source=p.permissions===undefined?{allow:[],deny:[],required:[]}:featureObject(p.permissions);
 featureFields(source,['allow','deny','required']);
 const permissions={allow:parseProfilePermissions(source.allow),deny:parseProfilePermissions(source.deny),required:parseProfilePermissions(source.required)};
 if(!permitsProfilePermissions(permissions.allow,permissions.required)||permissions.required.some(item=>permissions.deny.includes(item)))throw new Error('PERMISSION_CONFLICT');
 const preferredProviders=p.preferredProviders??[];
 if(!Array.isArray(preferredProviders)||preferredProviders.length>2||preferredProviders.some(value=>!['codex','claude'].includes(value))||
   new Set(preferredProviders).size!==preferredProviders.length)throw new Error('INVALID_REQUEST');
 const requiredRefs=profileReferences(p.requiredRefs??[],PROFILE_LIMITS.skillRefs),recommendedRefs=profileReferences(p.recommendedRefs??[],PROFILE_LIMITS.skillRefs);
 if(requiredRefs.length+recommendedRefs.length>PROFILE_LIMITS.skillRefs||
   new Set([...requiredRefs,...recommendedRefs].map(ref=>ref.entityId)).size!==requiredRefs.length+recommendedRefs.length)throw new Error('PROFILE_CONFLICT');
 const rawValidation=p.validationRefs??[];
 if(!Array.isArray(rawValidation)||rawValidation.length>8)throw new Error('INVALID_REQUEST');
 const validationRefs=rawValidation.map(requireUuid).sort();
 if(new Set(validationRefs).size!==validationRefs.length)throw new Error('INVALID_REQUEST');
 return{alias:identity,title,role,instructions,permissions,preferredProviders,requiredRefs,recommendedRefs,toolRefs:profileReferences(p.toolRefs??[],PROFILE_LIMITS.toolRefs),validationRefs};
}
