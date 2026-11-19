import {keys,record,revision,text,uuid} from '../shared/input.ts';
import type {CliCommand} from './ports.ts';

export function buildEnvironmentCliArgs(command:CliCommand){
 const p=command.params??{},args=['environment'],positional:string[]=[];
 switch(command.action){
   case 'get':args.push('show');keys(p,['workspaceId']);positional.push(uuid(p.workspaceId));break;
   case 'list':
     args.push('list');keys(p,['projectId','limit','cursor']);positional.push(uuid(p.projectId));
     if(p.cursor!==undefined)args.push(`--cursor=${text(p.cursor,4096)}`);
     if(p.limit!==undefined){
       if(!Number.isInteger(p.limit)||Number(p.limit)<1||Number(p.limit)>20)throw new Error('INVALID_INPUT');
       args.push(`--limit=${p.limit}`);
     }
     break;
   case 'operation':args.push('operation');keys(p,['requestId']);positional.push(uuid(p.requestId));break;
   case 'plan':
     args.push('plan',`--expected-revision=${revision(p.expectedStateRevision)}`,`--request-id=${uuid(command.requestId)}`);
     keys(p,['workspaceId','expectedStateRevision','managerVersion']);positional.push(uuid(p.workspaceId));
     if(p.managerVersion!==undefined){
       const version=text(p.managerVersion,14);
       if(!/^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$/.test(version))throw new Error('INVALID_INPUT');
       args.push(`--manager-version=${version}`);
     }
     break;
   case 'authorize':args.push('prepare','--input-stdin');keys(p,['action','intent','expectedRevisions']);break;
   case 'attest':
     keys(p,['grantId']);args.push('attest',`--grant=${uuid(p.grantId)}`,`--request-id=${uuid(command.requestId)}`);break;
   default:throw new Error('INVALID_INPUT');
 }
 if(!['plan','attest'].includes(command.action)&&command.requestId!==undefined)throw new Error('INVALID_INPUT');
 args.push(`--state-dir=${command.archive}`,'--json');if(positional.length)args.push('--',...positional);
 return args;
}
export function environmentCliInput(command:CliCommand){
 if(command.namespace!=='environment'||command.action!=='authorize')return null;
 const encoded=JSON.stringify(record(command.params));
 if(Buffer.byteLength(encoded)>32768)throw new Error('INVALID_INPUT');
 return encoded;
}
