import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {featureFields,featureObject} from '../domain/features/bundle.js';
import {PROFILE_GRANTED} from '../domain/profiles/model.js';
import {workspaceUuid} from '../protocol/workspace.js';
import type {PublicResult} from '../protocol/messages.js';
import {jsonFile,jsonStdin} from './json-input.js';
import {projectExitCode} from './projects.js';
import {uploadWorkflowBytes} from './workflow-upload.js';

const HELP=`maestro profile list PROFILE|SKILL|TOOL [--project ID --limit 1..20 --cursor CURSOR]
maestro profile show ENTITY [--revision-id REVISION]
maestro profile capabilities
maestro profile artifact ARTIFACT [--cursor CURSOR]
maestro profile artifact.import --input-file FILE | --input-stdin --request-id UUID
maestro profile prepare --input-file FILE | --input-stdin
maestro profile resolve|skill.preview --input-file FILE | --input-stdin --request-id UUID
maestro profile create|revise|disable|skill.import|skill.bind|tool.import|tool.enable --grant UUID --request-id UUID
maestro profile operation REQUEST
maestro profile resolution RESOLUTION
maestro profile preview PREVIEW
maestro profile suggest PROFILE --project ID
--state-dir ABS --json --timeout-ms 1..2000
`;
export async function runProfileCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
   const {values:v,positionals:p}=parseArgs({args:[...args],allowPositionals:true,strict:true,options:{
     'state-dir':{type:'string'},'timeout-ms':{type:'string'},'request-id':{type:'string'},grant:{type:'string'},project:{type:'string'},
     limit:{type:'string'},cursor:{type:'string'},'revision-id':{type:'string'},'input-file':{type:'string'},'input-stdin':{type:'boolean'},
     json:{type:'boolean'},help:{type:'boolean',short:'h'},
   }});
   json=v.json??false;
   if(v.help){process.stdout.write(HELP);return 0;}
   const [verb,id]=p,allowed=new Set(['state-dir','timeout-ms','json']);
   let method:string,params:Record<string,unknown>,mutation=false,body=false;
   if(p.length===1&&['prepare','resolve','skill.preview','artifact.import','capabilities'].includes(verb??'')){
     method=`profile.${verb}`;params={};body=verb!=='capabilities';mutation=verb!=='prepare'&&verb!=='capabilities';
   }else if(p.length===1&&(PROFILE_GRANTED as readonly string[]).includes(verb??'')){
     method=`profile.${verb}`;params={grantId:v.grant};mutation=true;allowed.add('grant');
   }else if(p.length===2&&verb==='list'){
     method='profile.list';params={kind:id,...(v.project?{projectId:v.project}:{})};
     for(const option of ['project','limit','cursor'])allowed.add(option);
   }else if(p.length===2&&verb==='suggest'){
     method='profile.suggest';params={profileId:id,projectId:v.project};allowed.add('project');
   }else if(p.length===2&&verb==='show'){
     method='profile.get';params={entityId:id,...(v['revision-id']?{revisionId:v['revision-id']}:{})};allowed.add('revision-id');
   }else if(p.length===2&&verb==='operation'){
     method='profile.operation.get';requestId=workspaceUuid(id);params={requestId};
   }else if(p.length===2&&verb==='preview'){
     method='profile.skill.preview.get';params={previewId:id};
   }else if(p.length===2&&verb==='resolution'){
     method='profile.resolution.get';params={resolutionId:id};
   }else if(p.length===2&&verb==='artifact'){
     method='profile.artifact.get';params={artifactId:id};allowed.add('cursor');
   }else throw new Error('INVALID_REQUEST');
   if(mutation){allowed.add('request-id');requestId=workspaceUuid(v['request-id']);}
   if(body){allowed.add('input-file');allowed.add('input-stdin');}
   if(Object.keys(v).some(key=>!allowed.has(key)))throw new Error('INVALID_REQUEST');
   if(v['state-dir']!==undefined&&!isAbsolute(v['state-dir'])||v['timeout-ms']!==undefined&&!/^[1-9][0-9]{0,3}$/.test(v['timeout-ms']))throw new Error('INVALID_REQUEST');
   if(body){
     if(!!v['input-file']===!!v['input-stdin'])throw new Error('INVALID_REQUEST');
     const cap=verb==='artifact.import'?262144:32768;
     params=featureObject(v['input-stdin']?await jsonStdin(cap):await jsonFile(v['input-file'],cap));
   }
   if(v.limit!==undefined){if(!/^(?:[1-9]|1[0-9]|20)$/.test(v.limit))throw new Error('INVALID_REQUEST');params.limit=Number(v.limit);}
   if(v.cursor!==undefined)params.cursor=v.cursor;
   const client=new LocalClient(createClientBackend());
   const options={...(v['state-dir']?{stateDirectory:v['state-dir']}:{}),...(v['timeout-ms']?{timeoutMs:Number(v['timeout-ms'])}:{})};
   if(verb==='artifact.import'){
     result=await uploadWorkflowBytes(client,options,requestId!,'BUNDLE',Buffer.from(JSON.stringify(params)));
   }else if(verb==='skill.preview'&&Object.hasOwn(params,'source')){
     featureFields(params,['source','scope'],['projectId','ownerProfileId']);
     const {source,...scope}=params;
     const reply=await client.runProfile('profile.skill.source',{source},options);
     result=reply.result==='OK'?await client.runProfile(method,{...scope,importHandle:reply.data.importHandle},{...options,requestId:requestId!}):
       {...reply,requestId};
   }else{
     result=await client.runProfile(method,params,{...options,...(mutation?{requestId:requestId!}:{})});
   }
 }catch(error){
   const badArgs=error instanceof Error&&'code' in error&&String(error.code).startsWith('ERR_PARSE_ARGS');
   result=failureResult(badArgs?'INVALID_REQUEST':classifyError(error),requestId);
 }
 await new Promise<void>((resolve,reject)=>process.stdout.write((json?JSON.stringify(result):[
   ...(result.requestId?[`requestId: ${result.requestId}`]:[]),...(result.error?[result.error.code,result.error.nextAction]:[JSON.stringify(result.data,null,2)]),
 ].join('\n'))+'\n',error=>error?reject(error):resolve()));
 return projectExitCode(result);
}
