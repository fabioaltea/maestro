import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {EnvironmentExitEvidence,EnvironmentJob,EnvironmentPlan,EnvironmentRecord,EnvironmentWrite} from '../../ports/environment.js';
import type {WorkspaceLease} from '../../ports/workspace.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {publicEnvironmentOperation} from '../../protocol/environment.js';
import {workflowAdmission} from '../workflow/admission.js';
import {environmentWorkspace} from './plan.js';
import type {EnvironmentInstallationOptions} from './prepare.js';

export const environmentJobIdentity=(job:EnvironmentJob,leaseId=job.leaseId!)=>({jobId:job.jobId,generation:job.generation,leaseId});

export function createEnvironmentRecovery(options:EnvironmentInstallationOptions,tools:{
 guard(peer:AuthenticatedPeer):Promise<{store:{storeId:string;ownerUid:number}}>;
 loadJob(id:string):Promise<{job:EnvironmentJob;environment:EnvironmentRecord;plan:EnvironmentPlan}>;
 active(id:string):boolean;
 current(environment:EnvironmentRecord,plan:EnvironmentPlan,job?:EnvironmentJob):Promise<boolean>;
 finish(job:EnvironmentJob,environment:EnvironmentRecord,proof:EnvironmentExitEvidence|null,current:boolean,
   settlement?:{noLaunchError?:string;recovering?:boolean;reconcileId?:string}):Promise<EnvironmentWrite>;
 release(lease:WorkspaceLease|null):Promise<void>;
 cleanup(job:EnvironmentJob,workspaceId:string):Promise<void>;
}){
 const {storage,instanceId,host}=options;
 const observations=new Map<string,Promise<void>>();
 async function release(job:EnvironmentJob,workspaceId:string){
   const {lease}=await storage.readWorkspaceState!({kind:'active-lease',id:workspaceId});
   if(lease?.holderType==='ENVIRONMENT'&&lease.holderId===job.jobId&&lease.generation===job.generation&&(!job.leaseId||job.leaseId===lease.leaseId))
     await tools.release(lease).catch(()=>{});
   await tools.cleanup(job,workspaceId).catch(()=>{});
 }
 async function observe(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await tools.guard(peer),jobId=String(params.jobId),requestId=String(params.requestId),revision=String(params.expectedStateRevision);
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   if(operation){
     const intent=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
     if(intent.namespace!=='ENVIRONMENT'||intent.action!=='reconcile'||intent.storeId!==store.storeId||
       intent.payload.jobId!==jobId||intent.expectedRevision!==revision)throw new Error('IDEMPOTENCY_CONFLICT');
     if(operation.phase==='FINALIZED')return{operation:publicEnvironmentOperation(operation)};
   }
   const {job,environment}=await tools.loadJob(jobId);
   const {workspace,project}=await environmentWorkspace(storage,environment.workspaceId);
   if(!operation){
     const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'reconcile',storeId:store.storeId,ownerUid:store.ownerUid,targetId:workspace.workspaceId,
       projectId:project.projectId,expectedRevision:revision,configRevision:project.configRevision,payload:{jobId}};
     const admitted=await storage.commitEnvironmentState!({kind:'job-observe',
       admission:workflowAdmission({requestId,grantId:null,intent,instanceId,nowMs:Date.now()})});
     if(admitted.operation.phase==='FINALIZED')return{operation:publicEnvironmentOperation(admitted.operation)};
   }
   options.schedule(async()=>{
     const prior=observations.get(jobId);
     const next=(prior??Promise.resolve()).catch(()=>{}).then(async()=>{
       const current=await tools.loadJob(jobId),target=current.job;
       if(target.phase==='RECONCILING'&&target.leaseId&&!tools.active(jobId)&&target.stateRevision===revision){
         const proof=await host.recover(environmentJobIdentity(target));
         if(proof){
           const fresh=(target.kind==='VALIDATE'||proof.outcome==='SUCCEEDED')&&await tools.current(current.environment,current.plan,target);
           const result=await tools.finish(target,current.environment,proof,fresh,{reconcileId:requestId});
           if(result.operation.phase==='FINALIZED')await release(result.job??target,current.environment.workspaceId);
         }
       }
       await storage.commitEnvironmentState!({kind:'job-observed',requestId,instanceId});
     });
     observations.set(jobId,next);
     try{await next;}catch{/* Pending observations remain queryable and are settled after restart. */}
     finally{if(observations.get(jobId)===next)observations.delete(jobId);}
   });
   return{accepted:true,requestId,workspaceId:workspace.workspaceId,jobId,stateRevision:job.stateRevision};
 }
 return{observe,async recover(){
   const {jobs:retained=[]}=await storage.readEnvironmentState!({kind:'retained-leases'});
   for(const job of retained){
     const {environment}=await tools.loadJob(job.jobId);
     if(job.exitProof?.verified)await release(job,environment.workspaceId);
   }
   const {jobs:active=[]}=await storage.readEnvironmentState!({kind:'active'});
   for(const job of active){
     const {environment,plan}=await tools.loadJob(job.jobId);
     const proof=job.leaseId?await host.recover(environmentJobIdentity(job)):null;
     if(job.phase==='RECONCILING'&&!proof)continue;
     const current=(job.kind==='VALIDATE'||proof?.outcome==='SUCCEEDED')&&await tools.current(environment,plan,job);
     const result=await tools.finish(job,environment,proof,current,{recovering:true,...(!job.leaseId?{noLaunchError:'INTERRUPTED'}:{})});
     if(result.operation.phase==='FINALIZED'&&(proof||!job.leaseId))await release(result.job??job,environment.workspaceId);
   }
   const {operations=[]}=await storage.readEnvironmentState!({kind:'pending-reconciles'});
   for(const operation of operations)await storage.commitEnvironmentState!({kind:'job-observed',instanceId,requestId:operation.requestId,recovering:true});
 }};
}
