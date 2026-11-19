import {requireEnvironmentValidation} from '../domain/environments/validation.js';
import {evaluateEnvironmentExit} from '../domain/environments/jobs.js';
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
 if(query.kind==='latest-job'){
   const r=db.prepare('SELECT * FROM environments_jobs WHERE environment_id=? ORDER BY created_at DESC,job_id DESC LIMIT 1')
     .get(requireUuid(query.id)) as Row|undefined;
   return{job:r?job(r):null};
 }
 if(query.kind==='artifact'){
   const id=requireUuid(query.id);
   const r=db.prepare(`SELECT sha256,expected_bytes FROM workflow_artifacts a WHERE artifact_id=? AND state='REFERENCED'
     AND (EXISTS(SELECT 1 FROM environments_plans p WHERE p.artifact_id=a.artifact_id)
       OR EXISTS(SELECT 1 FROM environments_output o WHERE o.artifact_id=a.artifact_id))`).get(id) as Row|undefined;
   return{artifact:r?{sha256:String(r.sha256),bytes:Number(r.expected_bytes)}:null};
 }
 if(query.kind==='pending-plans'||query.kind==='pending-reconciles'){
   const rows=db.prepare("SELECT * FROM workflow_operations WHERE namespace='ENVIRONMENT' AND action=? AND phase<>'FINALIZED' LIMIT 32")
     .all(query.kind==='pending-plans'?'plan':'reconcile') as Row[];
   return{operations:rows.map(workflowOperation)};
 }
 if(query.kind==='retained-leases'){
   const rows=db.prepare(`SELECT j.* FROM environments_jobs j JOIN workspaces_leases l ON l.lease_id=j.lease_id
     WHERE l.released_at IS NULL AND j.phase IN ('SUCCEEDED','FAILED','CANCELLED')`).all() as Row[];
   return{jobs:rows.map(job)};
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

function environmentInstance(db:Database.Database,instanceId:string,lifecycle:'RUNNING'|'RECOVERING'|readonly ('RUNNING'|'RECOVERING'|'STOPPING')[]){
 const row=db.prepare('SELECT i.lifecycle FROM instances i JOIN store s ON i.instance_id=s.current_instance_id WHERE i.instance_id=?')
   .get(requireUuid(instanceId)) as Row|undefined;
 if(!row||!(typeof lifecycle==='string'?row.lifecycle===lifecycle:lifecycle.some(value=>value===row.lifecycle)))throw new Error('STALE_TARGET');
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
     const {environment}=readEnvironmentState(db,{kind:'workspace',id:workspace.workspaceId});
     if(environment&&['PREPARING','RECONCILING'].includes(environment.state))throw new Error('WORKSPACE_IN_USE');
     if(db.prepare("SELECT 1 FROM workflow_operations WHERE namespace='ENVIRONMENT' AND action='plan' AND target_id=? AND phase<>'FINALIZED' AND request_id<>?")
       .get(workspace.workspaceId,admission.requestId))throw new Error('BUSY');
   });
 }
 if(change.kind==='attest')return attest(db,change,ledger,verifyArtifact);
 if(change.kind==='job-admit'||change.kind==='job-cancel')return admitJob(db,change,ledger,verifyArtifact);
 if(change.kind==='job-start'||change.kind==='job-finish')return progressJob(db,change,ledger,verifyArtifact);
 if(change.kind==='job-observe'||change.kind==='job-observed')return observeJob(db,change,ledger);
 if(change.kind==='inspection-stale'){
   return ledger.transaction(()=>{
     environmentInstance(db,change.instanceId,'RUNNING');
     const {environment}=readEnvironmentState(db,{kind:'environment',id:change.environmentId});
     if(!environment||environment.state!=='READY'||environment.stateRevision!==change.expectedStateRevision||!environment.currentPlanId)
       throw new Error('REVISION_CONFLICT');
     const operation=readFeatureState(db,{kind:'operation',id:environment.currentPlanId}).operation;
     if(!operation)throw new Error('STATE_CORRUPT');
     updateEnvironment(db,environment,transitionEnvironment(environment.state,'stale'),'ENVIRONMENT_STALE',null);
     return{operation};
   },true,{environmentIds:[change.environmentId]});
 }
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

function scopedJob(db:Database.Database,jobId:string){
 const {job}=readEnvironmentState(db,{kind:'job',id:jobId});
 if(!job)throw new Error('OPERATION_NOT_FOUND');
 const [{environment},{plan},{operation}]=[
   readEnvironmentState(db,{kind:'environment',id:job.environmentId}),readEnvironmentState(db,{kind:'plan',id:job.planId}),
   readFeatureState(db,{kind:'operation',id:job.requestId}),
 ];
 if(!environment||!plan||!operation||operation.namespace!=='ENVIRONMENT'||operation.targetId!==environment.workspaceId)
   throw new Error('STATE_CORRUPT');
 return{job,environment,plan,operation};
}
function updateEnvironment(db:Database.Database,environment:EnvironmentRecord,state:EnvironmentRecord['state'],error:string|null,preparedDigest:string|null){
 const revision=nextWorkspaceRevision(environment.stateRevision),at=new Date().toISOString();
 db.prepare('UPDATE environments_records SET state=?,state_revision=?,prepared_digest=?,safe_error=?,checked_at=?,updated_at=? WHERE environment_id=? AND state_revision=?')
   .run(state,BigInt(revision),preparedDigest,error,at,at,environment.environmentId,BigInt(environment.stateRevision));
 return revision;
}

type JobAdmission=Extract<EnvironmentChange,{kind:'job-admit'|'job-cancel'}>;
function admitJob(db:Database.Database,change:JobAdmission,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):EnvironmentWrite{
 const {admission}=change,intent=ledger.intent(admission.canonicalIntent),workspaceId=requireUuid(intent.targetId);
 const cancelling=change.kind==='job-cancel',validating=intent.action==='validate';
 if(intent.namespace!=='ENVIRONMENT'||(cancelling?intent.action!=='cancel':!['prepare','validate'].includes(intent.action)))throw new Error('APPROVAL_REQUIRED');
 const admitted=ledger.admit(admission,()=>{
   environmentInstance(db,admission.instanceId,'RUNNING');
   if(cancelling){
     const {job,environment}=scopedJob(db,requireUuid(intent.payload.jobId));
     if(environment.workspaceId!==workspaceId||job.generation!==intent.payload.jobGeneration||job.stateRevision!==intent.expectedRevision
       ||!['QUEUED','RUNNING'].includes(job.phase))throw new Error('REVISION_CONFLICT');
     db.prepare("UPDATE environments_jobs SET phase='CANCELLING',state_revision=state_revision+1,cancel_request_id=? WHERE job_id=?")
       .run(admission.requestId,job.jobId);
     db.prepare('UPDATE workflow_operations SET result=? WHERE request_id=?').run(JSON.stringify({workspaceId,jobId:job.jobId}),admission.requestId);
     return;
   }
   const workspace=planWorkspace(db,{...intent,expectedRevision:String(intent.payload.workspaceRevision)});
   const {environment}=readEnvironmentState(db,{kind:'workspace',id:workspaceId});
   const {plan}=readEnvironmentState(db,{kind:'plan',id:requireUuid(intent.payload.planId)});
   if(!environment||!plan||environment.state!==(validating?'READY':'PLANNED')||environment.currentPlanId!==plan.planId||plan.digest!==intent.payload.planDigest||
     plan.inputDigest!==intent.payload.inputDigest||plan.configRevision!==intent.configRevision||plan.workspaceGeneration!==workspace.ownerGeneration||
     environment.stateRevision!==intent.expectedRevision||plan.metadata.disposition!=='PLANNED'||!plan.metadata.pin)throw new Error('ENVIRONMENT_STALE');
   if(readEnvironmentState(db,{kind:'active'}).jobs!.length||db.prepare(
     "SELECT 1 FROM workflow_operations WHERE namespace='ENVIRONMENT' AND action='plan' AND target_id=? AND phase<>'FINALIZED'").get(workspaceId))
     throw new Error('BUSY');
   const spec=validating?requireEnvironmentValidation({state:environment.state,preparedDigest:environment.preparedDigest,inputDigest:plan.inputDigest,
     expectedInputDigest:String(intent.payload.inputDigest),commandSpecId:String(intent.payload.commandSpecId),commands:plan.metadata.commands??[]}):null;
   verifyArtifact(plan.artifactId);
   const stateRevision=updateEnvironment(db,environment,transitionEnvironment(environment.state,validating?'validate':'prepare'),null,null);
   const jobId=admission.requestId,generation=requireUuid(intent.payload.jobGeneration);
   const result={workspaceId,environmentId:environment.environmentId,planId:plan.planId,jobId,stateRevision};
   db.prepare(`INSERT INTO environments_jobs(job_id,environment_id,plan_id,request_id,kind,command_spec_id,generation,phase,state_revision,input_digest,created_at)
     VALUES(?,?,?,?,?,?,?,'QUEUED',1,?,?)`).run(jobId,environment.environmentId,plan.planId,jobId,validating?'VALIDATE':'INSTALL',spec?.id??null,
       generation,plan.inputDigest,new Date().toISOString());
   db.prepare('UPDATE workflow_operations SET result=? WHERE request_id=?').run(JSON.stringify(result),jobId);
 });
 const jobId=cancelling?requireUuid(intent.payload.jobId):admission.requestId;
 const {job}=readEnvironmentState(db,{kind:'job',id:jobId});
 return{...admitted,...(job?{job}:{})};
}
type JobProgress=Extract<EnvironmentChange,{kind:'job-start'|'job-finish'}>;
function progressJob(db:Database.Database,change:JobProgress,ledger:FeatureLedger,verifyArtifact:(id:string)=>void):EnvironmentWrite{
 const snapshot=scopedJob(db,change.jobId);
 if(snapshot.operation.phase==='FINALIZED')return{operation:snapshot.operation,job:snapshot.job};
 const requestIds=[snapshot.job.requestId,...(snapshot.job.cancelRequestId?[snapshot.job.cancelRequestId]:[])];
 return ledger.transaction(()=>{
   const {job,environment,plan,operation}=scopedJob(db,change.jobId);
   const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(job.requestId) as Row;
   const recovering=change.kind==='job-finish'&&change.recovering===true;
   environmentInstance(db,change.instanceId,recovering?'RECOVERING':['RUNNING','STOPPING']);
   if(change.kind==='job-finish'&&change.reconcileId){
     const observation=readFeatureState(db,{kind:'operation',id:change.reconcileId}).operation;
     if(!observation||observation.namespace!=='ENVIRONMENT'||observation.action!=='reconcile'||observation.phase==='FINALIZED'||job.phase!=='RECONCILING'||
       !change.proof)throw new Error('STALE_TARGET');
     const scope=ledger.intent(observation.canonicalIntent);
     if(scope.targetId!==environment.workspaceId||scope.payload.jobId!==job.jobId||scope.expectedRevision!==job.stateRevision)throw new Error('STALE_TARGET');
     const observer=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.reconcileId) as Row;
     if(observer.owning_instance_id!==change.instanceId)throw new Error('STALE_TARGET');
   }else if((owner.owning_instance_id===change.instanceId)===recovering)throw new Error('STALE_TARGET');
   const {workspaceId}=environment;
   if(change.kind==='job-start'){
     if(!['QUEUED','CANCELLING'].includes(job.phase)||job.leaseId||change.identity.jobId!==job.jobId||change.identity.generation!==job.generation)
       throw new Error('STALE_TARGET');
     const {lease}=readWorkspaceState(db,{kind:'active-lease',id:workspaceId});
     if(!lease||lease.leaseId!==change.identity.leaseId||lease.generation!==job.generation||lease.holderId!==job.jobId||
       lease.holderType!=='ENVIRONMENT'||lease.instanceId!==change.instanceId)throw new Error('WORKSPACE_IN_USE');
     db.prepare('UPDATE environments_jobs SET phase=?,state_revision=state_revision+1,lease_id=? WHERE job_id=?')
       .run(job.phase==='CANCELLING'?'CANCELLING':'RUNNING',lease.leaseId,job.jobId);
     db.prepare("UPDATE workflow_operations SET phase='WORKING' WHERE request_id=?").run(job.requestId);
     return{operation:readFeatureState(db,{kind:'operation',id:job.requestId}).operation!,job:readEnvironmentState(db,{kind:'job',id:job.jobId}).job!};
   }
   if(change.generation!==job.generation)throw new Error('STALE_TARGET');
   const identity={jobId:job.jobId,generation:job.generation,leaseId:job.leaseId??job.jobId};
   const noLaunch=change.noLaunchError!==undefined;
   if(noLaunch&&(job.leaseId||!['QUEUED','CANCELLING'].includes(job.phase)))throw new Error('STALE_TARGET');
   const evaluation=noLaunch?
     {phase:job.cancelRequestId?'CANCELLED' as const:'FAILED' as const,error:environmentError(change.noLaunchError!)}:
     evaluateEnvironmentExit(identity,change.proof,change.inputsCurrent);
   const {phase,error}=evaluation,uncertain=phase==='RECONCILING',succeeded=phase==='SUCCEEDED';
   if(error!==null)environmentError(error);
   const ready=succeeded||job.kind==='VALIDATE'&&!uncertain&&change.inputsCurrent;
   if(ready){
     const {workspace}=readWorkspaceState(db,{kind:'get',id:workspaceId});
     const project=workspace?db.prepare('SELECT config_revision,removed_at FROM projects WHERE project_id=?').get(workspace.projectId) as Row|undefined:undefined;
     if(!workspace||workspace.ownerGeneration!==plan.workspaceGeneration||!project||project.removed_at!==null||String(project.config_revision)!==plan.configRevision)
       throw new Error('ENVIRONMENT_STALE');
     verifyArtifact(plan.artifactId);
   }
   const state=transitionEnvironment(environment.state,uncertain?'uncertain':ready?'prepared':
     error==='ENVIRONMENT_STALE'||job.kind==='VALIDATE'&&!!change.proof?'stale':'block');
   const at=new Date().toISOString();
   let watermark='0';
   const truncated=change.proof?.truncated===true||!!change.proof&&!change.outputArtifactId;
   if(change.outputArtifactId){
     const {artifact}=readFeatureState(db,{kind:'artifact',id:change.outputArtifactId});
     if(!artifact||artifact.kind!=='OUTPUT'||artifact.targetId!==workspaceId||artifact.expectedBytes>8192||
       !['SEALED','REFERENCED'].includes(artifact.state))throw new Error('ARTIFACT_CORRUPT');
     verifyArtifact(artifact.artifactId);
     db.prepare('INSERT INTO environments_output(job_id,seq,artifact_id,sha256,bytes) VALUES(?,1,?,?,?)')
       .run(job.jobId,artifact.artifactId,artifact.sha256,artifact.expectedBytes);
     db.prepare("UPDATE workflow_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(artifact.artifactId);
     watermark='1';
   }
   const proof=change.proof?{verified:true,code:change.proof.exitCode,reason:change.proof.error}:null;
   db.prepare(`UPDATE environments_jobs SET phase=?,state_revision=state_revision+1,output_watermark=?,truncated=?,exit_proof=?,safe_error=?,completed_at=?
     WHERE job_id=?`).run(phase,BigInt(watermark),Number(truncated),proof?JSON.stringify(proof):null,error,uncertain?null:at,job.jobId);
   const revision=updateEnvironment(db,environment,state,error,ready?plan.inputDigest:null);
   const result={workspaceId,environmentId:environment.environmentId,jobId:job.jobId,planId:plan.planId,stateRevision:revision};
   if(job.cancelRequestId)ledger.complete(job.cancelRequestId,result,uncertain?error:null,uncertain?'UNKNOWN':'SUCCEEDED');
   return{operation:ledger.complete(operation.requestId,result,error,uncertain?'UNKNOWN':succeeded?'SUCCEEDED':phase==='CANCELLED'||error==='INTERRUPTED'?'INTERRUPTED':job.kind==='VALIDATE'?'FAILED':'BLOCKED'),
     job:readEnvironmentState(db,{kind:'job',id:job.jobId}).job!};
 },true,{requestIds});
}

type ObserveChange=Extract<EnvironmentChange,{kind:'job-observe'|'job-observed'}>;
function observeJob(db:Database.Database,change:ObserveChange,ledger:FeatureLedger):EnvironmentWrite{
 if(change.kind==='job-observe'){
   const {admission}=change,intent=ledger.intent(admission.canonicalIntent);
   if(intent.namespace!=='ENVIRONMENT'||intent.action!=='reconcile')throw new Error('INVALID_REQUEST');
   return ledger.admit(admission,()=>{
     environmentInstance(db,admission.instanceId,'RUNNING');
     const {job,environment}=scopedJob(db,requireUuid(intent.payload.jobId));
     if(environment.workspaceId!==intent.targetId||job.stateRevision!==intent.expectedRevision)throw new Error('REVISION_CONFLICT');
     if(!['RECONCILING','SUCCEEDED','FAILED','CANCELLED'].includes(job.phase))throw new Error('BUSY');
   });
 }
 return ledger.transaction(()=>{
   environmentInstance(db,change.instanceId,change.recovering?'RECOVERING':'RUNNING');
   const observation=readFeatureState(db,{kind:'operation',id:change.requestId}).operation;
   if(!observation||observation.namespace!=='ENVIRONMENT'||observation.action!=='reconcile')throw new Error('OPERATION_NOT_FOUND');
   if(observation.phase==='FINALIZED')return{operation:observation};
   const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(change.requestId) as Row;
   if((owner.owning_instance_id===change.instanceId)===!!change.recovering)throw new Error('STALE_TARGET');
   const intent=ledger.intent(observation.canonicalIntent),{job,environment,operation}=scopedJob(db,requireUuid(intent.payload.jobId));
   if(environment.workspaceId!==intent.targetId)throw new Error('STALE_TARGET');
   const result={workspaceId:environment.workspaceId,environmentId:environment.environmentId,jobId:job.jobId,planId:job.planId,stateRevision:job.stateRevision};
   return{operation:operation.phase==='FINALIZED'?ledger.complete(change.requestId,result):
     ledger.complete(change.requestId,result,'JOB_RECONCILING','BLOCKED'),job};
 },true,{requestIds:[change.requestId]});
}
