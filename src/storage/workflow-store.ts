import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {canonicalWorkflowIntent,validateWorkflowGrant,type WorkflowIntent} from '../domain/workflow/authorization.js';
import type {WorkflowAdmission,WorkflowChange,WorkflowWrite,WorkflowOperationRecord} from '../ports/workflow.js';
import {readFeatureState,workflowOperation,requireFeatureSchema,type FeatureRow} from './features-store.js';
import type {createWorkflowArtifacts} from './workflow-artifacts.js';
import {foundationError,type ErrorCode} from '../domain/errors.js';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
type UploadChange=Extract<WorkflowChange,{kind:'reserve'|'append'|'seal'|'discard'}>;
export interface WorkflowMutation {<T>(body:()=>T,terminal?:boolean):T}
export function createWorkflowStore(db:Database.Database,mutate:WorkflowMutation,artifacts:ReturnType<typeof createWorkflowArtifacts>,options:{readonly nowMs?:()=>number}={}){
 requireFeatureSchema(db);const now=options.nowMs??Date.now;
 const identity=()=>db.prepare('SELECT store_id,owner_uid,current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;
 function budget(terminal=false){
 const usage=readFeatureState(db,{kind:'budget'}).budget!;
 const tables=['workflow_operations','workflow_grants','workflow_artifacts','features_records','features_revisions','features_approvals','features_envelopes','features_turns'];
 let metadata=8192;for(const table of tables){const rows=db.prepare(`SELECT * FROM ${table}`).iterate() as Iterable<FeatureRow>;for(const row of rows)metadata+=Math.ceil(Buffer.byteLength(JSON.stringify(row,(_k,v:unknown)=>typeof v==='bigint'?v.toString():v))/4096)*4096+4096;}
 db.prepare('UPDATE workflow_budget SET metadata_bytes=? WHERE singleton=1').run(metadata);
 if(usage.allocatedBytes+usage.reservedBytes+metadata>128*1024*1024-(terminal?0:8*1024*1024)||usage.allocatedFiles>8192)throw new Error('RESOURCE_LIMIT');
 }
 function transaction<T>(body:()=>T,terminal=false):T{return mutate(()=>{const result=body();budget(terminal);return result;},terminal);}
 const operation=(id:string)=>{requireUuid(id);const r=db.prepare('SELECT * FROM workflow_operations WHERE request_id=?').get(id) as FeatureRow|undefined;return r?workflowOperation(r):null;};
 function intent(canonical:string):WorkflowIntent{const i=JSON.parse(canonical) as WorkflowIntent;if(canonicalWorkflowIntent(i)!==canonical)throw new Error('INVALID_REQUEST');const owner=identity();if(i.storeId!==owner.store_id||i.ownerUid!==Number(owner.owner_uid))throw new Error('APPROVAL_REQUIRED');return i;}
 function admit(a:WorkflowAdmission,setup?:()=>void):{operation:WorkflowOperationRecord;inserted:boolean}{
 requireUuid(a.requestId);requireUuid(a.instanceId);const i=intent(a.canonicalIntent),hash=digest(a.canonicalIntent);const prior=operation(a.requestId);
 if(prior){if(prior.canonicalIntent!==a.canonicalIntent||prior.payloadHash!==hash)throw new Error('IDEMPOTENCY_CONFLICT');return{operation:prior,inserted:false};}
 return transaction(()=>{
 if(identity().current_instance_id!==a.instanceId)throw new Error('STALE_TARGET');
 if(db.prepare('SELECT 1 FROM request_catalog WHERE request_id=?').get(a.requestId)||db.prepare('SELECT 1 FROM discovery_operations WHERE request_id=?').get(a.requestId))throw new Error('IDEMPOTENCY_CONFLICT');
 const granted=i.namespace==='FEATURE';if(granted){if(!a.grantId)throw new Error('APPROVAL_REQUIRED');const g=readFeatureState(db,{kind:'grant',id:a.grantId}).grant;if(!g||validateWorkflowGrant(g,a.canonicalIntent,a.requestId,now())!=='CONSUME')throw new Error('APPROVAL_REQUIRED');}else if(a.grantId!==null||!['reserve','append','seal','discard'].includes(i.action))throw new Error('INVALID_REQUEST');
 db.prepare("INSERT INTO workflow_operations(request_id,namespace,action,payload_hash,canonical_intent,owner_uid,owning_instance_id,phase,outcome,target_id,accepted_at) VALUES(?,?,?,?,?,?,?,'ACCEPTED','IN_PROGRESS',?,?)").run(a.requestId,i.namespace,i.action,hash,a.canonicalIntent,i.ownerUid,a.instanceId,i.targetId,new Date(now()).toISOString());
 if(granted)db.prepare('UPDATE workflow_grants SET consumed_by_request_id=? WHERE grant_id=?').run(a.requestId,a.grantId);
 setup?.();return{operation:operation(a.requestId)!,inserted:true};
 },i.action==='cancel'||i.namespace==='ARTIFACT'&&i.action==='discard');
 }
 function complete(requestId:string,result:Readonly<Record<string,unknown>>|null,error:string|null=null,outcome:'SUCCEEDED'|'FAILED'|'BLOCKED'|'INTERRUPTED'|'UNKNOWN'='SUCCEEDED'){
 const old=operation(requestId);if(!old)throw new Error('OPERATION_NOT_FOUND');if(old.phase==='FINALIZED')return old;
 if(result&&Buffer.byteLength(JSON.stringify(result))>8192)throw new Error('CONTEXT_LIMIT');if(error!==null)foundationError(error as ErrorCode);
 db.prepare("UPDATE workflow_operations SET phase=?,outcome=?,result=?,error=?,completed_at=? WHERE request_id=? AND phase<>'FINALIZED'").run(outcome==='UNKNOWN'?'WORKING':'FINALIZED',outcome,result===null?null:JSON.stringify(result),error,outcome==='UNKNOWN'?null:new Date(now()).toISOString(),requestId);return operation(requestId)!;
 }
 function executeUpload(c:UploadChange):WorkflowWrite{
 const a=c.admission,i=intent(a.canonicalIntent);if(i.namespace!=='ARTIFACT'||i.action!==c.kind)throw new Error('INVALID_REQUEST');
 if(!['reserve','append','seal','discard'].includes(c.kind))throw new Error('UNSUPPORTED_VERSION');
 if(c.kind==='reserve'){
 const value=c.artifact;requireUuid(value.artifactId);
 if(value.artifactId!==a.requestId||value.expectedBytes!==i.payload.expectedBytes||value.sha256!==i.payload.sha256||value.kind!==i.payload.kind||value.targetId!==i.payload.targetId||value.state!=='RESERVED'||value.offsetBytes!==0||value.referenceCount!==0||value.expectedBytes<1||value.expectedBytes>262144||!Number.isSafeInteger(value.expectedBytes)||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('INVALID_REQUEST');
 const r=admit(a,()=>{if(readFeatureState(db,{kind:'budget'}).budget!.openUploads>=4)throw new Error('RESOURCE_LIMIT');
 db.prepare("INSERT INTO workflow_artifacts(artifact_id,kind,target_id,expected_bytes,sha256,allocated_bytes,state,created_at_ms,expires_at_ms) VALUES(?,?,?,?,?,?,'RESERVED',?,?)").run(value.artifactId,value.kind,value.targetId,value.expectedBytes,value.sha256,Math.ceil(value.expectedBytes/4096)*4096,now(),now()+900000);});
 if(r.operation.phase==='FINALIZED')return{operation:r.operation,artifact:readFeatureState(db,{kind:'artifact',id:value.artifactId}).artifact!};
 artifacts.create(value.artifactId);return transaction(()=>({operation:complete(a.requestId,{artifactId:value.artifactId}),artifact:readFeatureState(db,{kind:'artifact',id:value.artifactId}).artifact!}));
 }
 const id=c.artifactId;requireUuid(id);if(i.payload.artifactId!==id)throw new Error('INVALID_REQUEST');
 if(c.kind==='append'&&(i.payload.offset!==c.offset||i.payload.sha256!==c.sha256||i.payload.byteLength!==c.bytes.length))throw new Error('INVALID_REQUEST');
 if(c.kind==='append'&&createHash('sha256').update(c.bytes).digest('hex')!==c.sha256)throw new Error('INVALID_REQUEST');
 const current=readFeatureState(db,{kind:'artifact',id}).artifact;if(!current)throw new Error('ARTIFACT_CORRUPT');
 if(c.kind==='seal'&&current.offsetBytes!==current.expectedBytes)throw new Error('INVALID_REQUEST');
 if(c.kind!=='discard'&&current.expiresAtMs!==null&&now()>=current.expiresAtMs)throw new Error('APPROVAL_STALE');
 const r=admit(a);if(r.operation.phase==='FINALIZED')return{operation:r.operation,artifact:current};
 const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(a.requestId) as FeatureRow;if(owner.owning_instance_id!==a.instanceId)throw new Error('BLOCKED');
 if(c.kind==='append'){const offset=artifacts.append(id,c.offset,c.bytes,c.sha256);return transaction(()=>{db.prepare('UPDATE workflow_artifacts SET offset_bytes=? WHERE artifact_id=?').run(offset,id);return{operation:complete(a.requestId,{artifactId:id,offsetBytes:offset}),artifact:readFeatureState(db,{kind:'artifact',id}).artifact!};});}
 if(c.kind==='seal'){artifacts.seal(id);return transaction(()=>{db.prepare("UPDATE workflow_artifacts SET state='SEALED',expires_at_ms=NULL WHERE artifact_id=? AND state='RESERVED'").run(id);return{operation:complete(a.requestId,{artifactId:id}),artifact:readFeatureState(db,{kind:'artifact',id}).artifact!};});}
 artifacts.discard(id);return transaction(()=>{db.prepare("UPDATE workflow_artifacts SET state='DISCARDED',allocated_bytes=0,expires_at_ms=NULL WHERE artifact_id=? AND ref_count=0").run(id);return{operation:complete(a.requestId,{artifactId:id}),artifact:readFeatureState(db,{kind:'artifact',id}).artifact!};},true);
 }
 return{admit,complete,transaction,intent,operation,
 commit(c:WorkflowChange):WorkflowWrite{
 if(c.kind==='grant'){const i=intent(c.grant.canonicalIntent);return transaction(()=>{const g=c.grant;requireUuid(g.grantId);if(i.namespace!=='FEATURE'||!['create','revise','archive','approve','handoff','generate','answer','cancel'].includes(i.action)||g.consumedByRequestId!==null||g.createdAtMs>now()||g.createdAtMs<now()-300000)throw new Error('APPROVAL_REQUIRED');validateWorkflowGrant(g,g.canonicalIntent,g.grantId,now());
 if(i.action==='cancel')db.prepare("DELETE FROM workflow_grants WHERE consumed_by_request_id IS NULL AND json_extract(canonical_intent,'$.action')='cancel'").run();
 const count=Number((db.prepare('SELECT count(*) AS n FROM workflow_grants WHERE consumed_by_request_id IS NULL AND expires_at_ms>?').get(now()) as FeatureRow).n);if(count>=(i.action==='cancel'?32:31))throw new Error('RESOURCE_LIMIT');
 db.prepare('INSERT INTO workflow_grants VALUES(?,?,?,?,NULL)').run(g.grantId,g.canonicalIntent,g.createdAtMs,g.expiresAtMs);return{};},i.action==='cancel');}
 if(c.kind==='admit')return admit(c.admission);
 if(c.kind==='complete')return transaction(()=>({operation:complete(c.requestId,c.result,c.error,c.outcome)}),true);
 if(c.kind==='reconcile')return transaction(()=>{requireUuid(c.instanceId);for(const row of db.prepare("SELECT * FROM workflow_operations WHERE phase<>'FINALIZED'").all() as FeatureRow[]){const op=workflowOperation(row);
 if(op.namespace==='FEATURE'&&['generate','answer','cancel'].includes(op.action))complete(op.requestId,null,'RESOURCE_IDENTITY_UNKNOWN','UNKNOWN');
 else { complete(op.requestId,null,'INTERRUPTED','INTERRUPTED');if(op.namespace==='ARTIFACT'){const i=JSON.parse(op.canonicalIntent) as WorkflowIntent;const id=i.action==='reserve'?op.requestId:i.payload.artifactId;if(typeof id==='string')db.prepare("UPDATE workflow_artifacts SET state='ORPHAN' WHERE artifact_id=? AND state='RESERVED' AND ref_count=0").run(id);}}}
 db.prepare("UPDATE features_records SET state='RECONCILING',state_revision=state_revision+1 WHERE feature_id IN (SELECT feature_id FROM features_turns WHERE phase IN ('ACCEPTED','RUNNING','RECONCILING'))").run();db.prepare("UPDATE features_turns SET phase='RECONCILING' WHERE phase IN ('ACCEPTED','RUNNING')").run();return{};},true);
 if(['reserve','append','seal','discard'].includes(c.kind))return executeUpload(c as UploadChange);
 throw new Error('UNSUPPORTED_VERSION');
 },
 };
}
