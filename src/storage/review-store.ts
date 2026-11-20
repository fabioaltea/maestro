import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {reviewOid,reviewTargetRef} from '../domain/review/state.js';
import type {ReviewChange,ReviewQuery,ReviewRead,ReviewRecord} from '../ports/review.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import type {createWorkflowStore} from './workflow-store.js';
import {REVIEW_SCHEMA_VERSION} from './review-schema.js';

function schema(db:Database.Database){
 if(Number(db.pragma('user_version',{simple:true}))<REVIEW_SCHEMA_VERSION)throw new Error('REVIEW_NOT_INITIALIZED');
}
function review(db:Database.Database,r:FeatureRow):ReviewRecord{
 const reviewId=String(r.review_id);
 const parts=(db.prepare('SELECT * FROM review_diff_parts WHERE review_id=? ORDER BY ordinal').all(reviewId) as FeatureRow[])
   .map(p=>({artifactId:String(p.artifact_id),sha256:String(p.sha256),bytes:Number(p.bytes)}));
 return{reviewId,projectId:String(r.project_id),featureId:String(r.feature_id),featureRevisionId:String(r.feature_revision_id),
   workspaceId:String(r.workspace_id),checkpointId:String(r.checkpoint_id),sourceOid:String(r.source_oid),sourceTreeOid:String(r.source_tree_oid),
   targetRef:String(r.target_ref),targetOid:String(r.target_oid),digest:String(r.digest),state:r.state as ReviewRecord['state'],
   stateRevision:String(r.state_revision),createdAt:String(r.created_at),fileCount:Number(r.file_count),diffBytes:Number(r.diff_bytes),parts};
}
export function readReviewState(db:Database.Database,q:ReviewQuery):ReviewRead{
 schema(db);
 if(q.kind==='review'){
   const row=db.prepare('SELECT * FROM review_records WHERE review_id=?').get(requireUuid(q.id)) as FeatureRow|undefined;
   return{review:row?review(db,row):null};
 }
 if(q.kind==='artifact'){
   const row=db.prepare(`SELECT p.sha256,p.bytes FROM review_diff_parts p JOIN workflow_artifacts a USING(artifact_id)
       WHERE p.artifact_id=? AND a.state='REFERENCED'`).get(requireUuid(q.id)) as FeatureRow|undefined;
   return{artifact:row?{sha256:String(row.sha256),bytes:Number(row.bytes)}:null};
 }
 if(q.kind!=='list')throw new Error('INVALID_REQUEST');
 const projectId=requireUuid(q.projectId),offset=q.offset??0,limit=q.limit??20;
 if(!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>20)throw new Error('INVALID_REQUEST');
 const rows=db.prepare('SELECT * FROM review_records WHERE project_id=? ORDER BY created_at DESC,review_id DESC LIMIT ? OFFSET ?')
   .all(projectId,limit+1,offset) as FeatureRow[];
 const rev=db.prepare('SELECT count(*) AS count,COALESCE(SUM(state_revision),0) AS revision FROM review_records WHERE project_id=?')
   .get(projectId) as FeatureRow;
 return{reviews:rows.slice(0,limit).map(r=>review(db,r)),revision:`${rev.count}:${rev.revision}`,nextOffset:rows.length>limit?offset+limit:null};
}

export function commitReviewState(db:Database.Database,c:ReviewChange,ledger:ReturnType<typeof createWorkflowStore>,verify:(id:string)=>void){
 schema(db);
 const a=c.admission,i=ledger.intent(a.canonicalIntent),p=i.payload;
 if(i.namespace!=='REVIEW'||i.action!==c.kind)throw new Error('INVALID_REQUEST');
 function artifact(id:string,kind:'BUNDLE'|'INPUT',target:string,expected?:{sha256:string;bytes:number}){
   const blob=readFeatureState(db,{kind:'artifact',id:requireUuid(id)}).artifact;
   if(!blob||blob.kind!==kind||blob.targetId!==target||!['SEALED','REFERENCED'].includes(blob.state)||
      expected&&(blob.expectedBytes!==expected.bytes||blob.sha256!==expected.sha256))throw new Error('ARTIFACT_CORRUPT');
   verify(id);
   db.prepare("UPDATE workflow_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(id);
 }
 return ledger.admit(a,()=>{
   const at=new Date().toISOString();
   if(c.kind==='create'){
     const r=c.snapshot;
     if(r.reviewId!==a.requestId||r.projectId!==i.projectId||r.featureId!==i.targetId||r.checkpointId!==p.checkpointId||
        r.workspaceId!==p.workspaceId||r.featureRevisionId!==p.featureRevisionId||r.targetRef!==p.targetRef||r.targetOid!==p.targetOid||
        r.sourceOid!==p.sourceOid||r.sourceTreeOid!==p.sourceTreeOid||r.digest!==p.digest||r.fileCount!==p.fileCount||r.diffBytes!==p.diffBytes||
        r.state!=='DRAFT'||r.stateRevision!=='1')throw new Error('INVALID_REQUEST');
     reviewTargetRef(r.targetRef);reviewOid(r.targetOid);reviewOid(r.sourceOid);reviewOid(r.sourceTreeOid);
     if(!db.prepare(`SELECT 1 FROM execution_checkpoints c JOIN execution_sessions s USING(session_id)
        JOIN execution_runs r ON r.run_id=c.run_id JOIN workspaces_records w USING(workspace_id)
        JOIN features_records f ON f.feature_id=s.feature_id JOIN projects p ON p.project_id=s.project_id
        WHERE c.checkpoint_id=? AND c.checkpoint_id=s.checkpoint_id AND s.run_id=c.run_id AND r.phase='FINALIZED' AND json_extract(r.proof,'$.verified')=1
        AND s.state IN ('READY_FOR_REVIEW','PAUSED','INTERRUPTED') AND f.feature_id=? AND p.project_id=? AND p.removed_at IS NULL
        AND w.workspace_id=? AND w.purpose='FEATURE' AND w.state='READY' AND w.state_revision=?
        AND p.config_revision=? AND f.state='APPROVED' AND f.current_revision_id=? AND f.state_revision=?
        AND NOT EXISTS(SELECT 1 FROM workspaces_leases l WHERE l.workspace_id=w.workspace_id AND l.released_at IS NULL)`)
       .get(r.checkpointId,r.featureId,r.projectId,r.workspaceId,BigInt(String(p.workspaceRevision)),BigInt(i.configRevision!),
         r.featureRevisionId,BigInt(i.expectedRevision!)))throw new Error('REVIEW_STALE');
     if(r.parts.length>8||r.parts.reduce((sum,part)=>sum+part.bytes,0)!==r.diffBytes)throw new Error('REVIEW_SCOPE_LIMIT');
     db.prepare(`INSERT INTO review_records VALUES(?,?,?,?,?,?,?,?,?,?,?,'DRAFT',1,?,?,?)`)
       .run(r.reviewId,r.projectId,r.featureId,r.featureRevisionId,r.workspaceId,r.checkpointId,r.sourceOid,r.sourceTreeOid,r.targetRef,
         r.targetOid,r.digest,at,r.fileCount,r.diffBytes);
     for(const [ordinal,part] of r.parts.entries()){
       artifact(part.artifactId,'BUNDLE',r.featureId,part);
       db.prepare('INSERT INTO review_diff_parts VALUES(?,?,?,?,?)').run(r.reviewId,ordinal,part.artifactId,part.sha256,part.bytes);
     }
     ledger.complete(a.requestId,{reviewId:r.reviewId,digest:r.digest,stateRevision:'1'});
   }else{
     const {review:r}=readReviewState(db,{kind:'review',id:requireUuid(i.targetId)});
     if(!r||r.projectId!==i.projectId||r.stateRevision!==i.expectedRevision||r.digest!==p.digest||
        ['STALE','APPROVED'].includes(r.state))throw new Error('REVIEW_STALE');
     const blob=requireUuid(p.feedbackArtifactId);
     artifact(blob,'INPUT',r.featureId);
     db.prepare("INSERT INTO review_decisions VALUES(?,?,NULL,?,'REQUEST_CHANGES',?,?)").run(a.requestId,r.reviewId,r.digest,blob,at);
     db.prepare("UPDATE review_records SET state='CHANGES_REQUESTED',state_revision=state_revision+1 WHERE review_id=? AND state_revision=?")
       .run(r.reviewId,BigInt(r.stateRevision));
     ledger.complete(a.requestId,{reviewId:r.reviewId,decisionId:a.requestId,stateRevision:String(BigInt(r.stateRevision)+1n)});
   }
 });
}
