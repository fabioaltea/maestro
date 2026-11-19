import {parseArgs} from 'node:util';
import {isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {requireUuid} from '../domain/identifiers.js';
import {featureText,validateFeatureBundle} from '../domain/features/bundle.js';
import {FEATURE_PLANNING_ACTIONS,FEATURE_PLANNING_LIMITS} from '../domain/features/planning.js';
import {LocalClient} from '../client/local-client.js';
import {createClientBackend,failureResult} from '../bootstrap.js';
import {classifyError} from '../core/control-main.js';
import {projectExitCode} from './projects.js';
import {jsonFile,jsonStdin} from './json-input.js';
import type {PublicResult} from '../protocol/messages.js';
const HELP=`maestro feature prepare --input-file FILE | --input-stdin
maestro feature create|revise|archive|approve|handoff --grant UUID --request-id UUID
maestro feature generate|answer|cancel --grant UUID --request-id UUID
maestro feature list PROJECT [--limit 1..20 --cursor CURSOR]
maestro feature show FEATURE
maestro feature revisions FEATURE [--limit 1..20 --cursor CURSOR]
maestro feature revision REVISION
maestro feature approval REVISION
maestro feature envelope ENVELOPE
maestro feature eligibility FEATURE [--check-id UUID]
maestro feature planning TURN
maestro feature questions FEATURE [--limit 1..20 --cursor CURSOR]
maestro feature output TURN [--limit 1..20 --cursor CURSOR]
maestro feature provider get
maestro feature operation REQUEST
maestro feature artifact import --bundle-file FILE | --bundle-stdin --request-id UUID
maestro feature artifact import-answer FEATURE --answer-file FILE | --answer-stdin --request-id UUID
maestro feature artifact get ARTIFACT [--cursor CURSOR]
maestro feature artifact reserve|append|seal|discard --input-file FILE | --input-stdin --request-id UUID
maestro feature artifact budget
--state-dir ABS --json --timeout-ms 1..2000
Testi soltanto da file o stdin. Bundle <=256KiB; envelope <=32KiB, chunk <=8KiB.
Import: UUID originale identifica seal; i sotto-UUID sono deterministici e recuperabili.
Mutazioni: admission non equivale a completamento. Recuperare con operation UUID originale.
`;
/** Stable subordinate UUIDs make a whole upload retryable without duplicating its objects. */
function uploadId(root:string,part:string){const h=createHash('sha256').update(`${root}:${part}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function runFeatureCli(args:readonly string[]):Promise<number>{
 let json=args.includes('--json'),requestId:string|null=null,result:PublicResult;
 try{
 const {values:v,positionals:p}=parseArgs({args:[...args],strict:true,allowPositionals:true,options:{json:{type:'boolean'},help:{type:'boolean',short:'h'},'state-dir':{type:'string'},'timeout-ms':{type:'string'},'request-id':{type:'string'},grant:{type:'string'},limit:{type:'string'},cursor:{type:'string'},'check-id':{type:'string'},'input-file':{type:'string'},'input-stdin':{type:'boolean'},'bundle-file':{type:'string'},'bundle-stdin':{type:'boolean'},'answer-file':{type:'string'},'answer-stdin':{type:'boolean'}}});
 json=v.json??false;if(v.help){process.stdout.write(HELP);return 0;}
 if(v['state-dir']!==undefined&&!isAbsolute(v['state-dir']))throw new Error('INVALID_REQUEST');
 for(const k of ['limit','timeout-ms'] as const)if(v[k]!==undefined&&!/^[1-9][0-9]*$/.test(v[k]))throw new Error('INVALID_REQUEST');
 const allowed=new Set(['json','help','state-dir','timeout-ms']);let method:string,params:Record<string,unknown>={},mutation=false,importing:'BUNDLE'|'INPUT'|null=null;
 const body=()=>{allowed.add('input-file');allowed.add('input-stdin');};
 if(p[0]==='prepare'&&p.length===1){method='feature.prepare';body();}
 else if(['create','revise','archive','approve','handoff',...FEATURE_PLANNING_ACTIONS].includes(p[0]??'')&&p.length===1){method=`feature.${p[0]}`;params={grantId:v.grant};allowed.add('grant');mutation=true;}
 else if(p[0]==='artifact'&&p[1]==='import'&&p.length===2){method='feature.artifact.seal';importing='BUNDLE';mutation=true;allowed.add('bundle-file');allowed.add('bundle-stdin');}
 else if(p[0]==='artifact'&&p[1]==='import-answer'&&p.length===3){method='feature.artifact.seal';importing='INPUT';mutation=true;allowed.add('answer-file');allowed.add('answer-stdin');}
 else if(p[0]==='artifact'&&['reserve','append','seal','discard'].includes(p[1]??'')&&p.length===2){method=`feature.artifact.${p[1]}`;body();mutation=true;}
 else if(p[0]==='artifact'&&p[1]==='budget'&&p.length===2){method='feature.artifact.budget';}
 else if(p[0]==='artifact'&&p[1]==='get'&&p.length===3){method='feature.artifact.get';params={artifactId:p[2]};allowed.add('cursor');}
 else if(p[0]==='provider'&&p[1]==='get'&&p.length===2){method='feature.provider.get';}
 else{
 const queries:Record<string,[string,string]>={list:['list','projectId'],show:['get','featureId'],revisions:['revisions.list','featureId'],revision:['revision.get','revisionId'],approval:['approval.get','revisionId'],envelope:['envelope.get','envelopeId'],eligibility:['eligibility.get','featureId'],operation:['operation.get','requestId'],planning:['planning.get','turnId'],questions:['questions.list','featureId'],output:['output.list','turnId']};
 const verb=p[0];
 if(!verb||!Object.hasOwn(queries,verb)||p.length!==2)throw new Error('INVALID_REQUEST');
 const [route,target]=queries[verb]!;method=`feature.${route}`;params={[target]:p[1]};
 if(['list','revisions','questions','output'].includes(verb)){allowed.add('limit');allowed.add('cursor');}
 if(verb==='eligibility'){allowed.add('check-id');if(v['check-id']!==undefined)params.checkId=v['check-id'];}
 }
 if(mutation){allowed.add('request-id');requestId=requireUuid(v['request-id']??randomUUID());}
 for(const [k,value]of Object.entries(v))if(value!==undefined&&!allowed.has(k))throw new Error('INVALID_REQUEST');
 if(allowed.has('input-file')){if(!!v['input-file']===!!v['input-stdin'])throw new Error('INVALID_REQUEST');const raw=v['input-stdin']?await jsonStdin():await jsonFile(v['input-file']);if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.hasOwn(raw,'requestId'))throw new Error('INVALID_REQUEST');params=raw as Record<string,unknown>;}
 if(v.limit!==undefined)params.limit=Number(v.limit);if(v.cursor!==undefined)params.cursor=v.cursor;
 const client=new LocalClient(createClientBackend()),options={...(v['state-dir']?{stateDirectory:v['state-dir']}:{}),...(v['timeout-ms']?{timeoutMs:Number(v['timeout-ms'])}:{})};
 if(importing){
 const answer=importing==='INPUT',targetId=answer?requireUuid(p[2]):undefined;
 const inputFile=answer?v['answer-file']:v['bundle-file'],inputStdin=answer?v['answer-stdin']:v['bundle-stdin'];
 if(!!inputFile===!!inputStdin)throw new Error('INVALID_REQUEST');
 const maxBytes=answer?6*FEATURE_PLANNING_LIMITS.answerBytes+2:262144;
 const raw=inputStdin?await jsonStdin(maxBytes):await jsonFile(inputFile,maxBytes);
 const bytes=Buffer.from(answer?featureText(raw,FEATURE_PLANNING_LIMITS.answerBytes,true):JSON.stringify(validateFeatureBundle(raw)));
 const sha256=createHash('sha256').update(bytes).digest('hex'),root=requestId!,artifactId=uploadId(root,'reserve');
 result=await client.runFeature('feature.artifact.reserve',{kind:importing,expectedBytes:bytes.length,sha256,...(targetId?{targetId}:{})},{...options,requestId:artifactId});
 const good=(r:PublicResult)=>r.result==='OK'&&r.data.operation!==undefined&&(r.data.operation as {outcome?:string}).outcome==='SUCCEEDED';
 if(good(result)){
 for(let offset=0;offset<bytes.length;offset+=8192){const chunk=bytes.subarray(offset,offset+8192);result=await client.runFeature('feature.artifact.append',{uploadId:artifactId,offset,chunkSha256:createHash('sha256').update(chunk).digest('hex'),base64:chunk.toString('base64')},{...options,requestId:uploadId(root,`append:${offset}`)});if(!good(result))break;}
 if(good(result))result=await client.runFeature('feature.artifact.seal',{uploadId:artifactId,expectedBytes:bytes.length,sha256},{...options,requestId:root});
 }
 }else result=await client.runFeature(method,params,{...options,...(mutation?{requestId:requestId!}:{})});
 }catch(error){result=failureResult(classifyError(error),requestId);}
 await new Promise<void>((resolve,reject)=>process.stdout.write((json?JSON.stringify(result):(result.requestId?`requestId: ${result.requestId}\n`:'')+(result.error?`${result.error.code}: ${result.error.message}\n${result.error.nextAction}`:JSON.stringify(result.data,null,2)))+'\n',e=>e?reject(e):resolve()));
 return projectExitCode(result);
}
