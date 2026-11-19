import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {featureObject} from '../domain/features/bundle.js';
import {workspaceUuid} from '../protocol/workspace.js';
import type {PublicResult} from '../protocol/messages.js';
import {jsonFile,jsonStdin} from './json-input.js';
import {projectExitCode} from './projects.js';

const HELP=`maestro environment plan WORKSPACE --expected-revision N --request-id UUID [--manager-version VERSION]
maestro environment prepare --input-file FILE | --input-stdin
maestro environment prepare|attest|cancel --grant UUID --request-id UUID
maestro environment job JOB
maestro environment output JOB [--limit 1..20 --cursor CURSOR]
maestro environment show WORKSPACE
maestro environment list PROJECT [--limit 1..20 --cursor CURSOR]
maestro environment operation REQUEST
maestro environment artifact ARTIFACT [--cursor CURSOR]
--state-dir ABS --json --timeout-ms 1..2000
I dati delle autorizzazioni viaggiano da file o stdin. Consultare l’esito con l’UUID originale.
`;
export async function runEnvironmentCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values,positionals}=parseArgs({args:[...args],allowPositionals:true,strict:true,options:{
     json:{type:'boolean'},help:{type:'boolean',short:'h'},'state-dir':{type:'string'},'timeout-ms':{type:'string'},
     grant:{type:'string'},'request-id':{type:'string'},'expected-revision':{type:'string'},'manager-version':{type:'string'},
     'input-file':{type:'string'},'input-stdin':{type:'boolean'},limit:{type:'string'},cursor:{type:'string'},
   }});
   json=values.json??false;
   if(values.help){process.stdout.write(HELP);return 0;}
   const [action,id]=positionals,allowed=new Set(['json','state-dir','timeout-ms']);
   let method:string,params:Record<string,unknown>,mutation=false;
   if(action==='plan'&&positionals.length===2){
     method='environment.plan';params={workspaceId:id,expectedStateRevision:values['expected-revision']};mutation=true;
     allowed.add('expected-revision');allowed.add('manager-version');
     if(values['manager-version']!==undefined)params.managerVersion=values['manager-version'];
   }else if(action==='prepare'&&positionals.length===1&&values.grant===undefined){
     method='environment.prepare';params={};allowed.add('input-file');allowed.add('input-stdin');
   }else if(['prepare','attest','cancel'].includes(action??'')&&positionals.length===1){
     method=`environment.${action}`;params={grantId:values.grant};mutation=true;allowed.add('grant');
   }else if(action==='show'&&positionals.length===2){
     method='environment.get';params={workspaceId:id};
   }else if(action==='list'&&positionals.length===2){
     method='environment.list';params={projectId:id};allowed.add('limit');allowed.add('cursor');
   }else if(action==='operation'&&positionals.length===2){
     method='environment.operation.get';requestId=workspaceUuid(id);params={requestId};
   }else if(action==='artifact'&&positionals.length===2){
     method='environment.artifact.get';params={artifactId:id};allowed.add('cursor');
   }else if(action==='job'&&positionals.length===2){
     method='environment.job.get';params={jobId:id};
   }else if(action==='output'&&positionals.length===2){
     method='environment.output.list';params={jobId:id};allowed.add('limit');allowed.add('cursor');
   }else throw new Error('INVALID_REQUEST');
   if(mutation){requestId=workspaceUuid(values['request-id']);allowed.add('request-id');}
   if(Object.keys(values).some(key=>!allowed.has(key)))throw new Error('INVALID_REQUEST');
   if(allowed.has('input-stdin')){
     const file=values['input-file'],stdin=values['input-stdin'];
     if(!!file===!!stdin)throw new Error('INVALID_REQUEST');
     params=featureObject(stdin?await jsonStdin():await jsonFile(file));
     if(!Object.hasOwn(params,'action'))throw new Error('INVALID_REQUEST');
   }
   if(values.limit!==undefined){
     if(!/^(?:[1-9]|1[0-9]|20)$/.test(values.limit))throw new Error('INVALID_REQUEST');
     params.limit=Number(values.limit);
   }
   if(values.cursor!==undefined)params.cursor=values.cursor;
   const directory=values['state-dir'],timeout=values['timeout-ms'];
   if(directory!==undefined&&!isAbsolute(directory)||timeout!==undefined&&!/^[1-9][0-9]{0,3}$/.test(timeout))throw new Error('INVALID_REQUEST');
   const client=new LocalClient(createClientBackend());
   result=await client.runEnvironment(method,params,{...(directory?{stateDirectory:directory}:{}),...(timeout?{timeoutMs:Number(timeout)}:{}),
     ...(mutation?{requestId:requestId!}:{})});
 }catch(error){
   const parseError=error instanceof Error&&'code' in error&&String(error.code).startsWith('ERR_PARSE_ARGS');
   result=failureResult(parseError?'INVALID_REQUEST':classifyError(error),requestId);
 }
 const content=json?JSON.stringify(result):[
   ...(result.requestId?[`requestId: ${result.requestId}`]:[]),
   ...(result.error?[`${result.error.code}: ${result.error.message}`,result.error.nextAction]:[JSON.stringify(result.data,null,2)]),
 ].join('\n');
 await new Promise<void>((resolve,reject)=>process.stdout.write(content+'\n',error=>error?reject(error):resolve()));
 return projectExitCode(result);
}
