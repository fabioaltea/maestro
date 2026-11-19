import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {workspaceUuid} from '../protocol/workspace.js';
import type {PublicResult} from '../protocol/messages.js';
import {projectExitCode} from './projects.js';

const help=`maestro workspace prepare FEATURE_UUID ENVELOPE_UUID
maestro workspace create --grant UUID --request-id UUID
maestro workspace list PROJECT_UUID [--limit 1..20 --cursor CURSOR]
maestro workspace show WORKSPACE_UUID
maestro workspace refresh WORKSPACE_UUID --expected-revision N --request-id UUID
maestro workspace operation REQUEST_UUID
--state-dir ABS --json --timeout-ms 1..2000
Controllare il riepilogo di prepare prima di inviare create. Consultare operation con l’UUID originale.
`;

export async function runWorkspaceCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values,positionals}=parseArgs({args:[...args],allowPositionals:true,strict:true,options:{
     json:{type:'boolean'},help:{type:'boolean',short:'h'},'state-dir':{type:'string'},'timeout-ms':{type:'string'},
     grant:{type:'string'},'request-id':{type:'string'},'expected-revision':{type:'string'},limit:{type:'string'},cursor:{type:'string'},
   }});
   json=values.json??false;
   if(values.help){process.stdout.write(help);return 0;}
   const [action,target,envelope]=positionals;
   const allowed=new Set(['json','state-dir','timeout-ms']);
   let method:string,params:Record<string,unknown>;
   if(action==='prepare'&&positionals.length===3){
     method='workspace.prepare';params={featureId:target,envelopeId:envelope};
   }else if(action==='create'&&positionals.length===1){
     method='workspace.create';params={grantId:values.grant};
     allowed.add('grant');allowed.add('request-id');
     requestId=workspaceUuid(values['request-id']);
   }else if(action==='list'&&positionals.length===2){
     method='workspace.list';params={projectId:target};
     allowed.add('limit');allowed.add('cursor');
     if(values.limit!==undefined){
       if(!/^(?:[1-9]|1[0-9]|20)$/.test(values.limit))throw new Error('INVALID_REQUEST');
       params.limit=Number(values.limit);
     }
     if(values.cursor!==undefined)params.cursor=values.cursor;
   }else if(action==='show'&&positionals.length===2){
     method='workspace.get';params={workspaceId:target};
   }else if(action==='refresh'&&positionals.length===2){
     method='workspace.refresh';params={workspaceId:target,expectedStateRevision:values['expected-revision']};
     allowed.add('expected-revision');allowed.add('request-id');
     requestId=workspaceUuid(values['request-id']);
   }else if(action==='operation'&&positionals.length===2){
     method='workspace.operation.get';requestId=workspaceUuid(target);params={requestId};
   }else throw new Error('INVALID_REQUEST');
   if(Object.keys(values).some(key=>!allowed.has(key)))throw new Error('INVALID_REQUEST');
   const directory=values['state-dir'],timeout=values['timeout-ms'];
   if(directory!==undefined&&!isAbsolute(directory)||timeout!==undefined&&!/^[1-9][0-9]{0,3}$/.test(timeout))throw new Error('INVALID_REQUEST');
   const client=new LocalClient(createClientBackend());
   result=await client.runWorkspace(method,params,{...(directory?{stateDirectory:directory}:{}),...(timeout?{timeoutMs:Number(timeout)}:{}),
     ...(['workspace.create','workspace.refresh'].includes(method)?{requestId:requestId!}:{})});
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
