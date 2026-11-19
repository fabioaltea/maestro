import {createHash} from 'node:crypto';
import {requireCurrentEnvironmentPlan} from '../domain/environments/plan.js';
import {transitionEnvironment} from '../domain/environments/state.js';
import {requireWorkspaceFence,nextWorkspaceRevision} from '../domain/workspaces/model.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import type {FeatureLedger} from './features-authoring.js';
import {readFeatureState,workflowOperation} from './features-store.js';
import {readWorkspaceState} from './workspaces-store.js';
import type Database from 'better-sqlite3';
import {requireDecimal,requireUuid} from '../domain/identifiers.js';
import type {EnvironmentChange,EnvironmentWrite,EnvironmentJob,EnvironmentPlan,EnvironmentQuery,EnvironmentRead,EnvironmentRecord} from '../ports/environment.js';
import {ENVIRONMENT_SCHEMA_VERSION} from './environments-schema.js';

type Row=Record<string,string|number|bigint|null>;
const nullable=(value:Row[string]|undefined)=>value==null?null:String(value);
export function requireEnvironmentSchema(db:Database.Database){
 if(Number(db.pragma('user_version',{simple:true}))<ENVIRONMENT_SCHEMA_VERSION)throw new Error('ENVIRONMENT_NOT_INITIALIZED');
}
function record(r:Row):EnvironmentRecord{
 return{environmentId:String(r.environment_id),workspaceId:String(r.workspace_id),workspaceGeneration:String(r.workspace_generation),state:r.state as EnvironmentRecord['state'],
   stateRevision:String(r.state_revision),currentPlanId:nullable(r.current_plan_id),attestationId:nullable(r.attestation_id),preparedDigest:nullable(r.prepared_digest),
   safeError:nullable(r.safe_error),checkedAt:nullable(r.checked_at),createdAt:String(r.created_at),updatedAt:String(r.updated_at)};
}
function plan(r:Row):EnvironmentPlan{
 return{planId:String(r.plan_id),environmentId:String(r.environment_id),workspaceGeneration:String(r.workspace_generation),workspaceRevision:String(r.workspace_revision),
   configRevision:String(r.config_revision),digest:String(r.digest),inputDigest:String(r.input_digest),artifactId:String(r.artifact_id),
   metadata:JSON.parse(String(r.metadata)) as EnvironmentPlan['metadata'],createdAt:String(r.created_at)};
}
function job(r:Row):EnvironmentJob{
 return{jobId:String(r.job_id),environmentId:String(r.environment_id),planId:String(r.plan_id),requestId:String(r.request_id),
   cancelRequestId:nullable(r.cancel_request_id),kind:r.kind as EnvironmentJob['kind'],commandSpecId:nullable(r.command_spec_id),generation:String(r.generation),
   leaseId:nullable(r.lease_id),phase:r.phase as EnvironmentJob['phase'],stateRevision:String(r.state_revision),inputDigest:String(r.input_digest),
   outputWatermark:String(r.output_watermark),truncated:Number(r.truncated)===1,exitProof:r.exit_proof===null?null:JSON.parse(String(r.exit_proof)) as EnvironmentJob['exitProof'],
   safeError:nullable(r.safe_error),createdAt:String(r.created_at),completedAt:nullable(r.completed_at)};
}
export function readEnvironmentState(db:Database.Database,query:EnvironmentQuery):EnvironmentRead{
 requireEnvironmentSchema(db);
 if(query.kind==='workspace'||query.kind==='environment'){
   const id=requireUuid(query.id),column=query.kind==='workspace'?'workspace_id':'environment_id';
   const r=db.prepare(`SELECT * FROM environments_records WHERE ${column}=?`).get(id) as Row|undefined;
   return{environment:r?record(r):null};
 }
 if(query.kind==='plan'){
   const r=db.prepare('SELECT * FROM environments_plans WHERE plan_id=?').get(requireUuid(query.id)) as Row|undefined;
   return{plan:r?plan(r):null};
 }
 if(query.kind==='job'){
   const r=db.prepare('SELECT * FROM environments_jobs WHERE job_id=?').get(requireUuid(query.id)) as Row|undefined;
   return{job:r?job(r):null};
 }
 if(query.kind==='artifact'){
   const id=requireUuid(query.id);
   const r=db.prepare(`SELECT sha256,expected_bytes FROM workflow_artifacts a WHERE artifact_id=? AND state='REFERENCED'
     AND (EXISTS(SELECT 1 FROM environments_plans p WHERE p.artifact_id=a.artifact_id)
       OR EXISTS(SELECT 1 FROM environments_output o WHERE o.artifact_id=a.artifact_id))`).get(id) as Row|undefined;
   return{artifact:r?{sha256:String(r.sha256),bytes:Number(r.expected_bytes)}:null};
 }
 if(query.kind==='pending-plans'){
   const rows=db.prepare("SELECT * FROM workflow_operations WHERE namespace='ENVIRONMENT' AND action='plan' AND phase<>'FINALIZED' LIMIT 32").all() as Row[];
   return{operations:rows.map(workflowOperation)};
 }
 if(query.kind==='active'){
   const rows=db.prepare("SELECT * FROM environments_jobs WHERE phase IN ('QUEUED','RUNNING','CANCELLING','RECONCILING')").all() as Row[];
   return{jobs:rows.map(job)};
 }
 if(query.kind==='output'){
   const limit=query.limit??20,id=requireUuid(query.id),after=BigInt(requireDecimal(query.after??'0'));
   if(!Number.isInteger(limit)||limit<1||limit>20||after<0n)throw new Error('INVALID_REQUEST');
   const rows=db.prepare('SELECT * FROM environments_output WHERE job_id=? AND seq>? ORDER BY seq LIMIT ?').all(id,after,limit) as Row[];
   return{chunks:rows.map(r=>({seq:String(r.seq),artifactId:String(r.artifact_id),sha256:String(r.sha256),bytes:Number(r.bytes)}))};
 }
 if(query.kind!=='list')throw new Error('INVALID_REQUEST');
 const projectId=requireUuid(query.projectId),offset=query.offset??0,limit=query.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const rows=db.prepare(`SELECT e.* FROM environments_records e JOIN workspaces_records w ON w.workspace_id=e.workspace_id
   WHERE w.project_id=? ORDER BY e.created_at,e.environment_id LIMIT ? OFFSET ?`).all(projectId,limit+1,offset) as Row[];
 const revision=db.prepare('SELECT revision FROM store WHERE singleton=1').get() as Row;
 return{items:rows.slice(0,limit).map(record),nextOffset:rows.length>limit?offset+limit:null,pageRevision:String(revision.revision)};
}

function environmentInstance(db:Database.Database,instanceId:string,lifecycle:'RUNNING'|'RECOVERING'){
 const row=db.prepare('SELECT i.lifecycle FROM instances i JOIN store s ON i.instance_id=s.current_instance_id WHERE i.instance_id=?')
   .get(requireUuid(instanceId)) as Row|undefined;
 if(row?.lifecycle!==lifecycle)throw new Error('STALE_TARGET');
}
function planWorkspace(db:Database.Database,intent:WorkflowIntent){
 const workspace=readWorkspaceState(db,{kind:'get',id:requireUuid(intent.targetId)}).workspace;
 if(!workspace||workspace.projectId!==intent.projectId)throw new Error('WORKSPACE_NOT_FOUND');
 if(workspace.state!=='READY'||readWorkspaceState(db,{kind:'active-lease',id:workspace.workspaceId}).lease)throw new Error('WORKSPACE_IN_USE');
 if(workspace.stateRevision!==intent.expectedRevision)throw new Error('REVISION_CONFLICT');
 const project=db.prepare('SELECT config_revision,removed_at FROM projects WHERE project_id=?').get(workspace.projectId) as Row|undefined;
 if(!project||project.removed_at!==null)throw new Error('PROJECT_REMOVED');
 if(String(project.config_revision)!==intent.configRevision)throw new Error('REVISION_CONFLICT');
 return workspace;
}
function environmentError(error:string){
 return foundationError(error as ErrorCode).code;
}
export function commitEnvironmentState(db:Database.Database,change:EnvironmentChange,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):EnvironmentWrite{
 requireEnvironmentSchema(db);
 if(change.kind==='plan-admit'){
   const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
   if(intent.namespace!=='ENVIRONMENT'||intent.action!=='plan')throw new Error('INVALID_REQUEST');
   return ledger.admit(admission,()=>{
     environmentInstance(db,admission.instanceId,'RUNNING');
     const workspace=planWorkspace(db,intent);
     if(db.prepare("SELECT 1 FROM workflow_operations WHERE namespace='ENVIRONMENT' AND action='plan' AND target_id=? AND phase<>'FINALIZED' AND request_id<>?")
       .get(workspace.workspaceId,admission.requestId))throw new Error('BUSY');
   });
 }
 if(change.kind==='attest')return attest(db,change,ledger,verifyArtifact);
 return ledger.transaction(()=>{
   const operation=readFeatureState(db,{kind:'operation',id:change.requestId}).operation;
   if(!operation||operation.namespace!=='ENVIRONMENT'||operation.action!=='plan')throw new Error('OPERATION_NOT_FOUND');
   if(operation.phase==='FINALIZED')return{operation};
   const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.requestId) as Row;
   if(change.kind==='plan-block'&&change.interrupted){
     environmentInstance(db,change.instanceId,'RECOVERING');
     if(owner.owning_instance_id===change.instanceId||change.error!=='INTERRUPTED')throw new Error('STALE_TARGET');
     return{operation:ledger.complete(change.requestId,null,'INTERRUPTED','INTERRUPTED')};
   }
   environmentInstance(db,change.instanceId,'RUNNING');
   if(owner.owning_instance_id!==change.instanceId)throw new Error('STALE_TARGET');
   if(change.kind==='plan-block')return{operation:ledger.complete(change.requestId,null,environmentError(change.error),'BLOCKED')};
   const intent=ledger.intent(operation.canonicalIntent),workspace=planWorkspace(db,intent);
   requireWorkspaceFence(workspace,change.fence);
   const value=change.plan,metadata=value.metadata,encoded=JSON.stringify(metadata);
   const digest=createHash('sha256').update(encoded).digest('hex'),id=workspace.workspaceId;
   if(value.planId!==change.requestId||value.workspaceGeneration!==workspace.ownerGeneration||value.configRevision!==intent.configRevision
     ||value.workspaceRevision!==workspace.stateRevision||value.inputDigest!==metadata.inputDigest||
     !/^[a-f0-9]{64}$/.test(value.inputDigest)||value.digest!==digest||!['PLANNED','MANUAL_REQUIRED'].includes(metadata.disposition)
     ||!Number.isFinite(Date.parse(value.createdAt)))throw new Error('INVALID_REQUEST');
   const artifact=readFeatureState(db,{kind:'artifact',id:value.artifactId}).artifact;
   if(!artifact||!['SEALED','REFERENCED'].includes(artifact.state)||artifact.kind!=='BUNDLE'||artifact.sha256!==digest||artifact.targetId!==id)
     throw new Error('ARTIFACT_CORRUPT');
   verifyArtifact(value.artifactId);
   const previous=readEnvironmentState(db,{kind:'workspace',id}).environment;
   const environmentId=requireUuid(value.environmentId),state=transitionEnvironment(previous?.state??'UNCONFIGURED',
     metadata.disposition==='PLANNED'?'plan':'manual');
   if(previous&&previous.environmentId!==environmentId)throw new Error('REVISION_CONFLICT');
   const stateRevision=previous?nextWorkspaceRevision(previous.stateRevision):'1';
   if(!previous){
     db.prepare(`INSERT INTO environments_records(environment_id,workspace_id,workspace_generation,state,state_revision,
       current_plan_id,checked_at,created_at,updated_at) VALUES(?,?,?,?,1,?,?,?,?)`)
       .run(environmentId,id,workspace.ownerGeneration,state,value.planId,value.createdAt,value.createdAt,value.createdAt);
   }else{
     db.prepare(`UPDATE environments_records SET workspace_generation=?,state=?,state_revision=?,current_plan_id=?,attestation_id=NULL,
       prepared_digest=NULL,safe_error=NULL,checked_at=?,updated_at=? WHERE environment_id=? AND state_revision=?`)
       .run(workspace.ownerGeneration,state,BigInt(stateRevision),value.planId,value.createdAt,value.createdAt,environmentId,BigInt(previous.stateRevision));
   }
   db.prepare(`INSERT INTO environments_plans(plan_id,environment_id,request_id,workspace_generation,workspace_revision,config_revision,
     digest,input_digest,artifact_id,metadata,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
     .run(value.planId,environmentId,change.requestId,workspace.ownerGeneration,BigInt(workspace.stateRevision),BigInt(value.configRevision),
       value.digest,value.inputDigest,value.artifactId,encoded,value.createdAt);
   db.prepare("UPDATE workflow_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(value.artifactId);
   const result={environmentId,planId:value.planId,workspaceId:id,stateRevision};
   return{operation:ledger.complete(change.requestId,result),plan:value,environment:readEnvironmentState(db,{kind:'environment',id:environmentId}).environment!};
 },true,{requestIds:[change.requestId]});
}

function attest(db:Database.Database,change:Extract<EnvironmentChange,{kind:'attest'}>,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):EnvironmentWrite{
 const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
 if(intent.namespace!=='ENVIRONMENT'||intent.action!=='attest')throw new Error('APPROVAL_REQUIRED');
 const workspaceId=requireUuid(intent.targetId);
 const admitted=ledger.admit(admission,()=>{
   environmentInstance(db,admission.instanceId,'RUNNING');
   const workspace=planWorkspace(db,{...intent,expectedRevision:String(intent.payload.workspaceRevision)});
   const {environment}=readEnvironmentState(db,{kind:'workspace',id:workspaceId});
   if(!environment?.currentPlanId||environment.state!=='MANUAL_REQUIRED')throw new Error('ENVIRONMENT_STALE');
   const {plan}=readEnvironmentState(db,{kind:'plan',id:environment.currentPlanId});
   if(!plan||change.observedInputDigest!==plan.inputDigest)throw new Error('ENVIRONMENT_STALE');
   verifyArtifact(plan.artifactId);
   requireCurrentEnvironmentPlan({planId:plan.planId,workspaceGeneration:workspace.ownerGeneration,stateRevision:environment.stateRevision,inputDigest:plan.inputDigest},
     {planId:String(intent.payload.planId),workspaceGeneration:String(intent.payload.workspaceGeneration),
       stateRevision:String(intent.expectedRevision),inputDigest:String(intent.payload.inputDigest)});
   const {limitations}=intent.payload;
   if(!Array.isArray(limitations)||limitations.length<1||limitations.length>8||limitations.some(v=>typeof v!=='string'||Buffer.byteLength(v)>256||!v.trim())||
     !Number.isFinite(Date.parse(change.checkedAt)))throw new Error('INVALID_REQUEST');
   const attestationId=admission.requestId,stateRevision=nextWorkspaceRevision(environment.stateRevision);
   db.prepare(`INSERT INTO environments_attestations(attestation_id,environment_id,plan_id,request_id,input_digest,limitations,owner_uid,created_at)
     VALUES(?,?,?,?,?,?,?,?)`).run(attestationId,environment.environmentId,plan.planId,admission.requestId,plan.inputDigest,JSON.stringify(limitations),intent.ownerUid,change.checkedAt);
   db.prepare("UPDATE environments_records SET state=?,state_revision=?,attestation_id=?,safe_error=NULL,checked_at=?,updated_at=? WHERE environment_id=? AND state_revision=?")
     .run(transitionEnvironment(environment.state,'attest'),BigInt(stateRevision),attestationId,change.checkedAt,change.checkedAt,
       environment.environmentId,BigInt(environment.stateRevision));
   ledger.complete(admission.requestId,{workspaceId,environmentId:environment.environmentId,planId:plan.planId,attestationId,stateRevision});
 });
 return admitted;
}
