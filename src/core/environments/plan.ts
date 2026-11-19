import {createHash,randomUUID} from 'node:crypto';
import type {FilesystemAnchor} from '../../ports/repository.js';
import type {StoragePort} from '../../ports/storage.js';
import type {ArchivePaths,AuthenticatedPeer} from '../../ports/platform.js';
import type {WorkspaceRecord} from '../../ports/workspace.js';
import type {EnvironmentInspectPort,EnvironmentPlan} from '../../ports/environment.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import {featureObject} from '../../domain/features/bundle.js';
import {requireCurrentEnvironmentPlan} from '../../domain/environments/plan.js';
import {classifyError} from '../control-main.js';
import {publishPlanningArtifact,readSealedFeatureArtifact} from '../features/artifacts.js';
import {workspaceFence} from '../workspaces/leases.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {publicEnvironmentOperation} from '../../protocol/environment.js';
import type {EnvironmentRuntimeContext} from './runtime.js';

export interface EnvironmentPlanningOptions extends EnvironmentRuntimeContext {
 readonly storage:StoragePort;readonly paths:ArchivePaths;readonly instanceId:string;readonly inspector:EnvironmentInspectPort;
 readonly owned:(workspace:WorkspaceRecord)=>Promise<{readonly root:FilesystemAnchor}>;
}
export async function environmentWorkspace(storage:StoragePort,workspaceId:string){
 const {workspace}=await storage.readWorkspaceState!({kind:'get',id:workspaceId});
 if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
 const project=(await storage.getProject(workspace.projectId))?.project;
 if(!project||project.removedAt!==null)throw new Error('PROJECT_REMOVED');
 return{workspace,project};
}
export async function currentEnvironmentPlan(storage:StoragePort,workspaceId:string){
 const {environment}=await storage.readEnvironmentState!({kind:'workspace',id:workspaceId});
 if(!environment?.currentPlanId)throw new Error('ENVIRONMENT_NOT_FOUND');
 const {plan}=await storage.readEnvironmentState!({kind:'plan',id:environment.currentPlanId});
 if(!plan||plan.environmentId!==environment.environmentId)throw new Error('STATE_CORRUPT');
 const {artifact}=await readSealedFeatureArtifact(storage,plan.artifactId,'BUNDLE',32768,workspaceId);
 if(artifact.sha256!==plan.digest)throw new Error('ARTIFACT_CORRUPT');
 return{environment,plan};
}
export async function inspectEnvironmentWorkspace(options:Pick<EnvironmentPlanningOptions,'owned'|'inspector'>,workspace:WorkspaceRecord,selectedVersion?:string){
 const {root}=await options.owned(workspace);
 return options.inspector.inspect(root,makeDeadline(systemClock,10000),selectedVersion);
}

export function createEnvironmentPlanning(options:EnvironmentPlanningOptions){
 const {storage,paths,instanceId}=options,authorization=createWorkflowAuthorization(options);
 async function work(intent:WorkflowIntent,workspace:WorkspaceRecord,requestId:string){
   try{
     const selectedVersion=typeof intent.payload.selectedVersion==='string'?intent.payload.selectedVersion:undefined;
     const metadata=await inspectEnvironmentWorkspace(options,workspace,selectedVersion);
     const {environment}=await storage.readEnvironmentState!({kind:'workspace',id:workspace.workspaceId});
     const artifact=await publishPlanningArtifact({storage,storeId:intent.storeId,ownerUid:paths.ownerUid,instanceId,targetId:workspace.workspaceId},'BUNDLE',metadata);
     const plan:EnvironmentPlan={planId:requestId,environmentId:environment?.environmentId??randomUUID(),workspaceGeneration:workspace.ownerGeneration,
       workspaceRevision:workspace.stateRevision,configRevision:intent.configRevision!,digest:artifact.sha256,inputDigest:metadata.inputDigest,artifactId:artifact.artifactId,
       metadata,createdAt:new Date().toISOString()};
     await storage.commitEnvironmentState!({kind:'plan-finish',instanceId,requestId,fence:workspaceFence(workspace),plan});
   }catch(error){
     try{await storage.commitEnvironmentState!({kind:'plan-block',instanceId,requestId,error:classifyError(error)});}
     catch{/* The original admitted request stays available if persistence is uncertain. */}
   }
 }
 async function plan(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer),workspaceId=String(params.workspaceId),requestId=String(params.requestId);
   const {operation}=await storage.readFeatureState!({kind:'operation',id:requestId});
   if(operation){
     const prior=JSON.parse(operation.canonicalIntent) as WorkflowIntent;
     if(prior.namespace!=='ENVIRONMENT'||prior.action!=='plan'||prior.targetId!==workspaceId||prior.storeId!==store.storeId
       ||prior.expectedRevision!==params.expectedStateRevision||prior.payload.selectedVersion!==(params.managerVersion??null))throw new Error('IDEMPOTENCY_CONFLICT');
     return{operation:publicEnvironmentOperation(operation)};
   }
   const {workspace,project}=await environmentWorkspace(storage,workspaceId);
   const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'plan',storeId:store.storeId,ownerUid:store.ownerUid,
     targetId:workspaceId,projectId:project.projectId,expectedRevision:String(params.expectedStateRevision),configRevision:project.configRevision,
     payload:{selectedVersion:params.managerVersion??null}};
   if(!options.accepting())throw new Error('BLOCKED');
   const result=await storage.commitEnvironmentState!({kind:'plan-admit',admission:workflowAdmission({requestId,intent,grantId:null,instanceId,nowMs:Date.now()})});
   if(!result.inserted)return{operation:publicEnvironmentOperation(result.operation)};
   options.schedule(()=>work(intent,workspace,requestId));
   return{accepted:true,requestId,workspaceId,stateRevision:workspace.stateRevision};
 }
 async function attestScope(workspaceId:string){
   const {workspace,project}=await environmentWorkspace(storage,workspaceId);
   const {environment,plan}=await currentEnvironmentPlan(storage,workspaceId);
   if(environment.state!=='MANUAL_REQUIRED'||workspace.state!=='READY'||plan.configRevision!==project.configRevision)throw new Error('ENVIRONMENT_STALE');
   const observed=await inspectEnvironmentWorkspace(options,workspace,plan.metadata.managerVersion??undefined);
   return{workspace,project,environment,plan,observed};
 }
 async function authorizeAttest(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   const {store}=await authorization.guard(peer);
   const payload=featureObject(params.intent),workspaceId=String(payload.workspaceId);
   const {workspace,project,environment,plan,observed}=await attestScope(workspaceId);
   const expectedRevision=String(featureObject(params.expectedRevisions).stateRevision);
   requireCurrentEnvironmentPlan({planId:plan.planId,workspaceGeneration:workspace.ownerGeneration,inputDigest:observed.inputDigest,stateRevision:environment.stateRevision},
     {planId:plan.planId,workspaceGeneration:plan.workspaceGeneration,inputDigest:String(payload.inputDigest),stateRevision:expectedRevision});
   if(plan.inputDigest!==observed.inputDigest)throw new Error('ENVIRONMENT_STALE');
   const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'attest',storeId:store.storeId,ownerUid:store.ownerUid,
     targetId:workspaceId,projectId:project.projectId,expectedRevision,configRevision:project.configRevision,
     payload:{planId:plan.planId,inputDigest:plan.inputDigest,workspaceGeneration:workspace.ownerGeneration,workspaceRevision:workspace.stateRevision,limitations:payload.limitations}};
   const grant=await authorization.prepare(peer,intent);
   return{grantId:grant.grantId,expiresAtMs:grant.expiresAtMs,canonicalIntentHash:createHash('sha256').update(grant.canonicalIntent).digest('hex'),summary:{action:'attest',workspaceId,planId:plan.planId,stateRevision:expectedRevision,
     inputDigest:plan.inputDigest,limitations:payload.limitations}};
 }
 async function attest(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer){
   await authorization.guard(peer);
   const requestId=String(params.requestId),grantId=String(params.grantId);
   const original=await originalWorkflowGrant(storage,requestId,grantId,'attest','ENVIRONMENT');
   if(original.operation)return{operation:publicEnvironmentOperation(original.operation)};
   const intent=original.intent,{workspace,environment,plan,observed}=await attestScope(intent.targetId!);
   requireCurrentEnvironmentPlan({planId:plan.planId,workspaceGeneration:workspace.ownerGeneration,inputDigest:observed.inputDigest,stateRevision:environment.stateRevision},
     {planId:String(intent.payload.planId),workspaceGeneration:String(intent.payload.workspaceGeneration),inputDigest:String(intent.payload.inputDigest),stateRevision:String(intent.expectedRevision)});
   if(!options.accepting())throw new Error('BLOCKED');
   const result=await storage.commitEnvironmentState!({kind:'attest',observedInputDigest:observed.inputDigest,checkedAt:new Date().toISOString(),
     admission:workflowAdmission({requestId,grantId,intent,instanceId,nowMs:Date.now()})});
   return{operation:publicEnvironmentOperation(result.operation)};
 }
 return{authorizeAttest,actions:{'environment.plan':plan,'environment.attest':attest,
   'environment.prepare':async(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer)=>{
     if(params.action!=='attest')throw new Error('UNSUPPORTED_VERSION');
     return authorizeAttest(params,peer);
   }}};
}
