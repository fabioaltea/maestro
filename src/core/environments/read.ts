import type {StoragePort} from '../../ports/storage.js';
import type {EnvironmentJob,EnvironmentJobPort,EnvironmentPlan,EnvironmentRecord} from '../../ports/environment.js';
import {featureObject} from '../../domain/features/bundle.js';
import {publicEnvironmentOperation,requireEnvironmentEnvelope,validateEnvironmentParams} from '../../protocol/environment.js';

function cursor(value:unknown){
 if(value===undefined)return null;
 try{return featureObject(JSON.parse(Buffer.from(String(value),'base64url').toString('utf8')));}
 catch{throw new Error('INVALID_REQUEST');}
}
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function environmentSummary(value:EnvironmentRecord){
 const {workspaceGeneration:_generation,...summary}=value;
 return summary;
}
function planSummary(plan:EnvironmentPlan){
 const {planId,digest,inputDigest,artifactId,createdAt}=plan;
 const {manager,managerVersion,pin,disposition,reason,scriptNames,inputs,registryOrigin}=plan.metadata;
 return{planId,digest,inputDigest,artifactId,createdAt,manager,managerVersion,pin,disposition,reason,scriptNames,
   inputFiles:inputs.length,...(plan.metadata.commands?.length?{commands:plan.metadata.commands.map(({id,entry,timeoutMs,argv})=>({id,entry,timeoutMs,argCount:argv.length}))}:{}),
   networkScope:registryOrigin===null?'OFFLINE':'LOOPBACK'};
}
function jobSummary(job:EnvironmentJob){
 const {leaseId:_lease,generation:_generation,cancelRequestId:_cancel,...summary}=job;
 return summary;
}
export function createEnvironmentJobPort(storage:StoragePort):EnvironmentJobPort{
 return{
   async get(jobId){
     if(!storage.readEnvironmentState)throw new Error('ENVIRONMENT_NOT_INITIALIZED');
     const {job}=await storage.readEnvironmentState({kind:'job',id:jobId});
     if(!job)throw new Error('OPERATION_NOT_FOUND');
     return job;
   },
   async output(jobId,after,limit){
     if(!storage.readEnvironmentState)throw new Error('ENVIRONMENT_NOT_INITIALIZED');
     return (await storage.readEnvironmentState({kind:'output',id:jobId,limit,after})).chunks??[];
   },
 };
}
export function createEnvironmentReader(options:{storage:StoragePort;storeId:string;offline:boolean}){
 const {storage,storeId,offline}=options,jobs=createEnvironmentJobPort(storage),freshness=offline?'LAST_KNOWN':'CURRENT';
 return async(method:string,params:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateEnvironmentParams(method,params);
   if(!storage.readEnvironmentState||!storage.readFeatureState||!storage.readWorkspaceState)throw new Error('ENVIRONMENT_NOT_INITIALIZED');
   const c=cursor(params.cursor),limit=typeof params.limit==='number'?params.limit:20;
   if(c&&c.storeId!==storeId)throw new Error('REVISION_CONFLICT');
   let data:Record<string,unknown>;
   if(method==='environment.get'){
     const workspaceId=String(params.workspaceId),{environment}=await storage.readEnvironmentState({kind:'workspace',id:workspaceId});
     if(!environment){
       if(!(await storage.readWorkspaceState({kind:'summary',id:workspaceId})).summary)throw new Error('WORKSPACE_NOT_FOUND');
       data={environment:{workspaceId,state:'UNCONFIGURED',stateRevision:null},plan:null,currentness:'UNKNOWN',qualificationKind:'NONE'};
     }else{
       const {plan}=environment.currentPlanId?await storage.readEnvironmentState({kind:'plan',id:environment.currentPlanId}):{plan:null};
       const {job}=await storage.readEnvironmentState({kind:'latest-job',id:environment.environmentId});
       data={environment:environmentSummary(environment),plan:plan?planSummary(plan):null,job:job?jobSummary(job):null,
         currentness:offline?'UNKNOWN':environment.state==='STALE'?'STALE':environment.checkedAt?'LAST_CHECKED':'UNKNOWN',
         qualificationKind:environment.state==='READY'?'QUALIFIED':environment.state==='MANUAL_VERIFIED'?'MANUAL':'NONE'};
     }
   }else if(method==='environment.list'){
     const projectId=String(params.projectId);
     if(c&&(c.projectId!==projectId||c.kind!=='list'||Object.keys(c).length!==5))throw new Error('REVISION_CONFLICT');
     const offset=c?.offset??0;
     if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0)throw new Error('INVALID_REQUEST');
     const page=await storage.readEnvironmentState({kind:'list',projectId,limit,offset});
     if(c&&c.revision!==page.pageRevision)throw new Error('REVISION_CONFLICT');
     data={items:page.items?.map(environmentSummary)??[],nextCursor:page.nextOffset===null?null:
       encode({kind:'list',storeId,projectId,revision:page.pageRevision,offset:page.nextOffset})};
   }else if(method==='environment.operation.get'){
     const {operation}=await storage.readFeatureState({kind:'operation',id:String(params.requestId)});
     if(!operation||operation.namespace!=='ENVIRONMENT')throw new Error('OPERATION_NOT_FOUND');
     data={operation:publicEnvironmentOperation(operation)};
   }else if(method==='environment.artifact.get'){
     const artifactId=String(params.artifactId),{artifact}=await storage.readEnvironmentState({kind:'artifact',id:artifactId});
     if(!artifact||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
     if(c&&(c.kind!=='artifact'||c.artifactId!==artifactId||c.sha256!==artifact.sha256||Object.keys(c).length!==5))throw new Error('REVISION_CONFLICT');
     const offset=c?.offset??0;
     if(typeof offset!=='number'||!Number.isSafeInteger(offset)||offset<0||offset>=artifact.bytes)throw new Error('INVALID_REQUEST');
     const chunk=await storage.readWorkflowArtifact(artifactId,offset,8192);
     if(chunk.sha256!==artifact.sha256||chunk.totalBytes!==artifact.bytes)throw new Error('ARTIFACT_CORRUPT');
     const next=offset+chunk.bytes.length;
     data={artifactId,sha256:chunk.sha256,totalBytes:chunk.totalBytes,offset,base64:Buffer.from(chunk.bytes).toString('base64'),
       nextCursor:next<chunk.totalBytes?encode({kind:'artifact',storeId,artifactId,sha256:artifact.sha256,offset:next}):null};
   }else if(method==='environment.job.get'||method==='environment.output.list'){
     const jobId=String(params.jobId),job=await jobs.get(jobId);
     if(method==='environment.job.get'){
       data={job:jobSummary(job)};
     }else{
       if(c&&(c.kind!=='output'||c.jobId!==jobId||c.revision!==job.stateRevision||Object.keys(c).length!==5))throw new Error('REVISION_CONFLICT');
       const after=String(c?.after??'0');
       const chunks=await jobs.output(jobId,after,limit);
       const last=chunks.at(-1)?.seq;
       data={jobId,chunks,watermark:job.outputWatermark,truncated:job.truncated,nextCursor:last&&BigInt(last)<BigInt(job.outputWatermark)?
         encode({kind:'output',storeId,jobId,revision:job.stateRevision,after:last}):null};
     }
   }else throw new Error('DAEMON_UNAVAILABLE');
   const result={...data,freshness};requireEnvironmentEnvelope(result);return result;
 };
}
