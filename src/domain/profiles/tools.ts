import {featureFields,featureObject,featureText} from '../features/bundle.js';
import {requireUuid} from '../identifiers.js';
import {parseProfilePermissions,permitsProfilePermissions} from './permissions.js';
import {profileAlias} from './resolve.js';

export function parseToolManifest(raw:unknown){
 const p=featureObject(raw),local=p.kind==='LOCAL_COMMAND';
 if(!local&&p.kind!=='MCP')throw new Error('INVALID_REQUEST');
 featureFields(p,['alias','title','version','kind',local?'commandSpecId':'endpointRef','argvSchema','inputBytes','outputBytes',
   'requiredPermissions','credentialRequirements','networkScope'],['scope','projectId']);
 const alias=profileAlias(p.alias),title=featureText(p.title,100,true),version=featureText(p.version,32,true);
 if(!/^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}$/.test(version)||/[\r\n]/.test(title))throw new Error('INVALID_REQUEST');
 const scope=p.scope??'GLOBAL';
 if(scope!=='GLOBAL'&&scope!=='PROJECT'||scope==='GLOBAL'&&Object.hasOwn(p,'projectId'))throw new Error('INVALID_REQUEST');
 const projectId=scope==='PROJECT'?requireUuid(p.projectId):null;
 const mode=p.kind as 'LOCAL_COMMAND'|'MCP',ref=requireUuid(local?p.commandSpecId:p.endpointRef);
 const max=(value:unknown,limit:number)=>{
   if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>limit)throw new Error('INVALID_REQUEST');
   return value;
 };
 if(!Array.isArray(p.argvSchema)||p.argvSchema.length>8)throw new Error('INVALID_REQUEST');
 const names=new Set<string>();
 const argvSchema=p.argvSchema.map(value=>{
   const field=featureObject(value);featureFields(field,['name','type','required'],['maxBytes']);
   const name=featureText(field.name,32,true),type=field.type;
   if(!/^[a-z][a-z0-9_-]{0,31}$/.test(name)||names.has(name)||typeof field.required!=='boolean'||!['STRING','BOOLEAN','INTEGER'].includes(String(type))||
     type!=='STRING'&&field.maxBytes!==undefined)throw new Error('INVALID_REQUEST');
   names.add(name);
   return{name,type,required:field.required,...(type==='STRING'?{maxBytes:max(field.maxBytes??4096,4096)}:{})};
 });
 const requiredPermissions=parseProfilePermissions(p.requiredPermissions),networkScope=p.networkScope;
 if(networkScope!=='OFFLINE'&&networkScope!=='LOOPBACK'||networkScope==='LOOPBACK'&&!requiredPermissions.includes('NETWORK_LOOPBACK')||
   networkScope==='OFFLINE'&&requiredPermissions.includes('NETWORK_LOOPBACK')||
   !requiredPermissions.includes(local?'TOOL_LOCAL':'TOOL_MCP')||requiredPermissions.includes(local?'TOOL_MCP':'TOOL_LOCAL'))throw new Error('PERMISSION_CONFLICT');
 const list=p.credentialRequirements;
 if(!Array.isArray(list)||list.length>8||list.some(name=>typeof name!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(name))||new Set(list).size!==list.length)
   throw new Error('INVALID_REQUEST');
 return{alias,title,version,kind:mode,scope:scope as 'GLOBAL'|'PROJECT',projectId,...(local?{commandSpecId:ref}:{endpointRef:ref}),argvSchema,inputBytes:max(p.inputBytes,65536),
   outputBytes:max(p.outputBytes,65536),requiredPermissions,credentialRequirements:[...list].sort() as string[],networkScope};
}
export type ProfileToolManifest=ReturnType<typeof parseToolManifest>;

export function requireToolEnable(manifest:ProfileToolManifest,input:unknown){
 const permissions=parseProfilePermissions(input);
 if(!permitsProfilePermissions(permissions,manifest.requiredPermissions)||!permitsProfilePermissions(manifest.requiredPermissions,permissions))
   throw new Error('PERMISSION_CONFLICT');
 if(manifest.kind==='MCP'||manifest.credentialRequirements.length||manifest.networkScope!=='OFFLINE')throw new Error('CAPABILITY_UNAVAILABLE');
 return permissions;
}
