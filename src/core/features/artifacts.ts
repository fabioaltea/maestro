import {createHash,randomUUID} from 'node:crypto';
import type {StoragePort} from '../../ports/storage.js';
import type {WorkflowArtifact} from '../../ports/workflow.js';
import {workflowAdmission} from '../workflow/admission.js';

const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function readSealedFeatureArtifact(storage:Pick<StoragePort,'readFeatureState'|'readWorkflowArtifact'>,artifactId:string,kind:WorkflowArtifact['kind'],maximumBytes:number,featureId?:string){
 const artifact=(await storage.readFeatureState!({kind:'artifact',id:artifactId})).artifact;
 if(!artifact||artifact.kind!==kind||!['SEALED','REFERENCED'].includes(artifact.state)
   ||artifact.expectedBytes>maximumBytes||artifact.targetId!==null&&artifact.targetId!==featureId||!storage.readWorkflowArtifact)throw new Error('ARTIFACT_CORRUPT');
 const bytes=Buffer.alloc(artifact.expectedBytes);
 for(let offset=0;offset<bytes.length;){
   const chunk=await storage.readWorkflowArtifact(artifactId,offset,8192);
   if(chunk.sha256!==artifact.sha256||chunk.totalBytes!==bytes.length||!chunk.bytes.length||chunk.bytes.length>8192||offset+chunk.bytes.length>bytes.length)throw new Error('ARTIFACT_CORRUPT');
   bytes.set(chunk.bytes,offset);offset+=chunk.bytes.length;
 }
 if(digest(bytes)!==artifact.sha256)throw new Error('ARTIFACT_CORRUPT');
 return{artifact,text:new TextDecoder('utf-8',{fatal:true}).decode(bytes)};
}

/** Trusted workflow output uses the existing quota, seal and fsync path. */
export async function publishPlanningArtifact(options:{storage:StoragePort;storeId:string;ownerUid:number;instanceId:string;targetId:string},kind:'BUNDLE'|'OUTPUT'|'CHECKPOINT',value:unknown){
 const {storage,storeId,ownerUid,instanceId,targetId}=options;
 const bytes=(value instanceof Uint8Array?Buffer.from(value):Buffer.from(JSON.stringify(value))),artifactId=randomUUID(),sha256=digest(bytes),at=Date.now();
 if(bytes.length>262144)throw new Error('CONTEXT_LIMIT');
 const admission=(requestId:string,action:string,payload:Record<string,unknown>)=>workflowAdmission({requestId,grantId:null,instanceId,nowMs:Date.now(),
   intent:{version:1,storeId,ownerUid,namespace:'ARTIFACT',action,targetId:null,projectId:null,expectedRevision:null,configRevision:null,payload}});
 const artifact:WorkflowArtifact={artifactId,kind,targetId,expectedBytes:bytes.length,sha256,offsetBytes:0,allocatedBytes:0,
   state:'RESERVED',referenceCount:0,createdAtMs:at,expiresAtMs:at+900000};
 const commit=storage.commitFeatureState!;
 await commit({kind:'reserve',admission:admission(artifactId,'reserve',{kind,expectedBytes:bytes.length,sha256,targetId}),artifact});
 for(let offset=0;offset<bytes.length;offset+=8192){
   const chunk=bytes.subarray(offset,offset+8192),sha256=digest(chunk);
   await commit({kind:'append',admission:admission(randomUUID(),'append',{artifactId,offset,byteLength:chunk.length,sha256}),artifactId,offset,sha256,bytes:chunk});
 }
 const result=await commit({kind:'seal',admission:admission(randomUUID(),'seal',{artifactId}),artifactId});
 if(result.artifact?.state!=='SEALED')throw new Error('ARTIFACT_CORRUPT');
 return result.artifact;
}
