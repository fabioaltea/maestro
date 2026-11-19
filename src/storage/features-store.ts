import type Database from 'better-sqlite3';
import type {FeatureQuery,FeatureRead,WorkflowArtifact,WorkflowOperationRecord} from '../ports/workflow.js';
import type {FeatureRecord,FeatureRevision,FeatureApproval,ImplementationEnvelope} from '../domain/features/model.js';
import type {WorkflowGrant} from '../domain/workflow/authorization.js';
import {requireUuid} from '../domain/identifiers.js';
export type FeatureRow=Record<string,string|number|bigint|null>;
const s=(r:FeatureRow,k:string)=>String(r[k]);const nullable=(r:FeatureRow,k:string)=>r[k]===null?null:s(r,k);
export const featureRecord=(r:FeatureRow):FeatureRecord=>({featureId:s(r,'feature_id'),projectId:s(r,'project_id'),title:s(r,'title'),state:r.state as FeatureRecord['state'],stateRevision:s(r,'state_revision'),currentRevisionId:s(r,'current_revision_id'),createdAt:s(r,'created_at'),updatedAt:s(r,'updated_at'),archivedAt:nullable(r,'archived_at')});
export const featureRevision=(r:FeatureRow):FeatureRevision=>({revisionId:s(r,'revision_id'),featureId:s(r,'feature_id'),revisionNumber:s(r,'revision_number'),parentRevisionId:nullable(r,'parent_revision_id'),artifactId:s(r,'artifact_id'),bundleDigest:s(r,'bundle_digest'),discoveryApprovalId:s(r,'discovery_approval_id'),discoveryRevisionId:s(r,'discovery_revision_id'),contextDigest:s(r,'context_digest'),configRevision:s(r,'config_revision'),createdAt:s(r,'created_at')});
export const featureApproval=(r:FeatureRow):FeatureApproval=>({approvalId:s(r,'approval_id'),requestId:s(r,'request_id'),featureId:s(r,'feature_id'),revisionId:s(r,'revision_id'),bundleDigest:s(r,'bundle_digest'),discoveryApprovalId:s(r,'discovery_approval_id'),contextDigest:s(r,'context_digest'),configRevision:s(r,'config_revision'),acceptedUnknownIds:JSON.parse(s(r,'accepted_unknown_ids')) as string[],ownerUid:Number(r.owner_uid),approvedAt:s(r,'approved_at')});
export const featureEnvelope=(r:FeatureRow):ImplementationEnvelope=>({envelopeId:s(r,'envelope_id'),featureId:s(r,'feature_id'),revisionId:s(r,'revision_id'),approvalId:s(r,'approval_id'),projectId:s(r,'project_id'),configRevision:s(r,'config_revision'),discoveryApprovalId:s(r,'discovery_approval_id'),contextDigest:s(r,'context_digest'),bundleDigest:s(r,'bundle_digest'),digest:s(r,'digest'),createdAt:s(r,'created_at')});
export const workflowOperation=(r:FeatureRow):WorkflowOperationRecord=>({requestId:s(r,'request_id'),namespace:r.namespace as WorkflowOperationRecord['namespace'],action:s(r,'action'),canonicalIntent:s(r,'canonical_intent'),payloadHash:s(r,'payload_hash'),targetId:nullable(r,'target_id'),phase:r.phase as WorkflowOperationRecord['phase'],outcome:r.outcome as WorkflowOperationRecord['outcome'],acceptedAt:s(r,'accepted_at'),completedAt:nullable(r,'completed_at'),result:r.result===null?null:JSON.parse(s(r,'result')) as Record<string,unknown>,error:nullable(r,'error')});
export const workflowArtifact=(r:FeatureRow):WorkflowArtifact=>({artifactId:s(r,'artifact_id'),kind:r.kind as WorkflowArtifact['kind'],targetId:nullable(r,'target_id'),expectedBytes:Number(r.expected_bytes),sha256:s(r,'sha256'),offsetBytes:Number(r.offset_bytes),allocatedBytes:Number(r.allocated_bytes),state:r.state as WorkflowArtifact['state'],referenceCount:Number(r.ref_count),createdAtMs:Number(r.created_at_ms),expiresAtMs:r.expires_at_ms===null?null:Number(r.expires_at_ms)});
export function requireFeatureSchema(db:Database.Database):void {if(Number(db.pragma('user_version',{simple:true}))!==5)throw new Error('FEATURE_NOT_INITIALIZED');}
export function readFeatureState(db:Database.Database,q:FeatureQuery):FeatureRead {
 requireFeatureSchema(db);
 if(q.kind==='budget'){
 const row=db.prepare("SELECT coalesce(sum(CASE WHEN state<>'RESERVED' THEN allocated_bytes ELSE 0 END),0) AS allocated,coalesce(sum(CASE WHEN state='RESERVED' THEN allocated_bytes ELSE 0 END),0) AS reserved,count(*) AS files,coalesce(sum(CASE WHEN state='RESERVED' THEN 1 ELSE 0 END),0) AS uploads FROM workflow_artifacts WHERE state<>'DISCARDED'").get() as FeatureRow;
 const metadata=Number((db.prepare('SELECT metadata_bytes FROM workflow_budget WHERE singleton=1').get() as FeatureRow).metadata_bytes);
 return{budget:{allocatedBytes:Number(row.allocated),reservedBytes:Number(row.reserved),allocatedFiles:Number(row.files),openUploads:Number(row.uploads),metadataBytes:metadata}};
 }
 if(q.kind==='pending')return{items:(db.prepare("SELECT * FROM workflow_operations WHERE phase<>'FINALIZED' ORDER BY accepted_at LIMIT 20").all() as FeatureRow[]).map(workflowOperation)};
 requireUuid(q.id);
 const singles:Record<string,[string,string,(r:FeatureRow)=>unknown]>={feature:['features_records','feature_id',featureRecord],revision:['features_revisions','revision_id',featureRevision],approval:['features_approvals','revision_id',featureApproval],envelope:['features_envelopes','envelope_id',featureEnvelope],operation:['workflow_operations','request_id',workflowOperation],artifact:['workflow_artifacts','artifact_id',workflowArtifact],
 grant:['workflow_grants','grant_id',r=>({grantId:s(r,'grant_id'),canonicalIntent:s(r,'canonical_intent'),createdAtMs:Number(r.created_at_ms),expiresAtMs:Number(r.expires_at_ms),consumedByRequestId:nullable(r,'consumed_by_request_id')} satisfies WorkflowGrant)],turn:['features_turns','turn_id',r=>({...r,metadata:JSON.parse(s(r,'metadata'))})]};
 const single=singles[q.kind];if(single){const [table,key,map]=single;const row=db.prepare(`SELECT * FROM ${table} WHERE ${key}=? ORDER BY rowid DESC LIMIT 1`).get(q.id) as FeatureRow|undefined;return{[q.kind]:row?map(row):null};}
 if(!['features','revisions','approvals','turns'].includes(q.kind))throw new Error('INVALID_REQUEST');
 const paged=q as Extract<FeatureQuery,{offset?:number}>;const offset=paged.offset??0,limit=paged.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const [table,key,map]:[string,string,(r:FeatureRow)=>unknown]=q.kind==='features'?['features_records','project_id',featureRecord]:q.kind==='revisions'?['features_revisions','feature_id',featureRevision]:q.kind==='approvals'?['features_approvals','feature_id',featureApproval]:['features_turns','feature_id',r=>({...r,metadata:JSON.parse(s(r,'metadata'))})];
 const rows=db.prepare(`SELECT * FROM ${table} WHERE ${key}=? ORDER BY rowid LIMIT ? OFFSET ?`).all(q.id,limit+1,offset) as FeatureRow[];
 const items=rows.slice(0,limit).map(map);if(Buffer.byteLength(JSON.stringify(items))>28000)throw new Error('CONTEXT_LIMIT');
 return{items,nextOffset:rows.length>limit?offset+limit:null};
}
