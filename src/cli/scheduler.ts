import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {featureObject} from '../domain/features/bundle.js';
import {workspaceUuid} from '../protocol/workspace.js';
import {SCHEDULER_GRANTED} from '../ports/scheduler.js';
import type {PublicResult} from '../protocol/messages.js';
import {jsonFile,jsonStdin} from './json-input.js';
import {projectExitCode} from './projects.js';

const help=`maestro scheduler queue.list [PROJECT] [--limit 1..20] [--cursor CURSOR]
maestro scheduler get JOB | operation REQUEST
maestro scheduler prepare --input-file FILE | --input-stdin
maestro scheduler enqueue|policy.configure|pause|cancel --grant UUID --request-id UUID
--state-dir ABS --json --timeout-ms 1..2000
`;

export async function runSchedulerCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values:v,positionals}=parseArgs({args:[...args],strict:true,allowPositionals:true,options:{
     'state-dir':{type:'string'},'timeout-ms':{type:'string'},'request-id':{type:'string'},grant:{type:'string'},
     limit:{type:'string'},cursor:{type:'string'},'input-file':{type:'string'},'input-stdin':{type:'boolean'},
     json:{type:'boolean'},help:{type:'boolean',short:'h'},
   }});
   json=v.json??false;
   if(v.help){process.stdout.write(help);return 0;}
   const [verb='',id]=positionals,allowed=new Set(['state-dir','timeout-ms','json']);
   let method=`scheduler.${verb}`,params:Record<string,unknown>={},mutating=false;
   if(verb==='queue.list'&&positionals.length<3){
     if(id!==undefined)params.projectId=workspaceUuid(id);
     allowed.add('limit');allowed.add('cursor');
   }else if(verb==='get'&&positionals.length===2)params.jobId=workspaceUuid(id);
   else if(verb==='operation'&&positionals.length===2){
     requestId=workspaceUuid(id);method='scheduler.operation.get';params={requestId};
   }else if(verb==='prepare'&&positionals.length===1){
     allowed.add('input-file');allowed.add('input-stdin');
     if(!!v['input-file']===!!v['input-stdin'])throw new Error('INVALID_REQUEST');
   }else if(positionals.length===1&&(SCHEDULER_GRANTED as readonly string[]).includes(verb)){
     mutating=true;allowed.add('grant');allowed.add('request-id');
     requestId=workspaceUuid(v['request-id']);params.grantId=workspaceUuid(v.grant);
   }else throw new Error('INVALID_REQUEST');
   if(Object.keys(v).some(key=>!allowed.has(key))||v['state-dir']!==undefined&&!isAbsolute(v['state-dir'])||
      v['timeout-ms']!==undefined&&!/^[1-9][0-9]{0,3}$/.test(v['timeout-ms']))throw new Error('INVALID_REQUEST');
   if(verb==='prepare')params=featureObject(v['input-stdin']?await jsonStdin(32768):await jsonFile(v['input-file'],32768));
   if(v.limit!==undefined){if(!/^(?:[1-9]|1[0-9]|20)$/.test(v.limit))throw new Error('INVALID_REQUEST');params.limit=Number(v.limit);}
   if(v.cursor!==undefined)params.cursor=v.cursor;
   result=await new LocalClient(createClientBackend()).runScheduler(method,params,{
     ...(v['state-dir']?{stateDirectory:v['state-dir']}:{}),...(v['timeout-ms']?{timeoutMs:Number(v['timeout-ms'])}:{}),
     ...(mutating?{requestId:requestId!}:{}),
   });
 }catch(error){
   const invalid=error instanceof Error&&'code' in error&&String(error.code).startsWith('ERR_PARSE_ARGS');
   result=failureResult(invalid?'INVALID_REQUEST':classifyError(error),requestId);
 }
 await new Promise<void>((resolve,reject)=>process.stdout.write((json?JSON.stringify(result):result.error?
   [result.error.code,result.error.nextAction].join('\n'):JSON.stringify(result.data,null,2))+'\n',error=>error?reject(error):resolve()));
 return projectExitCode(result);
}
