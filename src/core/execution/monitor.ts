import {randomUUID} from 'node:crypto';
import {EXECUTION_LIMITS} from '../../domain/execution/model.js';
import {executionInteractionText} from '../../domain/execution/interaction.js';
import type {ExecutionChange,ExecutionRun} from '../../ports/execution.js';
import type {StoragePort} from '../../ports/storage.js';
import {publishPlanningArtifact} from '../features/artifacts.js';

export function executionMonitor(options:{storage:StoragePort;storeId:string;ownerUid:number;instanceId:string;run:ExecutionRun}){
 const {storage,instanceId,run}=options,{runId,generation}=run;
 const commit=(c:ExecutionChange)=>storage.commitExecutionState!(c);
 const query=storage.readExecutionState!;
 let truncated=false,remaining:number=EXECUTION_LIMITS.outputBytes;
 const outputContext={...options,targetId:runId};
 return{
   async output(text:string){
     if(truncated)return;
     const bytes=Buffer.byteLength(JSON.stringify(text));
     if(!text.isWellFormed()||bytes>EXECUTION_LIMITS.outputChunkBytes||bytes>remaining){
       truncated=true;await commit({kind:'output',runId,instanceId,generation,artifactId:null});return;
     }
     try{
       const artifact=await publishPlanningArtifact(outputContext,'OUTPUT',text);
       await commit({kind:'output',runId,instanceId,generation,artifactId:artifact.artifactId});
       remaining-=artifact.expectedBytes;
     }catch(error){
       if(!(error instanceof Error)||!['RESOURCE_LIMIT','EVENT_BACKPRESSURE'].includes(error.message))throw error;
       truncated=true;
       await commit({kind:'output',runId,instanceId,generation,artifactId:null});
     }
   },
   async question(raw:string){
     const text=executionInteractionText(raw);
     const {session}=await query({kind:'session',id:run.sessionId});
     if(!session||session.runId!==runId)throw new Error('STALE_TARGET');
     const buffer=Buffer.from(text,'utf8');
     const artifact=await publishPlanningArtifact(outputContext,'OUTPUT',buffer);
     const interactionId=randomUUID();
     await commit({kind:'question',runId,instanceId,interaction:{runId,generation,interactionId,
       expectedRevision:String(BigInt(session.stateRevision)+1n),textArtifactId:artifact.artifactId,type:'QUESTION',status:'OPEN',answerArtifactId:null}});
     return interactionId;
   },
 };
}
