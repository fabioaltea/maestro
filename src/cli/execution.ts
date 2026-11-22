import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {featureObject} from '../domain/features/bundle.js';
import {EXECUTION_GRANTED,EXECUTION_LIMITS} from '../domain/execution/model.js';
import {executionInteractionText} from '../domain/execution/interaction.js';
import {workspaceUuid} from '../protocol/workspace.js';
import type {PublicResult} from '../protocol/messages.js';
import {jsonFile,jsonStdin} from './json-input.js';
import {projectExitCode} from './projects.js';
import {uploadWorkflowBytes} from './workflow-upload.js';

const HELP=`maestro execution list PROJECT [--active-only | --limit 1..20 --cursor CURSOR]
maestro execution get SESSION | provider.get codex|claude | operation REQUEST
maestro execution output.list RUN | artifact ARTIFACT [--cursor CURSOR]
maestro execution prepare --input-file FILE | --input-stdin
maestro execution provider.check|reconcile --input-file FILE | --input-stdin --request-id UUID
maestro execution ${EXECUTION_GRANTED.join('|')} --grant UUID --request-id UUID
maestro execution answer.import SESSION --input-file FILE | --input-stdin --request-id UUID
--state-dir ABS --json --timeout-ms 1..2000
`;
const reads:Record<string,readonly [string,string]>={
 list:['list','projectId'],get:['get','sessionId'],'provider.get':['provider.get','providerId'],
 operation:['operation.get','requestId'],artifact:['artifact.get','artifactId'],'output.list':['output.list','runId'],
};
export async function runExecutionCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values:v,positionals:p}=parseArgs({args:[...args],allowPositionals:true,strict:true,options:{
     'state-dir':{type:'string'},'timeout-ms':{type:'string'},'request-id':{type:'string'},grant:{type:'string'},
     limit:{type:'string'},cursor:{type:'string'},'active-only':{type:'boolean'},'input-file':{type:'string'},'input-stdin':{type:'boolean'},
     json:{type:'boolean'},help:{type:'boolean',short:'h'},
   }});
   json=v.json??false;
   if(v.help){process.stdout.write(HELP);return 0;}
   const [verb='',id]=p,allowed=new Set(['state-dir','timeout-ms','json']);
   const importAnswer=verb==='answer.import'&&p.length===2;
   const body=importAnswer||p.length===1&&['prepare','provider.check','reconcile'].includes(verb);
   const granted=p.length===1&&(EXECUTION_GRANTED as readonly string[]).includes(verb);
   const read=p.length===2&&Object.hasOwn(reads,verb)?reads[verb]:undefined;
   const mutation=body&&verb!=='prepare'||granted;
   if(!body&&!granted&&!read)throw new Error('INVALID_REQUEST');
   if(body){allowed.add('input-file');allowed.add('input-stdin');}
   if(granted)allowed.add('grant');
   if(mutation){allowed.add('request-id');requestId=workspaceUuid(v['request-id']);}
   if(read&&['list','artifact','output.list'].includes(verb))allowed.add('cursor');
   if(verb==='list'){allowed.add('limit');allowed.add('active-only');}
   if(Object.keys(v).some(key=>!allowed.has(key))||v['state-dir']!==undefined&&!isAbsolute(v['state-dir'])||
      v['timeout-ms']!==undefined&&!/^[1-9][0-9]{0,3}$/.test(v['timeout-ms']))throw new Error('INVALID_REQUEST');
   let params:Record<string,unknown>=granted?{grantId:v.grant}:read?{[read[1]]:id}:{};
   if(verb==='operation')requestId=workspaceUuid(id);
   const client=new LocalClient(createClientBackend());
   const options={...(v['state-dir']?{stateDirectory:v['state-dir']}:{}),...(v['timeout-ms']?{timeoutMs:Number(v['timeout-ms'])}:{})};
   let upload:Buffer|undefined;
   if(body){
     if(!!v['input-file']===!!v['input-stdin'])throw new Error('INVALID_REQUEST');
     const maximum=importAnswer?EXECUTION_LIMITS.interactionBytes+128:32768;
     const value=v['input-stdin']?await jsonStdin(maximum):await jsonFile(v['input-file'],maximum);
     if(importAnswer)upload=Buffer.from(executionInteractionText(value),'utf8');
     else params=featureObject(value);
   }
   if(v.limit!==undefined){if(!/^(?:[1-9]|1[0-9]|20)$/.test(v.limit))throw new Error('INVALID_REQUEST');params.limit=Number(v.limit);}
   if(v.cursor!==undefined)params.cursor=v.cursor;
   if(v['active-only']!==undefined)params.activeOnly=v['active-only'];
   if(upload){
     const target=await client.runExecution('execution.get',{sessionId:workspaceUuid(id)},options);
     if(target.result!=='OK'||target.liveness!=='LIVE_VERIFIED')result={...target,requestId};
     else result=await uploadWorkflowBytes(client,options,requestId!,'INPUT',upload,workspaceUuid(featureObject(target.data.session).featureId));
   }
   else result=await client.runExecution(`execution.${read?.[0]??verb}`,params,{...options,...(mutation?{requestId:requestId!}:{})});
 }catch(error){
   const badArgs=error instanceof Error&&'code' in error&&String(error.code).startsWith('ERR_PARSE_ARGS');
   result=failureResult(badArgs?'INVALID_REQUEST':classifyError(error),requestId);
 }
 await new Promise<void>((resolve,reject)=>process.stdout.write((json?JSON.stringify(result):[
   ...(result.requestId?[`requestId: ${result.requestId}`]:[]),...(result.error?[result.error.code,result.error.nextAction]:[JSON.stringify(result.data,null,2)]),
 ].join('\n'))+'\n',error=>error?reject(error):resolve()));
 return projectExitCode(result);
}
