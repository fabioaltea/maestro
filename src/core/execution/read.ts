import {featureFields,featureObject} from '../../domain/features/bundle.js';
import {requireDecimal} from '../../domain/identifiers.js';
import {publicExecutionOperation,requireExecutionEnvelope,validateExecutionParams,executionProviderId} from '../../protocol/execution.js';
import type {ExecutionProviderConfig,ExecutionRun} from '../../ports/execution.js';
import type {StoragePort} from '../../ports/storage.js';

const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(value:unknown,storeId:string,kind:string,target:string){
 if(value===undefined)return null;
 let cursor:Record<string,unknown>;
 try{
   cursor=featureObject(JSON.parse(Buffer.from(String(value),'base64url').toString('utf8')));
   featureFields(cursor,['kind','storeId','target','revision','position']);
   if(encode(cursor)!==value)throw new Error();
 }catch{throw new Error('INVALID_REQUEST');}
 if(cursor.storeId!==storeId)throw new Error('WRONG_STORE');
 if(cursor.kind!==kind||cursor.target!==target)throw new Error('REVISION_CONFLICT');
 return cursor;
}
function offset(value:unknown,limit=Number.MAX_SAFE_INTEGER){
 if(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>=limit)throw new Error('INVALID_REQUEST');
 return Number(value);
}
function publicRun(run:ExecutionRun){
 const {runId,sessionId,generation,providerId,configRevision,phase,outcome,requested,outputWatermark,truncated}=run;
 return{runId,sessionId,generation,providerId,configRevision,phase,outcome,requested,outputWatermark,truncated};
}
function publicProvider(p:ExecutionProviderConfig){
 return{providerId:p.providerId,configRevision:p.configRevision,modelId:p.modelId,status:p.status,
   capabilityDigest:p.capabilityDigest,safeError:p.error,nativeResume:false};
}
export function createExecutionReader({storage,storeId,offline}:{storage:StoragePort;storeId:string;offline:boolean}){
 const freshness=offline?'LAST_KNOWN':'CURRENT';
 return async(method:string,p:Readonly<Record<string,unknown>>):Promise<Record<string,unknown>>=>{
   validateExecutionParams(method,p);
   const query=storage.readExecutionState?.bind(storage);
   if(!query||!storage.readFeatureState)throw new Error('EXECUTION_NOT_INITIALIZED');
   const cursor=(target:string)=>decode(p.cursor,storeId,method,target);
   const next=(target:string,revision:string,position:unknown)=>encode({kind:method,storeId,target,revision,position});
   let data:Record<string,unknown>;
   switch(method){
     case 'execution.provider.get':{
       const providerId=executionProviderId(p.providerId),{provider}=await query({kind:'provider',id:providerId});
       data={provider:provider?publicProvider(provider):{providerId,status:'UNCONFIGURED',configRevision:null,nativeResume:false}};break;
     }
     case 'execution.get':{
       const {session}=await query({kind:'session',id:String(p.sessionId)});
       if(!session)throw new Error('OPERATION_NOT_FOUND');
       const [{run},{checkpoint},{interactions}]=await Promise.all([
         query({kind:'run',id:session.runId}),session.checkpointId?query({kind:'checkpoint',id:session.checkpointId}):{checkpoint:null},
         query({kind:'interactions',id:session.runId}),
       ]);
       if(!run||run.sessionId!==session.sessionId)throw new Error('STATE_CORRUPT');
       const current=(await query({kind:'session',id:session.sessionId})).session;
       if(current?.stateRevision!==session.stateRevision)throw new Error('REVISION_CONFLICT');
       data={session,run:publicRun(run),checkpoint,interactions,checkedAt:session.updatedAt};break;
     }
     case 'execution.list':{
       const projectId=String(p.projectId),after=cursor(projectId),{sessions,nextOffset,revision}=await query({kind:'sessions',projectId,
         offset:after?offset(after.position):0,limit:Number(p.limit??20)});
       if(after&&after.revision!==revision)throw new Error('REVISION_CONFLICT');
       data={items:sessions,nextCursor:nextOffset==null?null:next(projectId,revision!,nextOffset)};break;
     }
     case 'execution.operation.get':{
       const {operation}=await storage.readFeatureState({kind:'operation',id:String(p.requestId)});
       if(!operation)throw new Error('OPERATION_NOT_FOUND');
       data={operation:publicExecutionOperation(operation)};break;
     }
     case 'execution.output.list':{
       const runId=String(p.runId),after=cursor(runId);
       const position=after?requireDecimal(after.position):'0';
       const {run,output}=await query({kind:'output',id:runId,after:position});
       if(!run||!output)throw new Error('OPERATION_NOT_FOUND');
       // A run's generation is immutable and sequences only append. A cursor
       // can continue while the watermark advances, including across clients.
       if(after&&(after.revision!==run.generation||BigInt(position)>BigInt(run.outputWatermark)))throw new Error('REVISION_CONFLICT');
       const last=output.at(-1)?.seq??position;
       data={runId,chunks:output,watermark:run.outputWatermark,truncated:run.truncated,
         nextCursor:output.length||run.phase!=='FINALIZED'?next(runId,run.generation,last):null};break;
     }
     case 'execution.artifact.get':{
       const artifactId=String(p.artifactId),after=cursor(artifactId),{artifact}=await query({kind:'artifact',id:artifactId});
       if(!artifact||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
       if(after&&after.revision!==artifact.sha256)throw new Error('REVISION_CONFLICT');
       const position=after?offset(after.position,artifact.bytes):0;
       const chunk=await storage.readWorkflowArtifact(artifactId,position,8192);
       if(chunk.sha256!==artifact.sha256||chunk.totalBytes!==artifact.bytes||chunk.bytes.length===0||chunk.bytes.length>8192)throw new Error('ARTIFACT_CORRUPT');
       const following=position+chunk.bytes.length;
       data={artifactId,sha256:artifact.sha256,totalBytes:artifact.bytes,offset:position,base64:Buffer.from(chunk.bytes).toString('base64'),
         nextCursor:following<artifact.bytes?next(artifactId,artifact.sha256,following):null};break;
     }
     default:throw new Error('UNSUPPORTED_VERSION');
   }
   const result={...data,freshness};requireExecutionEnvelope(result);return result;
 };
}
