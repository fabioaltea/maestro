import {sameWorkspaceAnchor,requireMatchingWorktree,requireWorkspaceRelease,WORKSPACE_HOLDERS} from '../domain/workspaces/ownership.js';
import {requireCleanupEffect,requireCleanupTarget} from '../domain/workspaces/cleanup.js';
import {workspaceBranchRef,requireWorkspaceHandoff,requireProvisioningObservation} from '../domain/workspaces/provision.js';
import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import type {WorkspaceChange,WorkspaceClaim,WorkspaceCleanupEvidence,WorkspaceEffect,WorkspaceLease,WorkspaceLeaseChange,WorkspaceMutationTarget,WorkspaceQuery,WorkspaceRead,WorkspaceRecord,WorkspaceSummary,WorkspaceWrite} from '../ports/workspace.js';
import type {ReferenceCheckout,RepositoryIdentity} from '../ports/repository.js';
import {nextWorkspaceRevision,requireWorkspaceCapacity,requireWorkspaceFence,transitionWorkspace, type WorkspaceState} from '../domain/workspaces/model.js';
import {currentDiscovery,type FeatureLedger} from './features-authoring.js';
import {readFeatureState,workflowOperation} from './features-store.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import {join} from 'node:path';
import {WORKSPACE_SCHEMA_VERSION} from './workspaces-schema.js';

type Row=Record<string,string|number|bigint|null>;
function workspaceLease(row:Row):WorkspaceLease{
 return{leaseId:String(row.lease_id),workspaceId:String(row.workspace_id),holderType:row.holder_type as WorkspaceLease['holderType'],
   holderId:String(row.holder_id),generation:String(row.generation),instanceId:String(row.instance_id)};
}
function activeLease(database:Database.Database,id:string){
 const row=database.prepare('SELECT * FROM workspaces_leases WHERE workspace_id=? AND released_at IS NULL').get(id) as Row|undefined;
 return row?workspaceLease(row):null;
}
function readEffect(row:Row):WorkspaceEffect{
 const lastPhase=row.evidence===null||row.evidence===undefined?undefined:(JSON.parse(String(row.evidence)) as {lastPhase?:string}).lastPhase;
 return{requestId:String(row.request_id),phase:row.phase as WorkspaceEffect['phase'],...(lastPhase?{lastPhase}:{})};
}
export function requireWorkspaceSchema(database:Database.Database):void{
 if(Number(database.pragma('user_version',{simple:true}))!==WORKSPACE_SCHEMA_VERSION)throw new Error('WORKSPACE_NOT_INITIALIZED');
}
export function workspaceRecord(r:Row):WorkspaceRecord{
 return{
   workspaceId:String(r.workspace_id),featureId:String(r.feature_id),projectId:String(r.project_id),envelopeId:String(r.envelope_id),
   repositoryKey:String(r.repository_key),state:r.state as WorkspaceRecord['state'],stateRevision:String(r.state_revision),
   ownerGeneration:String(r.owner_generation),target:JSON.parse(String(r.target)) as WorkspaceRecord['target'],
   ownership:r.ownership===null?null:JSON.parse(String(r.ownership)) as WorkspaceRecord['ownership'],
   markerDigest:r.marker_digest===null?null:String(r.marker_digest),safeError:r.safe_error===null?null:String(r.safe_error),
   observation:r.observation===null?null:JSON.parse(String(r.observation)) as WorkspaceRecord['observation'],
   createdAt:String(r.created_at),updatedAt:String(r.updated_at),
 };
}
function summary(row:Row):WorkspaceSummary{
 const r=workspaceRecord(row);
 return{workspaceId:r.workspaceId,featureId:r.featureId,projectId:r.projectId,envelopeId:r.envelopeId,state:r.state,stateRevision:r.stateRevision,
   baseRef:r.target.baseRef,baseOid:r.target.baseOid,branchRef:workspaceBranchRef(r.featureId,r.workspaceId),
   ownership:r.ownership?'RECORDED':'UNKNOWN',createdAt:r.createdAt,updatedAt:r.updatedAt,safeError:r.safeError,observation:r.observation};
}
export function readWorkspaceState(database:Database.Database,query:WorkspaceQuery):WorkspaceRead{
 requireWorkspaceSchema(database);
 if(query.kind==='get'||query.kind==='summary'){
   const row=database.prepare('SELECT * FROM workspaces_records WHERE workspace_id=?').get(requireUuid(query.id)) as Row|undefined;
   return query.kind==='get'?{workspace:row?workspaceRecord(row):null}:{summary:row?summary(row):null};
 }
 if(query.kind==='interrupted-provisioning'){
   const rows=database.prepare(`SELECT w.*,e.request_id FROM workspaces_records w
     JOIN workspaces_effects e ON e.workspace_id=w.workspace_id WHERE w.state='CREATING' AND e.phase<>'RESOLVED'`).all() as Row[];
   return{interrupted:rows.map(row=>({requestId:String(row.request_id),workspace:workspaceRecord(row)}))};
 }
 if(query.kind==='active-lease')return{lease:activeLease(database,requireUuid(query.id))};
 if(query.kind==='interrupted-leases'){
   const rows=database.prepare("SELECT * FROM workspaces_leases WHERE released_at IS NULL").all() as Row[];
   return{leases:rows.map(workspaceLease)};
 }
 if(query.kind==='unresolved-effect'){
   const row=database.prepare("SELECT request_id,phase,evidence FROM workspaces_effects WHERE workspace_id=? AND phase<>'RESOLVED'").get(requireUuid(query.id)) as Row|undefined;
   return{effect:row?readEffect(row):null};
 }
 if(query.kind==='interrupted-removals'){
   const rows=database.prepare(`SELECT w.*,e.request_id,e.phase,e.evidence FROM workspaces_records w
     JOIN workspaces_effects e ON e.workspace_id=w.workspace_id JOIN workflow_operations o ON o.request_id=e.request_id
     WHERE o.action='remove' AND e.phase<>'RESOLVED' AND (w.state='REMOVING' OR json_extract(e.evidence,'$.lastPhase')='DELETE_BRANCH_INTENT')`).all() as Row[];
   return{removals:rows.map(row=>({workspace:workspaceRecord(row),effect:readEffect(row)}))};
 }
 if(query.kind==='cleanup-evidence'){
   const workspace=readWorkspaceState(database,{kind:'get',id:query.id}).workspace;
   if(workspace?.state!=='READY'||activeLease(database,workspace.workspaceId))return{cleanup:null};
   if(database.prepare("SELECT 1 FROM workspaces_effects WHERE repository_key=? AND phase<>'RESOLVED'").get(workspace.repositoryKey))return{cleanup:null};
   const row=database.prepare(`SELECT canonical_intent FROM workflow_grants
     WHERE consumed_by_request_id IS NULL AND expires_at_ms>? AND json_extract(canonical_intent,'$.namespace')='WORKSPACE'
     AND json_extract(canonical_intent,'$.action')='remove' AND json_extract(canonical_intent,'$.targetId')=?
     AND json_extract(canonical_intent,'$.expectedRevision')=? ORDER BY created_at_ms DESC LIMIT 1`)
     .get(Date.now(),workspace.workspaceId,workspace.stateRevision) as Row|undefined;
   if(!row)return{cleanup:null};
   const intent=JSON.parse(String(row.canonical_intent)) as WorkflowIntent;
   try{validateCleanupScope(database,intent,workspace);}catch{return{cleanup:null};}
   const {targetRef,targetOid,headOid,checkedAt}=intent.payload as unknown as WorkspaceCleanupEvidence;
   return{cleanup:{targetRef,targetOid,headOid,checkedAt,stateRevision:workspace.stateRevision}};
 }
 if(query.kind==='interrupted-refresh'){
   const rows=database.prepare("SELECT * FROM workflow_operations WHERE namespace='WORKSPACE' AND action='refresh' AND phase<>'FINALIZED' LIMIT 32").all() as Row[];
   return{operations:rows.map(workflowOperation)};
 }
 if(query.kind==='pending-claim-settlements'){
   const owner=database.prepare('SELECT store_id FROM store WHERE singleton=1').get() as Row;
   const rows=database.prepare("SELECT request_id,repository_key,owner_generation FROM workspaces_effects WHERE phase='RESOLVED' AND claim_settled=0 LIMIT 32").all() as Row[];
   return{claims:rows.map(row=>({storeId:String(owner.store_id),requestId:String(row.request_id),repositoryKey:String(row.repository_key),ownerGeneration:String(row.owner_generation)}))};
 }
 if(query.kind!=='list')throw new Error('INVALID_REQUEST');
 const projectId=requireUuid(query.projectId),offset=query.offset??0,limit=query.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const rows=database.prepare('SELECT * FROM workspaces_records WHERE project_id=? ORDER BY created_at,workspace_id LIMIT ? OFFSET ?').all(projectId,limit+1,offset) as Row[];
 const revision=database.prepare('SELECT revision FROM store WHERE singleton=1').get() as Row;
 return{items:rows.slice(0,limit).map(summary),nextOffset:rows.length>limit?offset+limit:null,pageRevision:String(revision.revision)};
}

function validateScope(database:Database.Database,intent:WorkflowIntent,checkedAt:string,verifyArtifact:(id:string)=>void){
 const workspaceId=requireUuid(intent.targetId),projectId=requireUuid(intent.projectId),p=intent.payload;
 const featureId=requireUuid(p.featureId),envelopeId=requireUuid(p.envelopeId),ownerGeneration=requireUuid(p.ownerGeneration),target=p.target as WorkspaceMutationTarget;
   const feature=readFeatureState(database,{kind:'feature',id:featureId}).feature;
   const envelope=readFeatureState(database,{kind:'envelope',id:envelopeId}).envelope;
   if(!feature||!envelope||workspaceId!==target?.workspaceId||featureId!==target.featureId||
     feature.projectId!==projectId||envelope.projectId!==projectId||envelope.featureId!==featureId
     ||envelope.digest!==p.envelopeDigest||feature.stateRevision!==intent.expectedRevision||envelope.configRevision!==intent.configRevision)
     throw new Error('APPROVAL_STALE');
   const revision=readFeatureState(database,{kind:'revision',id:feature.currentRevisionId}).revision;
   const approval=readFeatureState(database,{kind:'approval',id:feature.currentRevisionId}).approval??null;
   if(!revision||envelope.revisionId!==revision.revisionId||envelope.bundleDigest!==revision.bundleDigest||envelope.approvalId!==approval?.approvalId)
     throw new Error('APPROVAL_STALE');
   requireWorkspaceHandoff(feature,revision,approval,envelope,{projectId,configRevision:revision.configRevision,
     contextDigest:revision.contextDigest,discoveryApprovalId:revision.discoveryApprovalId,discoveryRevisionId:revision.discoveryRevisionId,
     checkedAt:checkedAt},intent.ownerUid);
   currentDiscovery(database,revision,projectId,checkedAt);
   const artifact=readFeatureState(database,{kind:'artifact',id:revision.artifactId}).artifact;
   if(artifact?.state!=='REFERENCED'||artifact.kind!=='BUNDLE'||artifact.sha256!==revision.bundleDigest)throw new Error('ARTIFACT_CORRUPT');
   verifyArtifact(revision.artifactId);
   const project=database.prepare('SELECT repository_key,repository_identity,reference_checkout,base_branch FROM projects WHERE project_id=?').get(projectId) as Row;
   const identity=JSON.parse(String(project.repository_identity)) as RepositoryIdentity;
   const reference=JSON.parse(String(project.reference_checkout)) as ReferenceCheckout;
   if(project.repository_key!==p.repositoryKey||typeof project.base_branch!=='string'||target.baseRef!==`refs/heads/${project.base_branch}`
     ||!sameWorkspaceAnchor(identity.commonDirectory,target.commonDirectory)||!sameWorkspaceAnchor(reference.root,target.reference)
     ||!sameWorkspaceAnchor(reference.adminDirectory,target.adminDirectory))throw new Error('REPOSITORY_CHANGED');
 return{featureId,envelopeId,ownerGeneration,target,project};
}

function writeState(database:Database.Database,workspace:WorkspaceRecord,state:WorkspaceState,error:string|null){
 const revision=nextWorkspaceRevision(workspace.stateRevision);
 database.prepare('UPDATE workspaces_records SET state=?,state_revision=?,safe_error=?,updated_at=? WHERE workspace_id=? AND state_revision=?')
   .run(state,BigInt(revision),error,new Date().toISOString(),workspace.workspaceId,BigInt(workspace.stateRevision));
 return{workspaceId:workspace.workspaceId,stateRevision:revision};
}

type ProvisionChange=Extract<WorkspaceChange,{kind:`provision-${string}`}>;
function provision(database:Database.Database,change:ProvisionChange,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):WorkspaceWrite{
 return ledger.transaction(()=>{
   const operation=readFeatureState(database,{kind:'operation',id:change.requestId}).operation;
   if(!operation||operation.namespace!=='WORKSPACE'||operation.action!=='create'||operation.targetId!==change.fence.workspaceId)throw new Error('OPERATION_NOT_FOUND');
   if(operation.phase==='FINALIZED')return{operation,inserted:false};
   const workspace=readWorkspaceState(database,{kind:'get',id:operation.targetId}).workspace;
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   requireWorkspaceFence(workspace,change.fence);
   const effect=database.prepare('SELECT * FROM workspaces_effects WHERE request_id=? AND workspace_id=?').get(change.requestId,workspace.workspaceId) as Row|undefined;
   const owner=database.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.requestId) as Row;
   const identity=database.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as Row;
   if(workspace.state!=='CREATING'||effect?.owner_generation!==workspace.ownerGeneration||identity.current_instance_id!==change.instanceId)
     throw new Error('STALE_TARGET');
   if(change.kind==='provision-interrupted'){
     const lifecycle=database.prepare('SELECT lifecycle FROM instances WHERE instance_id=?').get(change.instanceId) as Row;
     if(lifecycle.lifecycle!=='RECOVERING'||owner.owning_instance_id===change.instanceId)throw new Error('STALE_TARGET');
     const uncertain=effect.phase!=='INTENT',error=uncertain?'RESOURCE_IDENTITY_UNKNOWN':'INTERRUPTED';
     const result=writeState(database,workspace,transitionWorkspace(workspace.state,uncertain?'uncertain':'block'),error);
     database.prepare('UPDATE workspaces_effects SET phase=? WHERE request_id=?').run(uncertain?'UNKNOWN':'RESOLVED',change.requestId);
     return{operation:ledger.complete(change.requestId,result,error,uncertain?'UNKNOWN':'INTERRUPTED')};
   }
   if(owner.owning_instance_id!==change.instanceId)throw new Error('STALE_TARGET');
   if(change.kind==='provision-dispatch'){
     if(effect.phase!=='INTENT')throw new Error('INVALID_TRANSITION');
     validateScope(database,ledger.intent(operation.canonicalIntent),change.contextCheckedAt,verifyArtifact);
     database.prepare("UPDATE workspaces_effects SET phase='BRANCH_INTENT' WHERE request_id=?").run(change.requestId);
     database.prepare("UPDATE workflow_operations SET phase='WORKING' WHERE request_id=?").run(change.requestId);
     return{operation:readFeatureState(database,{kind:'operation',id:change.requestId}).operation!};
   }
   if(change.kind==='provision-step'){
     const observation=change.observation;
     if(effect.phase==='BRANCH_INTENT'){
       requireProvisioningObservation(workspace.target.baseOid,observation,'BRANCH_CREATED');
       database.prepare("UPDATE workspaces_effects SET phase='BRANCH_CREATED' WHERE request_id=?").run(change.requestId);
     }else if(effect.phase==='BRANCH_CREATED'){
       requireProvisioningObservation(workspace.target.baseOid,observation,'WORKTREE_ADDED');
       const proof=observation.worktree!;
       if(!change.markerDigest||!/^[a-f0-9]{64}$/.test(change.markerDigest)
         ||proof.branchRef!==workspaceBranchRef(workspace.featureId,workspace.workspaceId)
         ||proof.root.canonicalPath!==join(workspace.target.ownedRoot.canonicalPath,workspace.workspaceId)
         ||proof.adminDirectory.canonicalPath!==join(workspace.target.commonDirectory.canonicalPath,'worktrees',workspace.workspaceId))throw new Error('OWNERSHIP_UNPROVEN');
       database.prepare('UPDATE workspaces_records SET ownership=?,marker_digest=? WHERE workspace_id=?')
         .run(JSON.stringify(proof),change.markerDigest,workspace.workspaceId);
       database.prepare("UPDATE workspaces_effects SET phase='WORKTREE_ADDED',evidence=? WHERE request_id=?")
         .run(JSON.stringify({markerDigest:change.markerDigest,headOid:proof.headOid}),change.requestId);
     }else throw new Error('INVALID_TRANSITION');
     database.prepare("UPDATE workflow_operations SET phase='WORKING' WHERE request_id=?").run(change.requestId);
     return{operation:readFeatureState(database,{kind:'operation',id:change.requestId}).operation!};
   }
   if(change.kind==='provision-ready'){
     if(effect.phase!=='WORKTREE_ADDED'||!workspace.ownership||!workspace.markerDigest)throw new Error('OWNERSHIP_UNPROVEN');
     validateScope(database,ledger.intent(operation.canonicalIntent),change.contextCheckedAt,verifyArtifact);
     const result=writeState(database,workspace,transitionWorkspace(workspace.state,'ready'),null);
     database.prepare("UPDATE workspaces_effects SET phase='RESOLVED' WHERE request_id=?").run(change.requestId);
     return{operation:ledger.complete(change.requestId,result)};
   }
   if(!change.uncertain&&effect.phase!=='INTENT'&&effect.phase!=='BRANCH_INTENT')throw new Error('OWNERSHIP_UNPROVEN');
   foundationError(change.error as ErrorCode);
   const result=writeState(database,workspace,transitionWorkspace(workspace.state,change.uncertain?'uncertain':'block'),change.error);
   database.prepare("UPDATE workspaces_effects SET phase=? WHERE request_id=?").run(change.uncertain?'UNKNOWN':'RESOLVED',change.requestId);
   return{operation:ledger.complete(change.requestId,result,change.error,change.uncertain?'UNKNOWN':'BLOCKED')};
 },change.kind!=='provision-step'&&change.kind!=='provision-dispatch',{requestIds:[change.requestId]});
}

export function commitWorkspaceState(database:Database.Database,change:WorkspaceChange,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):WorkspaceWrite{
 requireWorkspaceSchema(database);
 if(change.kind==='refresh-admit'||change.kind==='refresh-finish'||change.kind==='refresh-interrupted')return refresh(database,change,ledger,verifyArtifact);
 if(change.kind==='cleanup-admit'||change.kind==='cleanup-step'||change.kind==='cleanup-block'||change.kind==='cleanup-interrupted')return cleanup(database,change,ledger);
 if(change.kind!=='reserve')return provision(database,change,ledger,verifyArtifact);
 const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
 if(intent.namespace!=='WORKSPACE'||intent.action!=='create'||!intent.targetId||!intent.projectId)throw new Error('APPROVAL_REQUIRED');
 const workspaceId=requireUuid(intent.targetId),projectId=requireUuid(intent.projectId);
 const admitted=ledger.admit(admission,()=>{
   const owner=database.prepare('SELECT lifecycle FROM instances WHERE instance_id=?').get(admission.instanceId) as Row|undefined;
   if(owner?.lifecycle!=='RUNNING')throw new Error('STALE_TARGET');
   const {featureId,envelopeId,ownerGeneration,target,project}=validateScope(database,intent,change.contextCheckedAt,verifyArtifact);
   const count=database.prepare("SELECT count(*) AS count FROM workspaces_records WHERE state<>'REMOVED'").get() as Row;
   requireWorkspaceCapacity(Number(count.count));
   if(database.prepare("SELECT 1 FROM workspaces_effects WHERE repository_key=? AND phase<>'RESOLVED'").get(project.repository_key))throw new Error('WORKSPACE_IN_USE');
   const at=new Date(admission.nowMs).toISOString();
   database.prepare(`INSERT INTO workspaces_records
     (workspace_id,feature_id,project_id,envelope_id,repository_key,state,state_revision,owner_generation,target,created_at,updated_at)
     VALUES(?,?,?,?,?,'CREATING',1,?,?,?,?)`).run(workspaceId,featureId,projectId,envelopeId,project.repository_key,ownerGeneration,JSON.stringify(target),at,at);
   database.prepare("INSERT INTO workspaces_effects(request_id,workspace_id,repository_key,owner_generation,phase) VALUES(?,?,?,?,'INTENT')")
     .run(admission.requestId,workspaceId,project.repository_key,ownerGeneration);
 });
 const workspace=readWorkspaceState(database,{kind:'get',id:workspaceId}).workspace;
 return {...admitted,...(workspace?{workspace}:{})};
}

function requireWorkspaceInstance(database:Database.Database,instanceId:string,lifecycle:'RUNNING'|'RECOVERING'){
 const owner=database.prepare('SELECT i.lifecycle FROM instances i JOIN store s ON i.instance_id=s.current_instance_id WHERE i.instance_id=?')
   .get(requireUuid(instanceId)) as Row|undefined;
 if(owner?.lifecycle!==lifecycle)throw new Error('STALE_TARGET');
}

type RefreshChange=Extract<WorkspaceChange,{kind:`refresh-${string}`}>;
function refresh(database:Database.Database,change:RefreshChange,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):WorkspaceWrite{
 if(change.kind==='refresh-admit'){
   const intent=ledger.intent(change.admission.canonicalIntent);
   if(intent.namespace!=='WORKSPACE'||intent.action!=='refresh')throw new Error('INVALID_REQUEST');
   const admitted=ledger.admit(change.admission,()=>{
     requireWorkspaceInstance(database,change.admission.instanceId,'RUNNING');
     const workspace=readWorkspaceState(database,{kind:'get',id:requireUuid(intent.targetId)}).workspace;
     if(!workspace||workspace.projectId!==intent.projectId)throw new Error('WORKSPACE_NOT_FOUND');
     if(workspace.stateRevision!==intent.expectedRevision)throw new Error('REVISION_CONFLICT');
     if(['CREATING','REMOVING'].includes(workspace.state))throw new Error('WORKSPACE_IN_USE');
     const project=database.prepare('SELECT removed_at FROM projects WHERE project_id=?').get(workspace.projectId) as Row|undefined;
     if(!project||project.removed_at!==null)throw new Error('PROJECT_REMOVED');
   });
   const workspace=readWorkspaceState(database,{kind:'get',id:requireUuid(intent.targetId)}).workspace;
   return{...admitted,...(workspace?{workspace}:{})};
 }
 const requestIds=[change.requestId,...(change.kind==='refresh-finish'&&change.recovered?[change.recovered.originalRequestId]:[])];
 return ledger.transaction(()=>{
   const operation=readFeatureState(database,{kind:'operation',id:change.requestId}).operation;
   if(!operation||operation.namespace!=='WORKSPACE'||operation.action!=='refresh')throw new Error('OPERATION_NOT_FOUND');
   if(operation.phase==='FINALIZED')return{operation};
   const owner=database.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.requestId) as Row;
   if(change.kind==='refresh-interrupted'){
     requireWorkspaceInstance(database,change.instanceId,'RECOVERING');
     if(owner.owning_instance_id===change.instanceId)throw new Error('STALE_TARGET');
     return{operation:ledger.complete(change.requestId,null,'INTERRUPTED','INTERRUPTED')};
   }
   requireWorkspaceInstance(database,change.instanceId,'RUNNING');
   if(owner.owning_instance_id!==change.instanceId||operation.targetId!==change.fence.workspaceId)throw new Error('STALE_TARGET');
   const workspace=readWorkspaceState(database,{kind:'get',id:operation.targetId}).workspace;
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   if(workspace.stateRevision!==change.fence.stateRevision||workspace.ownerGeneration!==change.fence.ownerGeneration)
     return{operation:ledger.complete(change.requestId,null,'REVISION_CONFLICT','BLOCKED')};
   const {observation,error}=change;
   requireUuid(observation.observationId);
   if(!Number.isFinite(Date.parse(observation.checkedAt)))throw new Error('INVALID_REQUEST');
   if(error)foundationError(error as ErrorCode);
   let state=workspace.state;
   if(error&&state==='READY')state=transitionWorkspace(state,'block');
   if(error&&state==='IN_USE')state=transitionWorkspace(state,'uncertain');
   if(!error&&state==='BLOCKED'&&observation.ownership==='VERIFIED'&&!activeLease(database,workspace.workspaceId)
     &&!readWorkspaceState(database,{kind:'unresolved-effect',id:workspace.workspaceId}).effect)state=transitionWorkspace(state,'ready');
   if(change.recovered){
     const original=readFeatureState(database,{kind:'operation',id:change.recovered.originalRequestId}).operation;
     const effect=database.prepare("SELECT * FROM workspaces_effects WHERE request_id=? AND phase='UNKNOWN'").get(change.recovered.originalRequestId) as Row|undefined;
     if(!original||original.namespace!=='WORKSPACE'||original.action!=='create'||original.targetId!==workspace.workspaceId
       ||original.outcome!=='UNKNOWN'||effect?.owner_generation!==workspace.ownerGeneration||!workspace.ownership||!workspace.markerDigest
       ||observation.ownership!=='VERIFIED'||observation.headOid!==workspace.target.baseOid||activeLease(database,workspace.workspaceId))
       throw new Error('OWNERSHIP_UNPROVEN');
     validateScope(database,ledger.intent(original.canonicalIntent),change.recovered.contextCheckedAt,verifyArtifact);
     state=transitionWorkspace(state,'ready');
   }
   const updated=writeState(database,workspace,state,error);
   database.prepare('UPDATE workspaces_records SET observation=? WHERE workspace_id=?').run(JSON.stringify(observation),workspace.workspaceId);
   if(change.recovered){
     database.prepare("UPDATE workspaces_effects SET phase='RESOLVED' WHERE request_id=?").run(change.recovered.originalRequestId);
     ledger.complete(change.recovered.originalRequestId,updated);
   }
   return{operation:ledger.complete(change.requestId,{...updated,observationId:observation.observationId},error,error?'BLOCKED':'SUCCEEDED')};
 },true,{requestIds});
}

export function commitWorkspaceLease(database:Database.Database,change:WorkspaceLeaseChange,ledger:FeatureLedger):WorkspaceLease{
 requireWorkspaceSchema(database);
 const requested=change.lease;
 const workspaceId=requireUuid(requested.workspaceId),leaseId=requireUuid(requested.leaseId);
 requireUuid(requested.generation);requireUuid(requested.holderId);requireUuid(requested.instanceId);
 if(!WORKSPACE_HOLDERS.includes(requested.holderType))throw new Error('INVALID_REQUEST');
 return ledger.transaction(()=>{
   const workspace=readWorkspaceState(database,{kind:'get',id:workspaceId}).workspace;
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   const held=activeLease(database,workspaceId);
   if(change.kind==='acquire'){
     requireWorkspaceInstance(database,requested.instanceId,'RUNNING');
     if(held){
       if(held.holderType===requested.holderType&&held.holderId===requested.holderId&&held.generation===requested.generation&&held.instanceId===requested.instanceId)return held;
       throw new Error('WORKSPACE_IN_USE');
     }
     requireWorkspaceFence(workspace,change.fence);
     if(workspace.state!=='READY'||readWorkspaceState(database,{kind:'unresolved-effect',id:workspaceId}).effect)throw new Error('WORKSPACE_IN_USE');
     const project=database.prepare('SELECT removed_at FROM projects WHERE project_id=?').get(workspace.projectId) as Row|undefined;
     if(!project||project.removed_at!==null)throw new Error('PROJECT_REMOVED');
     requireMatchingWorktree(workspace.ownership,change.worktree);
     if(database.prepare('SELECT 1 FROM workspaces_leases WHERE workspace_id=? AND holder_type=? AND holder_id=? AND generation=?')
       .get(workspaceId,requested.holderType,requested.holderId,requested.generation))throw new Error('STALE_TARGET');
     database.prepare('INSERT INTO workspaces_leases(lease_id,workspace_id,holder_type,holder_id,generation,instance_id,created_at) VALUES(?,?,?,?,?,?,?)')
       .run(leaseId,workspaceId,requested.holderType,requested.holderId,requested.generation,requested.instanceId,new Date().toISOString());
     writeState(database,workspace,transitionWorkspace(workspace.state,'acquire'),null);
     return requested;
   }
   requireWorkspaceInstance(database,change.instanceId,change.kind==='owner-lost'?'RECOVERING':'RUNNING');
   if(!held||Object.entries(held).some(([key,value])=>requested[key as keyof WorkspaceLease]!==value))throw new Error('STALE_TARGET');
   if(change.kind==='owner-lost'){
     if(held.instanceId===change.instanceId)throw new Error('STALE_TARGET');
     if(workspace.state==='IN_USE')writeState(database,workspace,transitionWorkspace(workspace.state,'uncertain'),'RESOURCE_IDENTITY_UNKNOWN');
   }else{
     requireWorkspaceRelease(held,change.proof);
     if(change.worktree)requireMatchingWorktree(workspace.ownership,change.worktree);
     const state=transitionWorkspace(workspace.state,change.worktree?workspace.state==='RECONCILING'?'ready':'release':'block');
     const proof=change.proof.kind==='EXIT'?{kind:'EXIT',hostExited:true,descendantsExited:true}:{kind:'CHECKPOINT',durable:true,quiescent:true};
     database.prepare('UPDATE workspaces_leases SET released_at=?,release_proof=? WHERE lease_id=? AND released_at IS NULL')
       .run(new Date().toISOString(),JSON.stringify(proof),leaseId);
     writeState(database,workspace,state,change.worktree?null:'OWNERSHIP_UNPROVEN');
   }
   return held;
 },change.kind!=='acquire',{workspaceIds:[workspaceId]});
}

export function settleWorkspaceClaim(database:Database.Database,claim:WorkspaceClaim,ledger:FeatureLedger){
 const store=database.prepare('SELECT store_id FROM store WHERE singleton=1').get() as Row;
 if(store.store_id!==claim.storeId)throw new Error('STALE_TARGET');
 ledger.transaction(()=>{
   const result=database.prepare("UPDATE workspaces_effects SET claim_settled=1 WHERE request_id=? AND repository_key=? AND owner_generation=? AND phase='RESOLVED'")
     .run(requireUuid(claim.requestId),claim.repositoryKey,requireUuid(claim.ownerGeneration));
   if(result.changes!==1)throw new Error('STALE_TARGET');
 },true);
}

function validateCleanupScope(database:Database.Database,intent:WorkflowIntent,workspace:WorkspaceRecord){
 const p=intent.payload;
 if(intent.projectId!==workspace.projectId||p.ownerGeneration!==workspace.ownerGeneration||p.markerDigest!==workspace.markerDigest||
   !workspace.markerDigest||!workspace.ownership||typeof p.headOid!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(p.headOid))
   throw new Error('OWNERSHIP_UNPROVEN');
 requireCleanupTarget({targetRef:String(p.targetRef),targetOid:String(p.targetOid)},workspace.ownership.branchRef);
 const project=database.prepare('SELECT removed_at,config_revision FROM projects WHERE project_id=?').get(workspace.projectId) as Row|undefined;
 if(!project||project.removed_at!==null)throw new Error('PROJECT_REMOVED');
 if(String(project.config_revision)!==intent.configRevision)throw new Error('REVISION_CONFLICT');
 if(activeLease(database,workspace.workspaceId))throw new Error('WORKSPACE_IN_USE');
}

type CleanupChange=Extract<WorkspaceChange,{kind:`cleanup-${string}`}>;
function cleanup(database:Database.Database,change:CleanupChange,ledger:FeatureLedger):WorkspaceWrite{
 if(change.kind==='cleanup-admit'){
   const {admission}=change,intent=ledger.intent(admission.canonicalIntent),workspaceId=requireUuid(intent.targetId);
   if(intent.namespace!=='WORKSPACE'||intent.action!=='remove')throw new Error('APPROVAL_REQUIRED');
   const admitted=ledger.admit(admission,()=>{
     requireWorkspaceInstance(database,admission.instanceId,'RUNNING');
     const workspace=readWorkspaceState(database,{kind:'get',id:workspaceId}).workspace;
     if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
     if(workspace.stateRevision!==intent.expectedRevision)throw new Error('REVISION_CONFLICT');
     if(workspace.state!=='READY'||database.prepare("SELECT 1 FROM workspaces_effects WHERE repository_key=? AND phase<>'RESOLVED'").get(workspace.repositoryKey))
       throw new Error('WORKSPACE_IN_USE');
     validateCleanupScope(database,intent,workspace);
     writeState(database,workspace,transitionWorkspace(workspace.state,'remove'),null);
     database.prepare("INSERT INTO workspaces_effects(request_id,workspace_id,repository_key,owner_generation,phase) VALUES(?,?,?,?,'INTENT')")
       .run(admission.requestId,workspaceId,workspace.repositoryKey,workspace.ownerGeneration);
   });
   const workspace=readWorkspaceState(database,{kind:'get',id:workspaceId}).workspace;
   return{...admitted,...(workspace?{workspace}:{})};
 }
 return ledger.transaction(()=>{
   const operation=readFeatureState(database,{kind:'operation',id:change.requestId}).operation;
   if(!operation||operation.namespace!=='WORKSPACE'||operation.action!=='remove'||operation.targetId!==change.fence.workspaceId)throw new Error('OPERATION_NOT_FOUND');
   if(operation.phase==='FINALIZED')return{operation};
   const workspace=readWorkspaceState(database,{kind:'get',id:operation.targetId}).workspace;
   if(!workspace)throw new Error('WORKSPACE_NOT_FOUND');
   requireWorkspaceFence(workspace,change.fence);
   const row=database.prepare('SELECT * FROM workspaces_effects WHERE request_id=? AND workspace_id=?').get(change.requestId,workspace.workspaceId) as Row|undefined;
   const owner=database.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.requestId) as Row;
   if(row?.owner_generation!==workspace.ownerGeneration)throw new Error('STALE_TARGET');
   const effect=readEffect(row),intent=ledger.intent(operation.canonicalIntent),headOid=String(intent.payload.headOid);
   const currentPhase=effect.lastPhase??effect.phase;
   const updatePhase=(phase:string,lastPhase?:string)=>database.prepare('UPDATE workspaces_effects SET phase=?,evidence=? WHERE request_id=?')
     .run(phase,lastPhase?JSON.stringify({lastPhase}):null,change.requestId);
   const removed=()=>{
     if(!('observation' in change)||!change.observation)throw new Error('OWNERSHIP_UNPROVEN');
     requireCleanupEffect(change.observation,headOid,'BRANCH_REMOVED');
     const result=writeState(database,workspace,transitionWorkspace(workspace.state,'removed'),null);
     database.prepare('UPDATE workspaces_records SET observation=NULL WHERE workspace_id=?').run(workspace.workspaceId);
     updatePhase('RESOLVED');
     return{operation:ledger.complete(change.requestId,result)};
   };
   if(change.kind==='cleanup-interrupted'){
     requireWorkspaceInstance(database,change.instanceId,'RECOVERING');
     if(owner.owning_instance_id===change.instanceId||!['REMOVING','RECONCILING'].includes(workspace.state))throw new Error('STALE_TARGET');
     if(change.observation&&currentPhase==='DELETE_BRANCH_INTENT')return removed();
     if(workspace.state==='RECONCILING')return{operation};
     const uncertain=currentPhase!=='INTENT',error=uncertain?'RESOURCE_IDENTITY_UNKNOWN':'INTERRUPTED';
     const result=writeState(database,workspace,transitionWorkspace(workspace.state,uncertain?'uncertain':'restore'),error);
     updatePhase(uncertain?'UNKNOWN':'RESOLVED',uncertain?currentPhase:undefined);
     return{operation:ledger.complete(change.requestId,result,error,uncertain?'UNKNOWN':'INTERRUPTED')};
   }
   requireWorkspaceInstance(database,change.instanceId,'RUNNING');
   if(owner.owning_instance_id!==change.instanceId||workspace.state!=='REMOVING')throw new Error('STALE_TARGET');
   if(change.kind==='cleanup-block'){
     if(!change.uncertain&&!['INTENT','REMOVE_INTENT'].includes(effect.phase))throw new Error('OWNERSHIP_UNPROVEN');
     const error=foundationError(change.error as ErrorCode).code;
     const state=transitionWorkspace(workspace.state,change.uncertain?'uncertain':error==='OWNERSHIP_UNPROVEN'?'block':'restore');
     const result=writeState(database,workspace,state,error);
     updatePhase(change.uncertain?'UNKNOWN':'RESOLVED',change.uncertain?effect.phase:undefined);
     return{operation:ledger.complete(change.requestId,result,error,change.uncertain?'UNKNOWN':'BLOCKED')};
   }
   validateCleanupScope(database,intent,workspace);
   const previous={REMOVE_INTENT:'INTENT',WORKTREE_REMOVED:'REMOVE_INTENT',DELETE_BRANCH_INTENT:'WORKTREE_REMOVED',BRANCH_REMOVED:'DELETE_BRANCH_INTENT'};
   if(effect.phase!==previous[change.stage])throw new Error('INVALID_TRANSITION');
   if(change.stage==='BRANCH_REMOVED')return removed();
   if(change.stage==='WORKTREE_REMOVED'){
     if(!change.observation)throw new Error('OWNERSHIP_UNPROVEN');
     requireCleanupEffect(change.observation,headOid,'WORKTREE_REMOVED');
   }
   updatePhase(change.stage);
   database.prepare("UPDATE workflow_operations SET phase='WORKING' WHERE request_id=?").run(change.requestId);
   return{operation:readFeatureState(database,{kind:'operation',id:change.requestId}).operation!};
 },true,{requestIds:[change.requestId]});
}
