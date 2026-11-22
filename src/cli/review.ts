import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {LocalClient} from '../client/local-client.js';
import {classifyError} from '../core/control-main.js';
import {featureObject} from '../domain/features/bundle.js';
import {REVIEW_GRANTED} from '../domain/review/state.js';
import {workspaceRevision,workspaceUuid} from '../protocol/workspace.js';
import type {PublicResult} from '../protocol/messages.js';
import {jsonFile,jsonStdin} from './json-input.js';
import {projectExitCode} from './projects.js';

const help=`maestro review list PROJECT [--limit 1..20] [--cursor CURSOR]
maestro review get REVIEW [--cursor CURSOR] | operation REQUEST | artifact ARTIFACT [--cursor CURSOR]
maestro review prepare --input-file FILE | --input-stdin
maestro review create|validate|request-changes --grant UUID --request-id UUID
maestro review candidate.prepare|approve|integrate --grant UUID --request-id UUID
maestro review complete INTEGRATION --expected-state-revision REVISION --request-id UUID
maestro review receipt INTEGRATION | cleanup.preview INTEGRATION WORKSPACE
--state-dir ABS --json --timeout-ms 1..2000
`;
const reads:Record<string,readonly [string,string]>={list:['list','projectId'],get:['get','reviewId'],
 operation:['operation.get','requestId'],artifact:['artifact.get','artifactId'],receipt:['receipt.get','integrationId']};
export async function runReviewCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values:v,positionals}=parseArgs({args:[...args],strict:true,allowPositionals:true,options:{
     'state-dir':{type:'string'},'timeout-ms':{type:'string'},'request-id':{type:'string'},grant:{type:'string'},
     'expected-state-revision':{type:'string'},
     limit:{type:'string'},cursor:{type:'string'},'input-file':{type:'string'},'input-stdin':{type:'boolean'},
     json:{type:'boolean'},help:{type:'boolean',short:'h'},
   }});
   json=v.json??false;if(v.help){process.stdout.write(help);return 0;}
   const [verb='',id,workspaceId]=positionals,allowed=new Set(['state-dir','timeout-ms','json']);
   const read=positionals.length===2&&Object.hasOwn(reads,verb)?reads[verb]:undefined;
   const prepare=verb==='prepare'&&positionals.length===1,complete=verb==='complete'&&positionals.length===2;
   const mutating=complete||positionals.length===1&&(REVIEW_GRANTED as readonly string[]).includes(verb);
   let p:Record<string,unknown>={};
   if(read){
     p={[read[1]]:workspaceUuid(id)};
     if(verb==='operation')requestId=String(p.requestId);
     if(['list','get','artifact'].includes(verb))allowed.add('cursor');
     if(verb==='list')allowed.add('limit');
   }else if(prepare){
     allowed.add('input-file');allowed.add('input-stdin');
     if(!!v['input-file']===!!v['input-stdin'])throw new Error('INVALID_REQUEST');
   }else if(complete){
     allowed.add('request-id');allowed.add('expected-state-revision');
     requestId=workspaceUuid(v['request-id']);
     p={integrationId:workspaceUuid(id),expectedStateRevision:workspaceRevision(v['expected-state-revision'])};
   }else if(verb==='cleanup.preview'&&positionals.length===3){
     p={integrationId:workspaceUuid(id),workspaceId:workspaceUuid(workspaceId)};
   }else if(mutating){
     allowed.add('grant');allowed.add('request-id');
     requestId=workspaceUuid(v['request-id']);p.grantId=workspaceUuid(v.grant);
   }else throw new Error('INVALID_REQUEST');
   if(Object.keys(v).some(key=>!allowed.has(key))||v['state-dir']!==undefined&&!isAbsolute(v['state-dir'])||
      v['timeout-ms']!==undefined&&!/^[1-9][0-9]{0,3}$/.test(v['timeout-ms']))throw new Error('INVALID_REQUEST');
   if(prepare)p=featureObject(v['input-stdin']?await jsonStdin(32768):await jsonFile(v['input-file'],32768));
   if(v.limit!==undefined){if(!/^(?:[1-9]|1[0-9]|20)$/.test(v.limit))throw new Error('INVALID_REQUEST');p.limit=Number(v.limit);}
   if(v.cursor!==undefined)p.cursor=v.cursor;
   result=await new LocalClient(createClientBackend()).runReview(`review.${read?.[0]??verb}`,p,{
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
