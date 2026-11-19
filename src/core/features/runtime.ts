import {createFeatureApproval} from './approval.js';
import {createFeatureAuthoring, type FeatureAuthoringOptions} from './authoring.js';
import {createHash} from 'node:crypto';
import type {StoragePort} from '../../ports/storage.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {Deadline} from '../../ports/clock.js';
import {FEATURE_READ_METHODS,publicFeatureOperation} from '../../protocol/feature.js';
import {createFeatureDispatch} from './dispatch.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {workflowAdmission} from '../workflow/admission.js';
import {recoverWorkflow} from '../workflow/recovery.js';
import type {WorkflowArtifact,WorkflowChange} from '../../ports/workflow.js';
const artifactMethods=['feature.artifact.reserve','feature.artifact.append','feature.artifact.seal','feature.artifact.discard'];
/** One daemon composition; no public test/provider substitution or second writer. */
export function createFeatureRuntime(storage:StoragePort,paths:ArchivePaths,instanceId:string,dependencies:{currentEligibility?:FeatureAuthoringOptions['currentEligibility']}={}){
 let accepting=false,safe=false;const authorization=createWorkflowAuthorization({storage,paths,instanceId});
 const methods:string[]=[...FEATURE_READ_METHODS.filter(m=>!['feature.eligibility.get','feature.planning.get','feature.questions.list','feature.output.list'].includes(m)),...artifactMethods];
 const jobs=new Set<Promise<void>>();
 function schedule(work:()=>Promise<void>){const job=Promise.resolve().then(work);jobs.add(job);void job.finally(()=>jobs.delete(job)).catch(()=>{});}
 const authoring=createFeatureAuthoring({storage,paths,instanceId,schedule,accepting:()=>accepting&&safe,...(dependencies.currentEligibility?{currentEligibility:dependencies.currentEligibility}:{})});
 const approval=createFeatureApproval({storage,paths,instanceId,schedule,accepting:()=>accepting&&safe,...(dependencies.currentEligibility?{currentEligibility:dependencies.currentEligibility}:{})},authoring);
 methods.push(...authoring.methods,...approval.methods);
 async function run(method:string,p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer):Promise<Record<string,unknown>>{
 if(!accepting||!safe)throw new Error('BLOCKED');
 if(method==='feature.prepare'&&['approve','handoff'].includes(String(p.action)))return approval.prepare(peer,p);
 if(approval.methods.includes(method))return approval.run(method,p,peer);
 if(!artifactMethods.includes(method))return authoring.run(method,p,peer);
 const snapshot=await authorization.guard(peer);const action=method.split('.').at(-1)!;
 if(!artifactMethods.includes(method))throw new Error('UNSUPPORTED_VERSION');const at=Date.now(),id=(p.uploadId??p.requestId) as string;
 const payload:Record<string,unknown>=action==='reserve'?{kind:p.kind,expectedBytes:p.expectedBytes,sha256:p.sha256,targetId:p.targetId??null}:action==='append'?{artifactId:id,offset:p.offset,byteLength:Buffer.from(p.base64 as string,'base64').length,sha256:p.chunkSha256}:{artifactId:id};
 const admission=workflowAdmission({requestId:p.requestId as string,grantId:null,instanceId,nowMs:at,intent:{version:1,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,namespace:'ARTIFACT',action,targetId:null,projectId:null,expectedRevision:null,configRevision:null,payload}});
 let change:WorkflowChange;
 if(action==='reserve'){
 if(p.targetId!==undefined&&p.targetId!==null){const f=(await storage.readFeatureState!({kind:'feature',id:p.targetId as string})).feature;if(!f)throw new Error('FEATURE_NOT_FOUND');}
 const artifact:WorkflowArtifact={artifactId:p.requestId as string,kind:p.kind as WorkflowArtifact['kind'],targetId:(p.targetId as string|undefined)??null,expectedBytes:p.expectedBytes as number,sha256:p.sha256 as string,offsetBytes:0,allocatedBytes:0,state:'RESERVED',referenceCount:0,createdAtMs:at,expiresAtMs:at+900000};change={kind:'reserve',admission,artifact};
 }else if(action==='append'){
 const bytes=Buffer.from(p.base64 as string,'base64');if(createHash('sha256').update(bytes).digest('hex')!==p.chunkSha256)throw new Error('INVALID_REQUEST');change={kind:'append',admission,artifactId:id,offset:p.offset as number,sha256:p.chunkSha256 as string,bytes};
 }else if(action==='seal'){
 const a=(await storage.readFeatureState!({kind:'artifact',id})).artifact;if(!a||a.expectedBytes!==p.expectedBytes||a.sha256!==p.sha256)throw new Error('INVALID_REQUEST');change={kind:'seal',admission,artifactId:id};
 }else change={kind:'discard',admission,artifactId:id};
 const result=await storage.commitFeatureState!(change);if(!result.operation)throw new Error('PERSISTENCE_UNAVAILABLE');
 return{operation:publicFeatureOperation(result.operation),...(result.artifact?{artifact:{artifactId:result.artifact.artifactId,sha256:result.artifact.sha256,expectedBytes:result.artifact.expectedBytes,offsetBytes:result.artifact.offsetBytes,state:result.artifact.state}}:{})};
 }
 return{methods,async idle(){while(jobs.size)await Promise.all([...jobs]);},dispatch:createFeatureDispatch({storage,mutations:{methods:[...artifactMethods,...authoring.methods,...approval.methods],run}}),
 fence(){accepting=false;},
 async recover(){accepting=false;try{safe=await recoverWorkflow(storage,instanceId);}catch{safe=false;}accepting=true;},
 async stop(deadline:Deadline){accepting=false;if(!jobs.size)return;let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([Promise.all([...jobs]),new Promise<never>((_r,reject)=>{timer=setTimeout(()=>reject(new Error('RESOURCE_IDENTITY_UNKNOWN')),Math.max(1,deadline.remainingMs()));})]);}finally{clearTimeout(timer);}},
 };
}
