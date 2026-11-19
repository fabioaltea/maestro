import {createHash,randomUUID} from 'node:crypto';
import {FEATURE_PLANNING_ACTIONS,FEATURE_PLANNING_LIMITS,requirePlanningExit,validatePlanningResult,type PlanningTurn} from '../../domain/features/planning.js';
import {featureText} from '../../domain/features/bundle.js';
import {nextFeatureRevision,type FeatureRecord} from '../../domain/features/model.js';
import type {WorkflowIntent} from '../../domain/workflow/authorization.js';
import type {FeaturePlanningExit} from '../../ports/feature.js';
import type {FeaturePlanningPort} from '../../ports/feature-planning.js';
import type {AuthenticatedPeer} from '../../ports/platform.js';
import {makeDeadline,systemClock,type Clock,type Deadline} from '../../ports/clock.js';
import {publicFeatureOperation} from '../../protocol/feature.js';
import {classifyError} from '../control-main.js';
import {originalWorkflowGrant,workflowAdmission} from '../workflow/admission.js';
import {publishPlanningArtifact,readSealedFeatureArtifact} from './artifacts.js';
import type {createFeatureAuthoring,FeatureAuthoringOptions} from './authoring.js';

const limits=FEATURE_PLANNING_LIMITS;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v,(_key,value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value)).digest('hex');
const identity=({runId,generation,owningInstanceId}:PlanningTurn)=>({runId,generation,owningInstanceId});

async function bounded<T>(work:Promise<T>,deadline:Deadline,signal?:AbortSignal):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 let abort:(()=>void)|undefined;
 try{
   return await Promise.race([work,new Promise<never>((_resolve,reject)=>{
     timer=setTimeout(()=>reject(new Error('DEADLINE_EXCEEDED')),Math.max(1,deadline.remainingMs()));
     abort=()=>reject(new Error('INTERRUPTED'));
     if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
   })]);
 }finally{clearTimeout(timer);if(abort)signal?.removeEventListener('abort',abort);}
}

export function createFeaturePlanning(
 options:FeatureAuthoringOptions,
 authoring:ReturnType<typeof createFeatureAuthoring>,
 port:FeaturePlanningPort,
 clock:Clock=systemClock,
){
 const {storage,paths,instanceId,schedule}=options;
 const commit=storage.commitFeatureState!;
 const active=new Map<string,{controller:AbortController;turn:PlanningTurn}>();
 const stopping=new Map<string,Promise<void>>();
 const latest=async(id:string)=>(await storage.readFeatureState!({kind:'latestTurn',id})).turn??null;
 async function current(id:string,expected?:string):Promise<FeatureRecord>{
   const feature=(await storage.readFeatureState!({kind:'feature',id})).feature;
   if(!feature)throw new Error('FEATURE_NOT_FOUND');
   if(expected!==undefined&&feature.stateRevision!==expected)throw new Error('REVISION_CONFLICT');
   return feature;
 }
 async function history(featureId:string,contextSnapshotId:string){
   const page=await storage.readFeatureState!({kind:'turns',id:featureId,limit:limits.turns});
   const turns=(page.items as readonly PlanningTurn[]).filter(turn=>turn.contextSnapshotId===contextSnapshotId);
   const answers=[];
   const priorQuestions=[];
   for(const turn of turns){
     if(turn.answer){
       const {artifact,text}=await readSealedFeatureArtifact(storage,turn.answer.artifactId,'INPUT',limits.answerBytes,featureId);
       answers.push({answerId:artifact.artifactId,questionId:turn.answer.questionId,text:featureText(text,limits.answerBytes,true)});
     }
     if(turn.questionIds.length&&turn.resultArtifactId){
       const {text}=await readSealedFeatureArtifact(storage,turn.resultArtifactId,'OUTPUT',limits.resultBytes,featureId);
       const result=validatePlanningResult(JSON.parse(text),{sourceIds:[],answerIds:[]});
       if(result.kind!=='QUESTIONS'||JSON.stringify(result.questions.map(q=>q.questionId))!==JSON.stringify(turn.questionIds))throw new Error('ARTIFACT_CORRUPT');
       priorQuestions.push(...result.questions);
     }
   }
   return{answers,priorQuestions};
 }

 async function prepare(peer:AuthenticatedPeer,p:Readonly<Record<string,unknown>>){
   const snapshot=await authoring.authorization.guard(peer);
   const action=String(p.action),feature=await current(String(p.featureId),String(p.expectedStateRevision)),prior=await latest(feature.featureId);
   const scope={version:1 as const,storeId:snapshot.store.storeId,ownerUid:paths.ownerUid,namespace:'FEATURE' as const,action,
     targetId:feature.featureId,projectId:feature.projectId,expectedRevision:feature.stateRevision};
   if(action==='cancel'){
     if(!prior||prior.cancelRequestId||!['PLANNING','WAITING_USER','RECONCILING'].includes(feature.state))throw new Error('APPROVAL_STALE');
     return authoring.authorization.prepare(peer,{...scope,configRevision:null,payload:{turnId:prior.turnId,runId:prior.runId,generation:prior.generation}});
   }
   if((prior?.turnIndex??0)>=limits.turns)throw new Error('FEATURE_LIMIT');
   const revision=(await storage.readFeatureState!({kind:'revision',id:feature.currentRevisionId})).revision;
   if(!revision)throw new Error('ARTIFACT_CORRUPT');
   const context=await authoring.currentContext(feature.projectId,revision.configRevision);
   if(revision.discoveryApprovalId!==context.approval.approvalId||revision.discoveryRevisionId!==context.revision.revisionId||revision.contextDigest!==context.revision.contextDigest)throw new Error('APPROVAL_STALE');
   const contextSnapshotId=context.discovery.snapshotId;
   const priorAnswers=await history(feature.featureId,contextSnapshotId);
   let answer:Record<string,unknown>={};
   if(action==='answer'){
     if(feature.state!=='WAITING_USER'||!prior||p.turnId!==prior.turnId||prior.contextSnapshotId!==contextSnapshotId||!prior.questionIds.includes(String(p.questionId)))throw new Error('APPROVAL_STALE');
     const {artifact,text}=await readSealedFeatureArtifact(storage,String(p.answerArtifactId),'INPUT',limits.answerBytes,feature.featureId);
     featureText(text,limits.answerBytes,true);
     if(artifact.targetId!==feature.featureId||priorAnswers.answers.some(a=>a.answerId===artifact.artifactId))throw new Error('APPROVAL_REQUIRED');
     answer={parentTurnId:prior.turnId,questionId:p.questionId,answerArtifactId:artifact.artifactId,answerDigest:artifact.sha256};
   }else{
     if(p.contextSnapshotId!==contextSnapshotId)throw new Error('APPROVAL_STALE');
     if(!['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW','INTERRUPTED'].includes(feature.state))throw new Error('FEATURE_IN_USE');
   }
   const bound={revisionId:revision.revisionId,bundleDigest:revision.bundleDigest,discoveryApprovalId:revision.discoveryApprovalId,
     discoveryRevisionId:revision.discoveryRevisionId,contextDigest:revision.contextDigest,contextSnapshotId,...answer};
   const inputDigest=digest({bound,...priorAnswers});
   return authoring.authorization.prepare(peer,{...scope,configRevision:revision.configRevision,
     payload:{...bound,inputDigest,turnId:randomUUID(),runId:randomUUID(),generation:randomUUID()}});
 }

 function stopTurn(turn:PlanningTurn,deadline:Deadline,reason:string,recover=false):Promise<void>{
   const existing=stopping.get(turn.turnId);
   if(existing)return existing;
   active.get(turn.turnId)?.controller.abort();
   const work=Promise.resolve().then(async()=>{
     const current=(await storage.readFeatureState!({kind:'turn',id:turn.turnId})).turn;
     if(!current||!['ACCEPTED','RUNNING','RECONCILING'].includes(current.phase))return;
     let proof:FeaturePlanningExit|null=null;
     if(current.phase!=='ACCEPTED'){
       try{
         const exact=identity(current);
         proof=await bounded(recover?port.reconcile(exact,deadline):port.cancel(exact,deadline),deadline);
         requirePlanningExit(exact,proof);
       }catch{proof=null;}
     }
     await commit({kind:'planning.complete',instanceId,turnId:current.turnId,proof,stopped:true,error:reason});
   });
   stopping.set(turn.turnId,work);
   void work.finally(()=>stopping.delete(turn.turnId)).catch(()=>{});
   return work;
 }

 async function work(peer:AuthenticatedPeer,initial:PlanningTurn,intent:WorkflowIntent,signal:AbortSignal){
   const turnId=initial.turnId;
   let exit:FeaturePlanningExit|null=null,possiblyStarted=false;
   try{
     const checkDeadline=makeDeadline(clock,limits.contextMs);
     await bounded(port.check(checkDeadline),checkDeadline,signal);
     const feature=await current(initial.featureId,initial.stateRevision);
     const revision=(await storage.readFeatureState!({kind:'revision',id:feature.currentRevisionId})).revision;
     if(!revision)throw new Error('ARTIFACT_CORRUPT');
     const context=await authoring.currentContext(feature.projectId,revision.configRevision);
     if(context.discovery.snapshotId!==initial.contextSnapshotId)throw new Error('APPROVAL_STALE');
     const scope=await authoring.provenance(context.discovery,feature.featureId);
     const {bundle}=await authoring.bundle(revision.artifactId,scope,feature.featureId);
     const input=await history(feature.featureId,initial.contextSnapshotId);
     if(revision.bundleDigest!==intent.payload.bundleDigest||revision.revisionId!==intent.payload.revisionId)throw new Error('APPROVAL_STALE');
     const {inputDigest,turnId:_turn,runId:_run,generation:_generation,...bound}=intent.payload;
     const beforeAnswer=initial.answer?input.answers.filter(a=>a.answerId!==initial.answer!.artifactId):input.answers;
     if(digest({bound,...input,answers:beforeAnswer})!==inputDigest)throw new Error('APPROVAL_STALE');
     const fresh=await bounded(authoring.fresh(peer,intent),checkDeadline,signal);
     if(signal.aborted||!options.accepting()||checkDeadline.expired())throw new Error('INTERRUPTED');
     // RUNNING is durable before the trusted host can start. A crash between those
     // steps is resolved only by authenticated exit or verified absence.
     const started=await commit({kind:'planning.start',instanceId,turnId,checkedAt:fresh.checkedAt});
     if(!started.turn)throw new Error('PERSISTENCE_UNAVAILABLE');
     if(signal.aborted)return;
     const exact=identity(started.turn),deadline=makeDeadline(clock,limits.runMs);
     possiblyStarted=true;
     const reply=await bounded(port.run({identity:exact,contextSnapshotId:initial.contextSnapshotId,bundle,provenance:scope,...input,deadline,signal}),deadline,signal);
     requirePlanningExit(exact,reply.exit);
     exit=reply.exit;
     if(signal.aborted)return;
     if(deadline.expired())throw new Error('DEADLINE_EXCEEDED');
     const result=validatePlanningResult(reply.value,scope);
     const atPublish=await bounded(authoring.fresh(peer,intent),makeDeadline(clock,limits.contextMs),signal);
     const artifact=await publishPlanningArtifact({storage,instanceId,storeId:intent.storeId,ownerUid:paths.ownerUid,targetId:feature.featureId},
       result.kind==='DRAFT'?'BUNDLE':'OUTPUT',result.kind==='DRAFT'?result.bundle:result);
     if(signal.aborted)return;
     const output=result.kind==='DRAFT'
       ? {questionIds:[],title:result.bundle.title,revision:{...revision,revisionId:randomUUID(),parentRevisionId:revision.revisionId,
           revisionNumber:nextFeatureRevision(revision.revisionNumber),artifactId:artifact.artifactId,bundleDigest:artifact.sha256,createdAt:clock.wallUtc()}}
       : {questionIds:result.questions.map(q=>q.questionId)};
     await commit({kind:'planning.complete',instanceId,turnId,proof:exit,stopped:false,error:null,
       result:{...output,artifactId:artifact.artifactId,checkedAt:atPublish.checkedAt}});
   }catch(error){
     if(signal.aborted)return;
     const code=classifyError(error);
     if(!exit&&possiblyStarted){
       await stopTurn(initial,makeDeadline(clock,limits.cancelMs),code);
     }else{
       await commit({kind:'planning.complete',instanceId,turnId,proof:exit,stopped:code==='INTERRUPTED'||code==='DEADLINE_EXCEEDED',error:code});
     }
   }
 }

 return{
   methods:FEATURE_PLANNING_ACTIONS.map(a=>`feature.${a}`),prepare,
   capabilities:{readonlyPlanning:true,qualified:true},
   async run(method:string,p:Readonly<Record<string,unknown>>,peer:AuthenticatedPeer):Promise<Record<string,unknown>>{
     await authoring.authorization.guard(peer);
     const action=method.split('.').at(-1)!;
     const requestId=String(p.requestId),grantId=String(p.grantId);
     const original=await originalWorkflowGrant(storage,requestId,grantId,action),intent=original.intent;
     if(p.featureId!==undefined&&p.featureId!==intent.targetId||p.projectId!==undefined&&p.projectId!==intent.projectId)throw new Error('APPROVAL_REQUIRED');
     if(original.operation)return{operation:publicFeatureOperation(original.operation)};
     const admission=workflowAdmission({requestId,grantId,intent,instanceId,nowMs:Date.now()});
     let turn:PlanningTurn|undefined;
     try{
       const result=await commit({kind:action==='cancel'?'planning.cancel':'planning.admit',admission});
       if(!result.inserted||result.operation?.phase==='FINALIZED')return{operation:publicFeatureOperation(result.operation!)};
       turn=result.turn;
     }catch(error){
       if(!['PERSISTENCE_UNAVAILABLE','DEADLINE_EXCEEDED'].includes(classifyError(error)))throw error;
       // A lost acknowledgement can leave a durable, unlaunched intent. Recover
       // only this UUID and generation. Any unverified ownership stays pending.
       const operation=(await storage.readFeatureState!({kind:'operation',id:requestId})).operation;
       if(!operation||operation.canonicalIntent!==admission.canonicalIntent)throw error;
       const recovered=await latest(intent.targetId!);
       if(operation.phase==='FINALIZED')return{operation:publicFeatureOperation(operation)};
       if(!recovered||recovered.owningInstanceId!==instanceId
         ||(action==='cancel'?recovered.cancelRequestId!==requestId:recovered.requestId!==requestId||recovered.phase!=='ACCEPTED'))return{operation:publicFeatureOperation(operation)};
       turn=recovered;
     }
     if(!turn)throw new Error('PERSISTENCE_UNAVAILABLE');
     if(action==='cancel'){
       const cancelled=turn;
       active.get(cancelled.turnId)?.controller.abort();
       schedule(()=>stopTurn(cancelled,makeDeadline(clock,limits.cancelMs),'INTERRUPTED',cancelled.phase==='RECONCILING'));
     }else{
       const accepted=turn;
       if(active.has(accepted.turnId))return{accepted:true,requestId,featureId:accepted.featureId,turnId:accepted.turnId,stateRevision:accepted.stateRevision};
       const controller=new AbortController();
       active.set(turn.turnId,{controller,turn});
       schedule(async()=>{try{await work(peer,accepted,intent,controller.signal);}finally{active.delete(accepted.turnId);}});
     }
     return{accepted:true,requestId,featureId:turn.featureId,turnId:turn.turnId,stateRevision:turn.stateRevision};
   },
   async recover(){
     const page=await storage.readFeatureState!({kind:'activeTurns'});
     for(const turn of page.items as readonly PlanningTurn[])await stopTurn(turn,makeDeadline(clock,limits.cancelMs),'INTERRUPTED',true);
   },
   async stop(deadline:Deadline){
     await Promise.all([...active.values()].map(({turn})=>stopTurn(turn,deadline,'INTERRUPTED')));
   },
 };
}
