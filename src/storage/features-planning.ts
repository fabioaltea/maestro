import type Database from 'better-sqlite3';
import type {WorkflowChange,WorkflowWrite} from '../ports/workflow.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import type {PlanningTurn,PlanningAnswerRef,PlanningPhase} from '../domain/features/planning.js';
import {FEATURE_PLANNING_LIMITS,requirePlanningExit,requirePlanningFence} from '../domain/features/planning.js';
import {transitionFeature,nextFeatureRevision} from '../domain/features/model.js';
import type {FeatureRecord,FeatureRevision,FeatureState} from '../domain/features/model.js';
import {currentDiscovery,currentFeature,type FeatureLedger} from './features-authoring.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import {requireUuid} from '../domain/identifiers.js';

export type PlanningChange=Extract<WorkflowChange,{kind:`planning.${string}`}>;
const activePhases=['ACCEPTED','RUNNING','RECONCILING'];
const {turns,questions,answerBytes}=FEATURE_PLANNING_LIMITS;
const currentTurn=(db:Database.Database,id:string)=>readFeatureState(db,{kind:'latestTurn',id}).turn??null;

function metadata(turn:PlanningTurn){
 const {turnId:_turnId,featureId:_featureId,runId:_runId,generation:_generation,requestId:_requestId,stateRevision:_revision,turnIndex:_index,phase:_phase,...data}=turn;
 return JSON.stringify(data);
}
function updateTurn(db:Database.Database,turn:PlanningTurn){
 db.prepare('UPDATE features_turns SET phase=?,metadata=? WHERE turn_id=?').run(turn.phase,metadata(turn),turn.turnId);
}
function updateFeature(db:Database.Database,feature:FeatureRecord,state:FeatureState,at:string,revision?:FeatureRevision,title?:string){
 const stateRevision=nextFeatureRevision(feature.stateRevision);
 db.prepare('UPDATE features_records SET state=?,state_revision=?,updated_at=?,current_revision_id=?,title=? WHERE feature_id=? AND state_revision=?')
   .run(state,BigInt(stateRevision),at,revision?.revisionId??feature.currentRevisionId,title??feature.title,feature.featureId,BigInt(feature.stateRevision));
 return stateRevision;
}
function matchedContext(db:Database.Database,feature:FeatureRecord,intent:WorkflowIntent,checkedAt?:string){
 const revision=readFeatureState(db,{kind:'revision',id:feature.currentRevisionId}).revision;
 const p=intent.payload;
 if(!revision||intent.projectId!==feature.projectId||revision.configRevision!==intent.configRevision||revision.revisionId!==p.revisionId
   ||revision.bundleDigest!==p.bundleDigest||revision.discoveryApprovalId!==p.discoveryApprovalId||revision.discoveryRevisionId!==p.discoveryRevisionId||revision.contextDigest!==p.contextDigest)throw new Error('APPROVAL_STALE');
 const match=db.prepare('SELECT d.snapshot_id FROM discoveries d JOIN discovery_approvals a ON a.discovery_id=d.discovery_id WHERE a.approval_id=?').get(revision.discoveryApprovalId) as FeatureRow|undefined;
 if(!match||match.snapshot_id!==p.contextSnapshotId)throw new Error('APPROVAL_STALE');
 if(checkedAt)currentDiscovery(db,revision,feature.projectId,checkedAt);
 return revision;
}
function checkInstance(db:Database.Database,instanceId:string){
 const store=db.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;
 if(store.current_instance_id!==instanceId)throw new Error('STALE_TARGET');
}
function requireTurnArtifact(db:Database.Database,featureId:string,artifactId:string,kind:'INPUT'|'OUTPUT'|'BUNDLE'){
 const artifact=readFeatureState(db,{kind:'artifact',id:artifactId}).artifact;
 if(!artifact||artifact.targetId!==featureId||artifact.kind!==kind||!['SEALED','REFERENCED'].includes(artifact.state))throw new Error('ARTIFACT_CORRUPT');
 return artifact;
}
function reference(db:Database.Database,artifactId:string){
 db.prepare("UPDATE workflow_artifacts SET ref_count=ref_count+1,state='REFERENCED',expires_at_ms=NULL WHERE artifact_id=?").run(artifactId);
}

export function commitFeaturePlanning(db:Database.Database,change:PlanningChange,ledger:FeatureLedger):WorkflowWrite{
 if(change.kind==='planning.admit'||change.kind==='planning.cancel'){
   const {admission}=change,intent=ledger.intent(admission.canonicalIntent),p=intent.payload;
   if(intent.namespace!=='FEATURE'||!intent.targetId||!intent.expectedRevision
     ||(change.kind==='planning.admit'?!['generate','answer'].includes(intent.action):intent.action!=='cancel'))throw new Error('APPROVAL_REQUIRED');
   let turn:PlanningTurn|undefined;
   const admitted=ledger.admit(admission,()=>{
     const feature=currentFeature(db,intent.targetId!);
     if(feature.stateRevision!==intent.expectedRevision||feature.projectId!==intent.projectId)throw new Error('REVISION_CONFLICT');
     const prior=currentTurn(db,feature.featureId);
     const at=new Date().toISOString();
     if(change.kind==='planning.cancel'){
       if(!prior||prior.turnId!==p.turnId||prior.runId!==p.runId||prior.generation!==p.generation||prior.cancelRequestId
         ||!['PLANNING','WAITING_USER','RECONCILING'].includes(feature.state))throw new Error('APPROVAL_STALE');
       if(prior.phase==='ACCEPTED'||prior.phase==='WAITING_USER'){
         const revision=updateFeature(db,feature,'INTERRUPTED',at);
         turn={...prior,phase:'CANCELLED',cancelRequestId:admission.requestId,completedAt:at,error:'INTERRUPTED'};
         updateTurn(db,turn);
         ledger.complete(prior.requestId,{featureId:feature.featureId,turnId:turn.turnId,stateRevision:revision},'INTERRUPTED','INTERRUPTED');
         ledger.complete(admission.requestId,{featureId:feature.featureId,turnId:turn.turnId,stateRevision:revision});
       }else{
         turn={...prior,cancelRequestId:admission.requestId};
         updateTurn(db,turn);
       }
       return;
     }
     matchedContext(db,feature,intent);
     if(db.prepare("SELECT 1 FROM features_turns WHERE phase IN ('ACCEPTED','RUNNING','RECONCILING') LIMIT 1").get()
       ||db.prepare("SELECT 1 FROM discovery_runs WHERE phase<>'FINALIZED' LIMIT 1").get()
       ||db.prepare("SELECT 1 FROM discovery_processes WHERE release_state<>'RELEASED' LIMIT 1").get())throw new Error('BUSY');
     const index=(prior?.turnIndex??0)+1;
     if(index>turns)throw new Error('FEATURE_LIMIT');
     let answer:PlanningAnswerRef|null=null;
     if(intent.action==='answer'){
       if(feature.state!=='WAITING_USER'||!prior||prior.phase!=='WAITING_USER'||prior.turnId!==p.parentTurnId
         ||!prior.questionIds.includes(String(p.questionId)))throw new Error('APPROVAL_STALE');
       const artifact=requireTurnArtifact(db,feature.featureId,requireUuid(p.answerArtifactId),'INPUT');
       if(artifact.expectedBytes>answerBytes||artifact.sha256!==p.answerDigest)throw new Error('APPROVAL_STALE');
       answer={turnId:prior.turnId,questionId:String(p.questionId),artifactId:artifact.artifactId};
       reference(db,artifact.artifactId);
       updateTurn(db,{...prior,phase:'SUCCEEDED'});
     }else if(!['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW','INTERRUPTED'].includes(feature.state))throw new Error('FEATURE_IN_USE');
     const stateRevision=updateFeature(db,feature,transitionFeature(feature.state,'plan'),at);
     turn={turnId:requireUuid(p.turnId),runId:requireUuid(p.runId),generation:requireUuid(p.generation),owningInstanceId:admission.instanceId,
       requestId:admission.requestId,featureId:feature.featureId,stateRevision,revisionId:feature.currentRevisionId,contextSnapshotId:requireUuid(p.contextSnapshotId),
       inputDigest:String(p.inputDigest),turnIndex:index,phase:'ACCEPTED',questionIds:[],answer,resultArtifactId:null,cancelRequestId:null,createdAt:at,completedAt:null,error:null};
     db.prepare('INSERT INTO features_turns VALUES(?,?,?,?,?,?,?,?,?)')
       .run(turn.turnId,turn.featureId,turn.runId,turn.generation,turn.requestId,BigInt(turn.stateRevision),turn.turnIndex,turn.phase,metadata(turn));
   });
   const operation=readFeatureState(db,{kind:'operation',id:admission.requestId}).operation??admitted.operation;
   return{operation,inserted:admitted.inserted,...(turn?{turn}:{})};
 }
 if(!('turnId' in change))throw new Error('INVALID_REQUEST');
 const turn=readFeatureState(db,{kind:'turn',id:change.turnId}).turn;
 if(!turn)throw new Error('STALE_TARGET');
 checkInstance(db,change.instanceId);
 const operation=readFeatureState(db,{kind:'operation',id:turn.requestId}).operation!;
 if(change.kind==='planning.start'){
   if(turn.phase!=='ACCEPTED'||turn.owningInstanceId!==change.instanceId||turn.cancelRequestId)throw new Error('STALE_TARGET');
   return ledger.transaction(()=>{
     const feature=currentFeature(db,turn.featureId);
     requirePlanningFence(feature,{...turn,phase:'RUNNING'},turn);
     matchedContext(db,feature,ledger.intent(operation.canonicalIntent),change.checkedAt);
     const started:PlanningTurn={...turn,phase:'RUNNING'};
     updateTurn(db,started);
     db.prepare("UPDATE workflow_operations SET phase='WORKING' WHERE request_id=?").run(turn.requestId);
     return{turn:started};
   },false,{requestIds:[turn.requestId]});
 }
 if(!activePhases.includes(turn.phase))return{operation,turn};
 const requests=turn.cancelRequestId?[turn.requestId,turn.cancelRequestId]:[turn.requestId];
 return ledger.transaction(()=>{
   const feature=currentFeature(db,turn.featureId);
   if(currentTurn(db,feature.featureId)?.turnId!==turn.turnId)throw new Error('STALE_TARGET');
   if(turn.phase!=='RECONCILING'&&turn.owningInstanceId!==change.instanceId)throw new Error('STALE_TARGET');
   const at=new Date().toISOString();
   if(turn.phase==='RUNNING')requirePlanningFence(feature,turn,turn);
   if(turn.phase!=='ACCEPTED'&&!change.proof){
     if(turn.phase!=='RECONCILING')updateFeature(db,feature,'RECONCILING',at);
     const uncertain:PlanningTurn={...turn,phase:'RECONCILING',error:'RESOURCE_IDENTITY_UNKNOWN'};
     updateTurn(db,uncertain);
     for(const id of requests)ledger.complete(id,{featureId:feature.featureId,turnId:turn.turnId},'RESOURCE_IDENTITY_UNKNOWN','UNKNOWN');
     return{turn:uncertain,operation:readFeatureState(db,{kind:'operation',id:turn.requestId}).operation!};
   }
   if(change.proof)requirePlanningExit(turn,change.proof);
   let revision:FeatureRevision|undefined,title:string|undefined,resultArtifactId:string|null=null,questionIds:readonly string[]=[];
   let state:FeatureState='INTERRUPTED',phase:PlanningPhase='INTERRUPTED',error=change.error;
   if(change.stopped||turn.cancelRequestId||turn.phase==='RECONCILING')error=error??'INTERRUPTED';
   else if(change.result){
     if(turn.phase!=='RUNNING'||!change.proof)throw new Error('STALE_TARGET');
     const base=matchedContext(db,feature,ledger.intent(operation.canonicalIntent),change.result.checkedAt);
     revision=change.result.revision;title=change.result.title;
     const artifact=requireTurnArtifact(db,feature.featureId,change.result.artifactId,revision?'BUNDLE':'OUTPUT');
     if(revision){
       if(revision.featureId!==feature.featureId||revision.parentRevisionId!==base.revisionId||revision.revisionNumber!==nextFeatureRevision(base.revisionNumber)
         ||revision.artifactId!==artifact.artifactId||revision.bundleDigest!==artifact.sha256||revision.contextDigest!==base.contextDigest
         ||revision.discoveryApprovalId!==base.discoveryApprovalId||revision.discoveryRevisionId!==base.discoveryRevisionId||revision.configRevision!==base.configRevision
         ||typeof title!=='string')throw new Error('APPROVAL_STALE');
       if(Number(revision.revisionNumber)>50)throw new Error('FEATURE_LIMIT');
       db.prepare('INSERT INTO features_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(revision.revisionId,revision.featureId,BigInt(revision.revisionNumber),
         revision.parentRevisionId,revision.artifactId,revision.bundleDigest,revision.discoveryApprovalId,revision.discoveryRevisionId,revision.contextDigest,BigInt(revision.configRevision),revision.createdAt);
       state=transitionFeature(feature.state,'draft');phase='SUCCEEDED';
     }else{
       questionIds=change.result.questionIds;
       const count=Number((db.prepare("SELECT coalesce(sum(json_array_length(metadata,'$.questionIds')),0) AS n FROM features_turns WHERE feature_id=?").get(feature.featureId) as FeatureRow).n);
       if(!questionIds.length||count+questionIds.length>questions||new Set(questionIds).size!==questionIds.length)throw new Error('FEATURE_LIMIT');
       state=transitionFeature(feature.state,'question');phase='WAITING_USER';
     }
     resultArtifactId=artifact.artifactId;reference(db,artifact.artifactId);
   }else{
     phase='FAILED';
     error=error??'PROVIDER_PROTOCOL_ERROR';
   }
   const stateRevision=updateFeature(db,feature,state,at,revision,title);
   const final={...turn,phase,questionIds,resultArtifactId,completedAt:at,error};
   updateTurn(db,final);
   const result={featureId:feature.featureId,turnId:turn.turnId,stateRevision,...(revision?{revisionId:revision.revisionId}:{}),...(resultArtifactId?{artifactId:resultArtifactId}:{})};
   if(turn.cancelRequestId)ledger.complete(turn.cancelRequestId,result);
   return{turn:final,operation:ledger.complete(turn.requestId,result,error,error===null?'SUCCEEDED':phase==='INTERRUPTED'?'INTERRUPTED':'FAILED')};
 },change.result===undefined,{requestIds:requests});
}
