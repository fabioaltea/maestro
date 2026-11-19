import {keys,text,uuid} from '../shared/validation.ts';
import type {CliCommand} from './ports.ts';

export function buildWorkspaceCliArgs(command:CliCommand){
 const args=['workspace'],p=command.params??{};
 const positional:string[]=[];
 switch(command.action){
   case 'prepare':
     keys(p,['featureId','envelopeId']);positional.push(uuid(p.featureId),uuid(p.envelopeId));break;
   case 'create':
     keys(p,['grantId']);args.push(`--grant=${uuid(p.grantId)}`);break;
   case 'operation':
     keys(p,['requestId']);positional.push(uuid(p.requestId));break;
   case 'get':
     keys(p,['workspaceId']);positional.push(uuid(p.workspaceId));break;
   case 'list':
     keys(p,['projectId','limit','cursor']);positional.push(uuid(p.projectId));
     if(p.cursor!==undefined)args.push(`--cursor=${text(p.cursor,4096)}`);
     if(p.limit!==undefined){
       if(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20)throw new Error('INVALID_INPUT');
       args.push(`--limit=${p.limit}`);
     }
     break;
   default:throw new Error('INVALID_INPUT');
 }
 args.splice(1,0,command.action==='get'?'show':command.action);
 if(command.action==='create')args.push(`--request-id=${uuid(command.requestId)}`);
 else if(command.requestId!==undefined)throw new Error('INVALID_INPUT');
 args.push(`--state-dir=${command.archive}`,'--json');
 if(positional.length)args.push('--',...positional);
 return args;
}
