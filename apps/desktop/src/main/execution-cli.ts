import {keys,record,text,uuid} from '../shared/input.ts';
import {EXECUTION_MUTATIONS,executionProvider} from '../shared/execution-contract.ts';
import type {CliCommand} from './ports.ts';

export function buildExecutionCliArgs(c:CliCommand){
 const p=c.params??{},args=['execution',c.action==='authorize'?'prepare':c.action],positional:string[]=[];
 const observed=['provider.check','reconcile'].includes(c.action);
 const mutation=(EXECUTION_MUTATIONS as readonly string[]).includes(c.action);
 if(c.action==='authorize'||observed)args.push('--input-stdin');
 else if(mutation){keys(p,['grantId']);args.push(`--grant=${uuid(p.grantId)}`);}
 else switch(c.action){
   case 'list':
     keys(p,['projectId','cursor','activeOnly']);positional.push(uuid(p.projectId));
     if(p.activeOnly!==undefined){
       if(p.activeOnly!==true||p.cursor!==undefined)throw new Error('INVALID_INPUT');
       args.push('--active-only');
     }
     break;
   case 'get':keys(p,['sessionId']);positional.push(uuid(p.sessionId));break;
   case 'output.list':keys(p,['runId','cursor']);positional.push(uuid(p.runId));break;
   case 'artifact':keys(p,['artifactId','cursor']);positional.push(uuid(p.artifactId));break;
   case 'provider.get':keys(p,['providerId']);positional.push(executionProvider(p.providerId));break;
   case 'operation':keys(p,['requestId']);positional.push(uuid(p.requestId));break;
   default:throw new Error('INVALID_INPUT');
 }
 if(mutation)args.push(`--request-id=${uuid(c.requestId)}`);
 else if(c.requestId!==undefined)throw new Error('INVALID_INPUT');
 if(p.cursor!==undefined)args.push(`--cursor=${text(p.cursor,1024)}`);
 args.push(`--state-dir=${c.archive}`,'--json');
 if(positional.length)args.push('--',...positional);
 return args;
}
export function executionCliInput(c:CliCommand){
 if(c.namespace!=='execution'||!['authorize','provider.check','reconcile'].includes(c.action))return null;
 const content=JSON.stringify(record(c.params));
 if(Buffer.byteLength(content)>32768)throw new Error('INVALID_INPUT');
 return content;
}
