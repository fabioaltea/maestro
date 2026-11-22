import {randomUUID} from 'node:crypto';
import {featureObject} from '../../domain/features/bundle.js';
import {requireEnvironmentValidation} from '../../domain/environments/validation.js';
import type {EnvironmentDelegatedCheck,EnvironmentPlan,EnvironmentRecord} from '../../ports/environment.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {EnvironmentPlanningOptions} from './plan.js';

export function createEnvironmentValidation(options:EnvironmentPlanningOptions,tools:{
 guard(peer:AuthenticatedPeer):Promise<{store:{storeId:string;ownerUid:number}}>;
 loadEnvironment(id:string):Promise<{environment:EnvironmentRecord;plan:EnvironmentPlan}>;
 check(environment:EnvironmentRecord,plan:EnvironmentPlan):Promise<{workspace:{workspaceId:string;projectId:string;stateRevision:string};project:{configRevision:string}}>;
 grant(peer:AuthenticatedPeer,intent:WorkflowIntent,summary:Record<string,unknown>):Promise<Record<string,unknown>>;
}){
 const {storage,instanceId}=options;
 return async(params:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer,delegated?:EnvironmentDelegatedCheck)=>{
   const {store}=await tools.guard(peer),payload=featureObject(params.intent);
   const revision=String(featureObject(params.expectedRevisions).stateRevision);
   const {environment,plan}=await tools.loadEnvironment(String(payload.environmentId));
   if(environment.stateRevision!==revision)throw new Error('REVISION_CONFLICT');
   const spec=requireEnvironmentValidation({state:environment.state,preparedDigest:environment.preparedDigest,inputDigest:plan.inputDigest,
     expectedInputDigest:String(payload.inputDigest),commandSpecId:String(payload.commandSpecId),commands:plan.metadata.commands??[]});
   const {workspace,project}=await tools.check(environment,plan).catch(async error=>{
     if((error as Error).message==='ENVIRONMENT_STALE'||(error as Error).message==='MANAGER_MISMATCH')
       await storage.commitEnvironmentState!({kind:'inspection-stale',instanceId,environmentId:environment.environmentId,expectedStateRevision:revision});
     throw error;
   });
   if(delegated&&(delegated.workspaceId!==workspace.workspaceId||delegated.planId!==plan.planId||delegated.planDigest!==plan.digest||
      delegated.inputDigest!==plan.inputDigest||delegated.commandSpecId!==spec.id||delegated.commandDigest!==spec.sha256))
     throw new Error('ENVIRONMENT_STALE');
   const intent:WorkflowIntent={version:1,namespace:'ENVIRONMENT',action:'validate',storeId:store.storeId,ownerUid:store.ownerUid,
     targetId:workspace.workspaceId,projectId:workspace.projectId,expectedRevision:revision,configRevision:project.configRevision,
     payload:{planId:plan.planId,planDigest:plan.digest,inputDigest:plan.inputDigest,workspaceRevision:workspace.stateRevision,
       commandSpecId:spec.id,jobGeneration:randomUUID(),...(delegated?{delegatedJobId:delegated.jobId,treeDigest:delegated.treeDigest}:{})}};
   return tools.grant(peer,intent,{action:'validate',workspaceId:workspace.workspaceId,environmentId:environment.environmentId,
     commandSpecId:spec.id,entry:spec.entry,argCount:spec.argv.length,inputDigest:plan.inputDigest,stateRevision:revision,
     timeoutMs:spec.timeoutMs,networkScope:'OFFLINE',writePolicy:'DENIED'});
 };
}
