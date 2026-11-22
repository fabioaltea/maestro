import {createHash,randomUUID} from 'node:crypto';
import {EXECUTION_LIMITS,requireExecutionIdentity} from '../../domain/execution/model.js';
import {executionInteractionText} from '../../domain/execution/interaction.js';
import {requireCheckpointTree,validateCheckpointPatch} from '../../domain/execution/checkpoint.js';
import {parseProfilePermissions,permitsProfilePermissions} from '../../domain/profiles/permissions.js';
import {featureObject} from '../../domain/features/bundle.js';
import {makeDeadline,systemClock} from '../../ports/clock.js';
import {executionProviderId,publicExecutionOperation} from '../../protocol/execution.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import type {ExecutionChange,ExecutionIdentity,ExecutionProviderConfig,ExecutionRun,ExecutionSession} from '../../ports/execution.js';
import type {ExecutionHost} from '../../ports/execution-runtime.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import {createWorkflowAuthorization} from '../workflow/authorization.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {createProfileResolutionPort} from '../profiles/read.js';
import {publishPlanningArtifact,readSealedFeatureArtifact} from '../features/artifacts.js';
import {classifyError} from '../control-main.js';
import {executionMonitor} from './monitor.js';
import {createExecutionRecovery} from './recovery.js';
import {loadReviewFeedback} from '../review/feedback.js';
import type {ExecutionContext} from './runtime.js';
import type {ExecutionAction} from './dispatch.js';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const terminal=['PAUSED','INTERRUPTED','CANCELLED','READY_FOR_REVIEW'];

export function createExecutionServices(options:ExecutionContext){
 const {storage,paths,instanceId,dependencies,lease}=options,hostPort=dependencies?.host;
 const auth=createWorkflowAuthorization(options),profiles=createProfileResolutionPort(storage);
 const recovery=createExecutionRecovery(options);
 const query=storage.readExecutionState!;
 const commit=(c:ExecutionChange)=>storage.commitExecutionState!(c);
 const openHosts=new Map<string,ExecutionHost>();
 const running=new Set<string>();
 function requireHost(){
   if(!hostPort||!lease)throw new Error('EXECUTION_UNSUPPORTED');
   return{hostPort,lease};
 }
 async function configuration(value:unknown){
   const providerId=executionProviderId(value),{provider}=await query({kind:'provider',id:providerId});
   if(!provider)throw new Error('EXECUTION_UNSUPPORTED');
   return provider;
 }
 async function findSession(value:unknown){
   const {session}=await query({kind:'session',id:String(value)});
   if(!session)throw new Error('OPERATION_NOT_FOUND');
   return session;
 }
 async function findRun(id:string){
   const {run}=await query({kind:'run',id});
   if(!run)throw new Error('OPERATION_NOT_FOUND');
   return run;
 }
 async function workspace(id:unknown){
   const {workspace}=await storage.readWorkspaceState!({kind:'get',id:String(id)});
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   return workspace;
 }
 async function qualifyInput(data:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer,providerHint?:unknown){
   const {hostPort}=requireHost();
   const worktree=await workspace(data.workspaceId),{feature}=await storage.readFeatureState!({kind:'feature',id:String(data.featureId)});
   const {envelope}=await storage.readFeatureState!({kind:'envelope',id:String(data.envelopeId)});
   if(!feature||!envelope||worktree.featureId!==feature.featureId||worktree.projectId!==feature.projectId||worktree.envelopeId!==envelope.envelopeId||
      envelope.projectId!==feature.projectId||envelope.featureId!==feature.featureId||envelope.revisionId!==feature.currentRevisionId||feature.state!=='APPROVED')
     throw new Error('EXECUTION_APPROVAL_STALE');
   if(worktree.state!=='READY')throw new Error('WORKSPACE_IN_USE');
   const context=await options.currentEligibility(peer,feature.projectId);
   if(!context.eligible||context.approvalId!==envelope.discoveryApprovalId||context.contextDigest!==envelope.contextDigest)
     throw new Error('EXECUTION_APPROVAL_STALE');
   const {environment}=await storage.readEnvironmentState!({kind:'workspace',id:worktree.workspaceId});
   if(!environment||environment.workspaceGeneration!==worktree.ownerGeneration||!['READY','MANUAL_VERIFIED'].includes(environment.state))
     throw new Error('ENVIRONMENT_STALE');
   const profileId=String(data.profileResolutionId),{resolution}=await storage.readProfileState!({kind:'resolution',id:profileId});
   if(!resolution)throw new Error('PROFILE_STALE');
   const candidates=providerHint===undefined?
     await Promise.all((['codex','claude'] as const).map(async id=>(await query({kind:'provider',id})).provider)):
     [await configuration(providerHint)];
   const config=candidates.find((item):item is ExecutionProviderConfig=>item?.status==='QUALIFIED'&&item.capabilityDigest===resolution.capabilityDigest);
   if(!config?.capabilityDigest)throw new Error('EXECUTION_UNSUPPORTED');
   const profile=await profiles.current(profileId,feature.projectId,config.capabilityDigest);
   const permissions=parseProfilePermissions(profile.snapshot.effectivePermissions);
   if(!permitsProfilePermissions(permissions,['WORKSPACE_READ','WORKSPACE_WRITE']))throw new Error('TOOL_PERMISSION_REQUIRED');
   let feedback:Awaited<ReturnType<typeof loadReviewFeedback>>|undefined;
   if(data.reviewDecisionId!==undefined){
     if(!hostPort.reviewFeedback)throw new Error('EXECUTION_UNSUPPORTED');
     feedback=await loadReviewFeedback(storage,String(data.reviewDecisionId),{
       featureId:feature.featureId,featureRevisionId:envelope.revisionId,workspaceId:worktree.workspaceId,
     });
   }
   const input=await hostPort.input({workspace:worktree,envelopeId:envelope.envelopeId,profileResolutionId:profileId,provider:config,
     ...(feedback?{feedback:{decisionId:feedback.decisionId,sha256:feedback.sha256,text:feedback.text}}:{})});
   if(!input.bytes.byteLength||input.bytes.byteLength>EXECUTION_LIMITS.runInputBytes||
      !Number.isSafeInteger(input.profileBytes)||input.profileBytes<0||input.profileBytes>EXECUTION_LIMITS.profileBytes)throw new Error('CONTEXT_LIMIT');
   requireCheckpointTree(input.treeDigest);
   if(feedback&&feedback.checkpointTreeDigest!==input.treeDigest)throw new Error('EXECUTION_APPROVAL_STALE');
   return{feature,worktree,config,input,permissions,feedback,resolved:{
     featureId:feature.featureId,workspaceId:worktree.workspaceId,envelopeId:envelope.envelopeId,profileResolutionId:profileId,
     providerId:config.providerId,capabilityDigest:config.capabilityDigest,featureRevision:feature.stateRevision,
     workspaceRevision:worktree.stateRevision,environmentRevision:environment.stateRevision,profileDigest:profile.digest,
     inputDigest:sha(JSON.stringify({feature:envelope.digest,profile:profile.digest,contents:sha(input.bytes),
       ...(feedback?{reviewDecisionId:feedback.decisionId,feedbackDigest:feedback.sha256}:{})})),treeDigest:input.treeDigest,
     ...(feedback?{reviewDecisionId:feedback.decisionId,feedbackDigest:feedback.sha256,reviewStateRevision:feedback.stateRevision}:{}),
   }};
 }
 async function capture(session:ExecutionSession){
   const {hostPort}=requireHost(),r=await findRun(session.runId),w=await workspace(session.workspaceId);
   if(!hostPort.checkpoint||!terminal.includes(session.state)||r.phase!=='FINALIZED'||w.state!=='READY'||
      (await storage.readWorkspaceState!({kind:'active-lease',id:w.workspaceId})).lease)throw new Error('CHECKPOINT_STALE');
   const patch=await hostPort.checkpoint(w);
   requireCheckpointTree(patch.treeDigest);validateCheckpointPatch(patch.patch);
   return{patch,r,workspaceRevision:w.stateRevision};
 }
 async function intent(action:string,data:Readonly<Record<string,unknown>>,revisions:Record<string,unknown>,peer:AuthenticatedPeer):Promise<WorkflowIntent>{
   const snapshot=await auth.guard(peer);
   const base={version:1 as const,namespace:'EXECUTION' as const,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid};
   if(action==='provider.configure'){
     const providerId=executionProviderId(data.providerId),{provider}=await query({kind:'provider',id:providerId});
     const configRevision=provider?.configRevision??null;
     if(configRevision!==revisions.configRevision)throw new Error('EXECUTION_APPROVAL_STALE');
     return{...base,action,targetId:null,projectId:null,expectedRevision:null,configRevision,payload:data};
   }
   requireHost();
   if(action==='start'){
     const chosen=await qualifyInput(data,peer);
     return{...base,action,targetId:chosen.feature.featureId,projectId:chosen.feature.projectId,expectedRevision:chosen.feature.stateRevision,
       configRevision:chosen.config.configRevision,payload:chosen.resolved};
   }
   const q=action==='answer'?(await query({kind:'interaction',id:String(data.interactionId)})).interaction:null;
   if(action==='answer'&&(!q||q.status!=='OPEN'||q.type!=='QUESTION'))throw new Error('EXECUTION_APPROVAL_STALE');
   const session=await findSession(q?(await findRun(q.runId)).sessionId:data.sessionId);
   const r=await findRun(session.runId),expectedRevision=session.stateRevision;
   if(revisions.stateRevision!==expectedRevision)throw new Error('EXECUTION_APPROVAL_STALE');
   const common={...base,action,targetId:q?.interactionId??session.sessionId,projectId:session.projectId,expectedRevision,configRevision:r.configRevision};
   if(action==='resume'){
     const {checkpoint}=await query({kind:'checkpoint',id:String(data.checkpointId)});
     if(!checkpoint||checkpoint.sessionId!==session.sessionId||session.checkpointId!==checkpoint.checkpointId||
        !['PAUSED','INTERRUPTED'].includes(session.state)||data.providerId!==r.providerId)throw new Error('CHECKPOINT_STALE');
     const chosen=await qualifyInput(session as unknown as Record<string,unknown>,peer,data.providerId);
     if(chosen.resolved.inputDigest!==checkpoint.inputDigest||chosen.resolved.treeDigest!==checkpoint.treeDigest)throw new Error('CHECKPOINT_STALE');
     return{...common,configRevision:chosen.config.configRevision,payload:{...chosen.resolved,checkpointId:checkpoint.checkpointId}};
   }
   if(action==='checkpoint'){
     const {patch,workspaceRevision}=await capture(session);
     const artifact=await publishPlanningArtifact({storage,storeId:base.storeId,ownerUid:paths.ownerUid,instanceId,targetId:session.sessionId},'CHECKPOINT',patch.patch);
     return{...common,payload:{treeDigest:patch.treeDigest,digest:artifact.sha256,patchArtifactId:artifact.artifactId,runId:r.runId,workspaceRevision}};
   }
   if(action==='answer'){
     if(!q||q.generation!==r.generation||q.expectedRevision!==expectedRevision||r.requested||session.state!=='WAITING_USER'||!openHosts.has(r.runId))
       throw new Error('EXECUTION_APPROVAL_STALE');
     const artifact=await readSealedFeatureArtifact(storage,String(data.answerArtifactId),'INPUT',EXECUTION_LIMITS.interactionBytes,session.featureId);
     executionInteractionText(artifact.text);
     return{...common,payload:{generation:r.generation,answerArtifactId:artifact.artifact.artifactId,answerDigest:artifact.artifact.sha256}};
   }
   if(!['pause','cancel'].includes(action)||!['CREATED','RUNNING','WAITING_USER'].includes(session.state)||r.instanceId!==instanceId||r.requested)
     throw new Error('EXECUTION_APPROVAL_STALE');
   return{...common,payload:{generation:r.generation,runId:r.runId}};
 }
 function admission(snapshot:Awaited<ReturnType<typeof auth.guard>>,requestId:unknown,value:Omit<WorkflowIntent,'version'|'namespace'|'storeId'|'ownerUid'>){
   return workflowAdmission({requestId:String(requestId),grantId:null,instanceId,nowMs:Date.now(),
     intent:{version:1,namespace:'EXECUTION',storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,...value}});
 }
 async function launch(run:ExecutionRun,selected:Awaited<ReturnType<typeof qualifyInput>>,storeId:string){
   const {hostPort,lease}=requireHost(),{runId,generation}=run;
   running.add(runId);
   let host:ExecutionHost|undefined,identity:ExecutionIdentity|undefined,authorized=false;
   let proof:Awaited<ExecutionHost['exited']>|null=null,error:string|null=null;
   const deadline=makeDeadline(systemClock,EXECUTION_LIMITS.jobMs);
   const monitor=executionMonitor({storage,storeId,ownerUid:paths.ownerUid,instanceId,run});
   const stopTimer=setTimeout(()=>host?.stop(),EXECUTION_LIMITS.jobMs);
   try{
     if(!options.accepting())throw new Error('INTERRUPTED');
     const owned=await lease.acquire({workspaceId:selected.worktree.workspaceId,holderId:runId,generation,stateRevision:selected.worktree.stateRevision});
     if(!options.accepting())throw new Error('INTERRUPTED');
     // Re-read the actual workspace under the exclusive lease before the host
     // receives input. The approved tree and bytes must still match.
     const original=selected.feedback;
     const feedback=original?await loadReviewFeedback(storage,original.decisionId,original):undefined;
     if(original&&(feedback?.sha256!==original.sha256||feedback.stateRevision!==original.stateRevision))throw new Error('EXECUTION_APPROVAL_STALE');
     const checked=await hostPort.input({workspace:selected.worktree,envelopeId:selected.resolved.envelopeId,
       profileResolutionId:selected.resolved.profileResolutionId,provider:selected.config,
       ...(feedback?{feedback:{decisionId:feedback.decisionId,sha256:feedback.sha256,text:feedback.text}}:{})});
     if(checked.treeDigest!==selected.resolved.treeDigest||checked.profileBytes!==selected.input.profileBytes||
        checked.bytes.byteLength!==selected.input.bytes.byteLength||sha(checked.bytes)!==sha(selected.input.bytes))throw new Error('EXECUTION_APPROVAL_STALE');
     identity={runId,generation,leaseId:owned.leaseId,challenge:randomUUID()};
     host=await hostPort.open({workspace:selected.worktree,identity,provider:selected.config,input:checked.bytes,permissions:selected.permissions,deadline,...monitor});
     void host.exited.catch(()=>{});
     openHosts.set(runId,host);
     const ready=await host.ready;requireExecutionIdentity(identity,ready);
     const stage=(event:'ready'|'authorize'|'go')=>commit({kind:'stage',runId,instanceId,identity:ready,event});
     await stage('ready');
     if(!options.accepting())throw new Error('INTERRUPTED');
     await stage('authorize');authorized=true;
     await stage('go');
     if(!options.accepting())throw new Error('INTERRUPTED');
     await host.go(ready);
     proof=await host.exited;
   }catch(cause){
     error=classifyError(cause);
     if(host){host.stop();proof=await host.exited.catch(()=>null);}
   }finally{
     clearTimeout(stopTimer);
     try{
       if(proof&&identity){
         try{requireExecutionIdentity(identity,proof.identity);}
         catch{proof=null;error='PROCESS_UNKNOWN';}
       }
       const result=await commit({kind:'end',runId,instanceId,generation,proof:authorized?proof:null,noLaunch:!authorized&&(!host||proof!==null),error});
       if(result.run?.phase==='FINALIZED')await recovery.release(result.run);
     }finally{openHosts.delete(runId);running.delete(runId);}
   }
 }
 const actions:Record<string,ExecutionAction>={};
 actions['execution.reconcile']=async(p,peer)=>{
   const snapshot=await auth.guard(peer),e=await findSession(p.sessionId),r=await findRun(e.runId);
   const a=admission(snapshot,p.requestId,{action:'reconcile',targetId:e.sessionId,projectId:e.projectId,expectedRevision:null,configRevision:null,payload:{}});
   const existing=(await storage.readFeatureState!({kind:'operation',id:a.requestId})).operation;
   if(!existing&&await storage.getRequestReservation(a.requestId))throw new Error('IDEMPOTENCY_CONFLICT');
   if(!existing&&!running.has(r.runId))await recovery.reconcile(r);
   const result=await commit({kind:'reconcile',admission:a,sessionId:e.sessionId});return{operation:publicExecutionOperation(result.operation)};
 };
 if(dependencies){
   actions['execution.provider.check']=async(p,peer)=>{
     const snapshot=await auth.guard(peer),providerId=executionProviderId(p.providerId);
     const a=admission(snapshot,p.requestId,{action:'provider.check',targetId:null,projectId:null,expectedRevision:null,
       configRevision:String(p.expectedConfigRevision),payload:{providerId}});
     const existing=(await storage.readFeatureState!({kind:'operation',id:a.requestId})).operation;
     if(existing){
       if(existing.canonicalIntent!==a.canonicalIntent)throw new Error('IDEMPOTENCY_CONFLICT');
       return{operation:publicExecutionOperation(existing)};
     }
     const old=await configuration(providerId);
     if(old.configRevision!==p.expectedConfigRevision)throw new Error('EXECUTION_APPROVAL_STALE');
     const check=await dependencies.provider.check(old);
     if(check.status==='QUALIFIED'&&(!check.capabilityDigest||!hostPort||!lease||check.error!==null))throw new Error('EXECUTION_UNSUPPORTED');
     const {operation}=await commit({kind:'check',admission:a,provider:{...old,...check}});
     return{operation:publicExecutionOperation(operation)};
   };
   actions['execution.prepare']=async(p,peer)=>{
     const i=await intent(String(p.action),featureObject(p.intent),featureObject(p.expectedRevisions),peer);
     const grant=await auth.prepare(peer,i);
     return{grantId:grant.grantId,canonicalIntentHash:sha(grant.canonicalIntent),expiresAt:grant.expiresAtMs,
       summary:{...grant.summary,payload:Object.fromEntries(Object.entries(i.payload).filter(([key])=>!['binaryHandle','authProfileRef'].includes(key)))}};
   };
   for(const action of ['provider.configure',...(hostPort&&lease?['start','answer','pause','cancel',...(hostPort.checkpoint?['checkpoint','resume']:[])]:[])]){
     actions[`execution.${action}`]=async(p,peer)=>{
       const snapshot=await auth.guard(peer);
       const {grant,intent:i,operation}=await originalWorkflowGrant(storage,String(p.requestId),String(p.grantId),action,'EXECUTION');
       if(operation)return{operation:publicExecutionOperation(operation)};
       const a=workflowAdmission({requestId:String(p.requestId),intent:i,grantId:grant.grantId,instanceId,nowMs:Date.now()});
       const data=i.payload;
       if(action==='provider.configure'){
         const provider:ExecutionProviderConfig={providerId:executionProviderId(data.providerId),binaryRef:String(data.binaryHandle),
           modelId:String(data.modelId),authProfileRef:String(data.authProfileRef),configRevision:String(BigInt(i.configRevision??'0')+1n),
           status:'UNQUALIFIED',capabilityDigest:null,error:null};
         const result=await commit({kind:'configure',admission:a,provider});
         return{operation:publicExecutionOperation(result.operation)};
       }
       if(action==='start'||action==='resume'){
         const chosen=await qualifyInput(data,peer,data.providerId);
         if(chosen.config.configRevision!==i.configRevision||!Object.entries(chosen.resolved).every(([key,v])=>v===data[key]))
           throw new Error('EXECUTION_APPROVAL_STALE');
         const old=action==='resume'?await findSession(i.targetId):null;
         if(old){
           const {checkpoint}=await query({kind:'checkpoint',id:String(data.checkpointId)});
           if(!checkpoint||checkpoint.treeDigest!==chosen.input.treeDigest)throw new Error('CHECKPOINT_STALE');
           const verified=await storage.readWorkflowArtifact!(checkpoint.patchArtifactId,0,1);
           if(verified.sha256!==checkpoint.digest)throw new Error('ARTIFACT_CORRUPT');
         }
         const at=new Date().toISOString();
         const sessionId=old?.sessionId??a.requestId;
         const session:ExecutionSession={sessionId,featureId:chosen.feature.featureId,workspaceId:chosen.worktree.workspaceId,
           profileResolutionId:chosen.resolved.profileResolutionId,projectId:chosen.feature.projectId,envelopeId:chosen.resolved.envelopeId,
           runId:a.requestId,checkpointId:old?.checkpointId??null,state:'CREATED',stateRevision:'1',createdAt:at,updatedAt:at};
         const run:ExecutionRun={runId:a.requestId,sessionId,generation:randomUUID(),instanceId,providerId:chosen.config.providerId,
           configRevision:chosen.config.configRevision,capabilityDigest:chosen.resolved.capabilityDigest,inputDigest:chosen.resolved.inputDigest,
           phase:'PREPARED',outcome:'IN_PROGRESS',requested:null,controlRequestId:null,identity:null,proof:null,outputWatermark:'0',truncated:false};
         const result=await commit({kind:'begin',admission:a,session,run});
         if(result.inserted){running.add(run.runId);options.schedule(()=>launch(run,chosen,snapshot.store.storeId));}
         return{operation:publicExecutionOperation(result.operation)};
       }
       if(action==='answer'){
         const interactionId=String(i.targetId),{interaction:q}=await query({kind:'interaction',id:interactionId});
         const host=q?openHosts.get(q.runId):undefined;
         if(!q||!host)throw new Error('PROCESS_UNKNOWN');
         const r=await findRun(q.runId),answerArtifactId=String(data.answerArtifactId);
         const artifact=await readSealedFeatureArtifact(storage,answerArtifactId,'INPUT',EXECUTION_LIMITS.interactionBytes,(await findSession(r.sessionId)).featureId);
         if(artifact.artifact.sha256!==data.answerDigest)throw new Error('EXECUTION_APPROVAL_STALE');
         const answer=executionInteractionText(artifact.text);
         const result=await commit({kind:'answer',admission:a,interactionId,answerArtifactId});
         if(result.inserted)options.schedule(async()=>{try{await host.answer(interactionId,answer);}catch{host.stop();}});
         return{operation:publicExecutionOperation(result.operation)};
       }
       if(action==='checkpoint'){
         const e=await findSession(i.targetId),{r,patch,workspaceRevision}=await capture(e);
         if(patch.treeDigest!==data.treeDigest||sha(patch.patch)!==data.digest||r.runId!==data.runId||workspaceRevision!==data.workspaceRevision)throw new Error('CHECKPOINT_STALE');
         const result=await commit({kind:'checkpoint',admission:a,checkpoint:{checkpointId:a.requestId,sessionId:e.sessionId,runId:r.runId,
           inputDigest:r.inputDigest,treeDigest:patch.treeDigest,patchArtifactId:String(data.patchArtifactId),digest:String(data.digest),createdAt:''}});
         return{operation:publicExecutionOperation(result.operation)};
       }
       const r=await findRun(String(data.runId));
       const result=await commit({kind:'control',admission:a,runId:r.runId,requested:action==='pause'?'PAUSE':'CANCEL'});
       if(result.inserted)openHosts.get(r.runId)?.stop();
       return{operation:publicExecutionOperation(result.operation)};
     };
   }
 }
 return{actions,recover:recovery.recover,stop(){for(const host of openHosts.values())host.stop();}};
}
