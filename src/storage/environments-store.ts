import type Database from 'better-sqlite3';
import {requireDecimal,requireUuid} from '../domain/identifiers.js';
import type {EnvironmentJob,EnvironmentPlan,EnvironmentQuery,EnvironmentRead,EnvironmentRecord} from '../ports/environment.js';
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
