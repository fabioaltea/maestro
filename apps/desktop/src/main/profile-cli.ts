import {keys,record,text,uuid} from '../shared/input.ts';
import {PROFILE_MUTATIONS} from '../shared/profile-contract.ts';
import type {CliCommand} from './ports.ts';
export function buildProfileCliArgs(c:CliCommand){
 const p=c.params??{},result=['profile',c.action==='authorize'?'prepare':c.action==='get'?'show':c.action];
 const positional:string[]=[];
 if(['authorize','artifact.import','resolve','skill.preview'].includes(c.action))result.push('--input-stdin');
 else if((PROFILE_MUTATIONS as readonly string[]).includes(c.action)){
   keys(p,['grantId']);result.push(`--grant=${uuid(p.grantId)}`);
 }else switch(c.action){
   case 'list':
     keys(p,['kind','projectId','limit','cursor']);
     if(!['PROFILE','SKILL','TOOL'].includes(String(p.kind)))throw new Error('INVALID_INPUT');
     positional.push(String(p.kind));
     if(p.projectId!==undefined)result.push(`--project=${uuid(p.projectId)}`);
     if(p.limit!==undefined){
       if(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20)throw new Error('INVALID_INPUT');
       result.push(`--limit=${p.limit}`);
     }
     break;
   case 'get':
     keys(p,['entityId','revisionId']);positional.push(uuid(p.entityId));
     if(p.revisionId!==undefined)result.push(`--revision-id=${uuid(p.revisionId)}`);
     break;
   case 'preview':keys(p,['previewId']);positional.push(uuid(p.previewId));break;
   case 'resolution':keys(p,['resolutionId']);positional.push(uuid(p.resolutionId));break;
   case 'operation':keys(p,['requestId']);positional.push(uuid(p.requestId));break;
   case 'artifact':keys(p,['artifactId','cursor']);positional.push(uuid(p.artifactId));break;
   case 'capabilities':keys(p,[]);break;
   case 'suggest':keys(p,['profileId','projectId']);positional.push(uuid(p.profileId));result.push(`--project=${uuid(p.projectId)}`);break;
   default:throw new Error('INVALID_INPUT');
 }
 if((PROFILE_MUTATIONS as readonly string[]).includes(c.action))result.push(`--request-id=${uuid(c.requestId)}`);
 else if(c.requestId!==undefined)throw new Error('INVALID_INPUT');
 if(p.cursor!==undefined)result.push(`--cursor=${text(p.cursor,4096)}`);
 result.push(`--state-dir=${c.archive}`,'--json');if(positional.length)result.push('--',...positional);
 return result;
}
export function profileCliInput(c:CliCommand){
 if(c.namespace!=='profile'||!['authorize','artifact.import','resolve','skill.preview'].includes(c.action))return null;
 const content=JSON.stringify(record(c.params));
 if(Buffer.byteLength(content)>32768)throw new Error('INVALID_INPUT');
 return content;
}
