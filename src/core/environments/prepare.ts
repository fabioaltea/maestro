import {createHash,randomUUID} from 'node:crypto';
import {featureObject} from '../../domain/features/bundle.js';
import {mayCleanEnvironmentJob} from '../../domain/environments/validation.js';
import {createEnvironmentValidation} from './validate.js';
import {createEnvironmentRecovery,environmentJobIdentity as jobIdentity} from './recovery.js';
import {requireEnvironmentInstall} from '../../domain/environments/jobs.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {EnvironmentDelegatedCheck,EnvironmentExitEvidence,EnvironmentJob,EnvironmentJobHostPort,EnvironmentLeasePort,EnvironmentPlan,EnvironmentRecord} from '../../ports/environment.js';
import type {WorkspaceLease,WorkspaceRecord} from '../../ports/workspace.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {publicEnvironmentOperation} from '../../protocol/environment.js';
import {classifyError} from '../control-main.js';
import {publishPlanningArtifact} from '../features/artifacts.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {currentEnvironmentPlan,environmentWorkspace,inspectEnvironmentWorkspace,type EnvironmentPlanningOptions} from './plan.js';

export interface EnvironmentInstallationOptions extends EnvironmentPlanningOptions{
 readonly lease:EnvironmentLeasePort;readonly host:EnvironmentJobHostPort;
 readonly readValidationTree?:(workspace:WorkspaceRecord)=>Promise<string>;
}
type Params=Readonly<Record<string,unknown>>;
const digest=(value:unknown)=>value===null?null:createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createEnvironmentInstallation(options:EnvironmentInstallationOptions){
 const {storage,paths,instanceId,host,lease:leases}=options,authorization=createWorkflowAuthorization(options);
 const running=new Map<string,{generation:string;controller:AbortController}>();
 async function loadPlan(planId:string){
   const {plan}=await storage.readEnvironmentState!({kind:'plan',id:planId});
   if(!plan)throw new Error('ENVIRONMENT_NOT_FOUND');
   const {environment}=await storage.readEnvironmentState!({kind:'environment',id:plan.environmentId});
   if(!environment||environment.currentPlanId!==planId)throw new Error('ENVIRONMENT_STALE');
   return{environment,plan};
 }
 async function loadEnvironment(id:string){
   const {environment}=await storage.readEnvironmentState!({kind:'environment',id});
   if(!environment?.currentPlanId)throw new Error('ENVIRONMENT_NOT_FOUND');
   return loadPlan(environment.currentPlanId);
 }
 async function loadJob(jobId:string){
   const {job}=await storage.readEnvironmentState!({kind:'job',id:jobId});
   if(!job)throw new Error('OPERATION_NOT_FOUND');
   const [{environment},{plan}]=await Promise.all([storage.readEnvironmentState!({kind:'environment',id:job.environmentId}),
     storage.readEnvironmentState!({kind:'plan',id:job.planId})]);
   if(!environment||!plan)throw new Error('STATE_CORRUPT');
   return{job,environment,plan};
 }
 async function check(current:EnvironmentRecord,plan:EnvironmentPlan,state:EnvironmentRecord['state']='PLANNED'){
   const {workspace,project}=await environmentWorkspace(storage,current.workspaceId);
   if(workspace.ownerGeneration!==plan.workspaceGeneration||project.configRevision!==plan.configRevision)throw new Error('ENVIRONMENT_STALE');
   const {plan:currentPlan}=await currentEnvironmentPlan(storage,workspace.workspaceId);
   if(currentPlan.planId!==plan.planId||currentPlan.digest!==plan.digest)throw new Error('ENVIRONMENT_STALE');
   const observed=await inspectEnvironmentWorkspace(options,workspace,plan.metadata.managerVersion??undefined);
   if(observed.validationProfileDigest!==plan.metadata.validationProfileDigest)throw new Error('ENVIRONMENT_STALE');
   requireEnvironmentInstall({state,disposition:observed.disposition,pinDigest:digest(plan.metadata.pin),observedPinDigest:digest(observed.pin),
     inputDigest:plan.inputDigest,observedInputDigest:observed.inputDigest});
   return{workspace,project};
 }
 async function grant(peer:AuthenticatedPeer,intent:WorkflowIntent,summary:Record<string,unknown>){
   const result=await authorization.prepare(peer,intent);
   return{grantId:result.grantId,expiresAtMs:result.expiresAtMs,canonicalIntentHash:createHash('sha256').update(result.canonicalIntent).digest('hex'),summary};
 }
 async function authorizeInstall(params:Params,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),payload=featureObject(params.intent),revision=String(featureObject(params.expectedRevisions).stateRevision);
   const {environment,plan}=await loadPlan(String(payload.planId));
   if(environment.stateRevision!==revision||plan.digest!==payload.planDigest)throw new Error('ENVIRONMENT_STALE');
   const {workspace,project}=await check(environment,plan,environment.state);
   const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'prepare',storeId:store.storeId,ownerUid:store.ownerUid,targetId:workspace.workspaceId,
     projectId:workspace.projectId,expectedRevision:revision,configRevision:project.configRevision,
     payload:{planId:plan.planId,planDigest:plan.digest,inputDigest:plan.inputDigest,workspaceRevision:workspace.stateRevision,jobGeneration:randomUUID()}};
   return grant(peer,intent,{action:'prepare',workspaceId:workspace.workspaceId,planId:plan.planId,planDigest:plan.digest,inputDigest:plan.inputDigest,
     stateRevision:revision,managerVersion:plan.metadata.managerVersion,networkScope:plan.metadata.registryOrigin?'LOOPBACK':'OFFLINE',
     scriptPolicy:'DISABLED',importMethod:'clone-or-copy'});
 }
 async function authorizeCancel(params:Params,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),payload=featureObject(params.intent),revision=String(featureObject(params.expectedRevisions).stateRevision);
   const {job,environment}=await loadJob(String(payload.jobId));
   if(job.stateRevision!==revision||!['QUEUED','RUNNING'].includes(job.phase))throw new Error('REVISION_CONFLICT');
   const active=running.get(job.jobId);
   if(!active||active.generation!==job.generation)throw new Error('JOB_RECONCILING');
   const {workspace,project}=await environmentWorkspace(storage,environment.workspaceId);
   const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'cancel',storeId:store.storeId,ownerUid:store.ownerUid,targetId:workspace.workspaceId,
     projectId:project.projectId,expectedRevision:revision,configRevision:project.configRevision,payload:{jobId:job.jobId,jobGeneration:job.generation}};
   return grant(peer,intent,{action:'cancel',workspaceId:workspace.workspaceId,jobId:job.jobId,stateRevision:revision});
 }
 async function release(lease:WorkspaceLease|null){
   if(lease)await leases.release(lease,{...lease,kind:'CHECKPOINT',durable:true,quiescent:true});
 }
 async function cleanup(job:EnvironmentJob,workspaceId:string){
   if(job.kind!=='VALIDATE'||!job.leaseId||!host.cleanup)return;
   const {lease}=await storage.readWorkspaceState!({kind:'active-lease',id:workspaceId});
   if(mayCleanEnvironmentJob({verified:job.exitProof?.verified===true,quiescent:job.completedAt!==null,
     hasLease:lease?.leaseId===job.leaseId,referenced:false}))await host.cleanup(jobIdentity(job));
 }
 async function settleLease(job:EnvironmentJob,workspaceId:string,bound:WorkspaceLease|null){
   await release(bound).catch(()=>{});
   await cleanup(job,workspaceId).catch(()=>{});
 }
 async function finish(job:EnvironmentJob,environment:EnvironmentRecord,proof:EnvironmentExitEvidence|null,inputsCurrent:boolean,
   settlement:{noLaunchError?:string;recovering?:boolean;reconcileId?:string}={}){
   let artifactId:string|undefined;
   if(proof){
     try{
       const {store}=(await storage.readSnapshot())!;
       const artifact=await publishPlanningArtifact({storage,storeId:store.storeId,ownerUid:paths.ownerUid,instanceId,targetId:environment.workspaceId},'OUTPUT',
         {jobId:job.jobId,outcome:proof.outcome,exitCode:proof.exitCode,code:proof.error,inputDigest:job.inputDigest,
           commandSpecId:job.commandSpecId,capturedBytes:proof.capturedBytes??0,truncated:proof.truncated===true});
       artifactId=artifact.artifactId;
     }catch{/* The terminal reservation remains available when ordinary output allocation is full. */}
   }
   const args={kind:'job-finish' as const,jobId:job.jobId,instanceId,generation:job.generation,proof,inputsCurrent,
     ...settlement,...(artifactId?{outputArtifactId:artifactId}:{})};
   return storage.commitEnvironmentState!(args);
 }
 async function requireValidationTree(workspace:WorkspaceRecord,intent:WorkflowIntent){
   if(intent.payload.treeDigest===undefined)return;
   if(!options.readValidationTree||await options.readValidationTree(workspace)!==intent.payload.treeDigest)throw new Error('REVIEW_STALE');
 }
 async function checkAfter(environment:EnvironmentRecord,plan:EnvironmentPlan,job?:EnvironmentJob){
   try{
     const {workspace}=await check(environment,plan);
     if(job){
       const {operation}=await storage.readFeatureState!({kind:'operation',id:job.requestId});
       if(!operation)return false;
       await requireValidationTree(workspace,JSON.parse(operation.canonicalIntent) as WorkflowIntent);
     }
     return true;
   }catch{return false;}
 }
 async function work(job:EnvironmentJob,intent:WorkflowIntent,controller:AbortController){
   let bound:WorkspaceLease|null=null,started=false,hostInvoked=false,proof:EnvironmentExitEvidence|null=null;
   try{
     const {environment,plan}=await loadJob(job.jobId),{workspace}=await check(environment,plan);
     if(controller.signal.aborted)throw new Error('CANCELLED');
     if(workspace.stateRevision!==intent.payload.workspaceRevision)throw new Error('REVISION_CONFLICT');
     bound=await leases.acquire({workspaceId:workspace.workspaceId,stateRevision:workspace.stateRevision,holderId:job.jobId,generation:job.generation});
     const identity=jobIdentity(job,bound.leaseId);
     const {job:attached}=await storage.commitEnvironmentState!({kind:'job-start',jobId:job.jobId,instanceId,identity});
     started=true;job=attached??job;
     if(controller.signal.aborted){
       proof={...identity,verified:true,exitCode:null,outcome:'CANCELLED',error:'CANCELLED'};
     }else{
       const current=await check(environment,plan),root=(await options.owned(current.workspace)).root;
       if(job.kind==='VALIDATE'){
         const command=plan.metadata.commands?.find(spec=>spec.id===job.commandSpecId),pin=plan.metadata.pin,profileDigest=plan.metadata.validationProfileDigest;
         if(!command||!pin||!profileDigest)throw new Error('ENVIRONMENT_STALE');
         await requireValidationTree(current.workspace,intent);
         if(controller.signal.aborted)throw new Error('CANCELLED');
         hostInvoked=true;
         proof=await host.validate(identity,{workspace:root,command,nodeDigest:pin.nodeDigest,profileDigest},makeDeadline(systemClock,300000),controller.signal);
       }else{
         const manifest=plan.metadata.inputs.find(entry=>entry.path==='package.json'),lock=plan.metadata.inputs.find(entry=>entry.path==='pnpm-lock.yaml');
         if(!manifest||!lock)throw new Error('ENVIRONMENT_STALE');
         hostInvoked=true;
         proof=await host.install(identity,{workspace:root,registryOrigin:plan.metadata.registryOrigin,manifestDigest:manifest.sha256,lockDigest:lock.sha256,
           ...(plan.metadata.managerVersion?{selectedVersion:plan.metadata.managerVersion}:{})},makeDeadline(systemClock,300000),controller.signal);
       }
     }
     const current=!!proof&&(job.kind==='VALIDATE'||proof.outcome==='SUCCEEDED')&&await checkAfter(environment,plan,job);
     const result=await finish(job,environment,proof,current);
     if(result.operation.phase==='FINALIZED'&&proof)await settleLease(result.job??job,environment.workspaceId,bound);
   }catch(error){
     try{
       const {job:currentJob,environment,plan}=await loadJob(job.jobId);
       if(currentJob.leaseId)started=true;
       const code=classifyError(error);
       if(started&&!hostInvoked&&currentJob.leaseId&&!proof)
         proof={...jobIdentity(currentJob),verified:true,exitCode:null,outcome:'FAILED',error:code};
       const current=currentJob.kind==='VALIDATE'&&(!started||!!proof)&&await checkAfter(environment,plan,currentJob);
       const result=await finish(currentJob,environment,proof,current,started?{}:{noLaunchError:code});
       if(result.operation.phase==='FINALIZED'&&(!started||proof))await settleLease(result.job??currentJob,environment.workspaceId,bound);
     }catch{/* A lost proof preserves the durable lease and original job. */}
   }finally{running.delete(job.jobId);}
 }
 async function submit(params:Params,peer:AuthenticatedPeer,action:'prepare'|'validate',delegated=false){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,action,'ENVIRONMENT');
   if(delegated?original.intent.payload.delegatedJobId!==requestId:original.intent.payload.delegatedJobId!==undefined)
     throw new Error('APPROVAL_REQUIRED');
   if(original.operation)return{operation:publicEnvironmentOperation(original.operation)};
   if(!options.accepting())throw new Error('BLOCKED');
   const {intent}=original,result=await storage.commitEnvironmentState!({kind:'job-admit',
     admission:workflowAdmission({requestId,grantId,intent,instanceId,nowMs:Date.now()})});
   if(!result.inserted)return{operation:publicEnvironmentOperation(result.operation)};
   const job=result.job!,controller=new AbortController();
   running.set(job.jobId,{generation:job.generation,controller});options.schedule(()=>work(job,intent,controller));
   return{accepted:true,requestId,workspaceId:intent.targetId,jobId:job.jobId,stateRevision:job.stateRevision};
 }
 async function cancel(params:Params,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,'cancel','ENVIRONMENT');
   if(original.operation)return{operation:publicEnvironmentOperation(original.operation)};
   const {intent}=original,jobId=String(intent.payload.jobId),control=running.get(jobId);
   if(!control||control.generation!==intent.payload.jobGeneration)throw new Error('JOB_RECONCILING');
   const result=await storage.commitEnvironmentState!({kind:'job-cancel',
     admission:workflowAdmission({requestId,grantId,intent,instanceId,nowMs:Date.now()})});
   if(!result.inserted)return{operation:publicEnvironmentOperation(result.operation)};
   control.controller.abort();
   return{accepted:true,requestId,workspaceId:intent.targetId,jobId,stateRevision:result.job!.stateRevision};
 }
 const validation=createEnvironmentValidation(options,{guard:authorization.guard,loadEnvironment,check,grant});
 async function delegatedCheck(input:EnvironmentDelegatedCheck,peer:AuthenticatedPeer){
   if(!options.accepting()||!options.readValidationTree)throw new Error('BLOCKED');
   const {environment}=await currentEnvironmentPlan(storage,input.workspaceId);
   const {grantId}=await validation({intent:{environmentId:environment.environmentId,inputDigest:input.inputDigest,
     commandSpecId:input.commandSpecId},expectedRevisions:{stateRevision:environment.stateRevision}},peer,input);
   return submit({requestId:input.jobId,grantId},peer,'validate',true);
 }
 const recovery=createEnvironmentRecovery(options,{guard:authorization.guard,loadJob,active:id=>running.has(id),current:checkAfter,finish,release,cleanup});
 return{
   ...(options.readValidationTree?{delegatedCheck}:{}),
   actions:{'environment.prepare':(params:Params,peer:AuthenticatedPeer)=>params.action==='prepare'?authorizeInstall(params,peer):
     params.action==='cancel'?authorizeCancel(params,peer):params.action==='validate'?validation(params,peer):
     params.action===undefined?submit(params,peer,'prepare'):Promise.reject(new Error('UNSUPPORTED_VERSION')),
     'environment.cancel':cancel,'environment.validate':(params:Params,peer:AuthenticatedPeer)=>submit(params,peer,'validate'),
     'environment.reconcile':recovery.observe},
   stop(){for(const {controller} of running.values())controller.abort();},
   recover:recovery.recover,
 };
}
