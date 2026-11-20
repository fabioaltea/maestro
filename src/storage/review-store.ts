import type Database from 'better-sqlite3';
import {requireUuid} from '../domain/identifiers.js';
import {reviewOid,reviewTargetRef} from '../domain/review/state.js';
import {reviewCheckStatus} from '../domain/review/model.js';
import type {ReviewChange,ReviewEvidence,ReviewQuery,ReviewRead,ReviewRecord,ReviewRecovery,ReviewValidationScope} from '../ports/review.js';
import {readFeatureState,workflowOperation,type FeatureRow} from './features-store.js';
import type {createWorkflowStore} from './workflow-store.js';
import {REVIEW_SCHEMA_VERSION} from './review-schema.js';
import {readEnvironmentState} from './environments-store.js';

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
 if(q.kind==='pending-snapshots'||q.kind==='pending-validation'){
   const actions=q.kind==='pending-snapshots'?"('create','request-changes')":"('validate')";
   const rows=db.prepare(`SELECT * FROM workflow_operations WHERE namespace='REVIEW'
     AND action IN ${actions} AND phase<>'FINALIZED' ORDER BY accepted_at,request_id LIMIT 32`).all() as FeatureRow[];
   return{operations:rows.map(workflowOperation)};
 }
 if(q.kind==='review'){
   const row=db.prepare('SELECT * FROM review_records WHERE review_id=?').get(requireUuid(q.id)) as FeatureRow|undefined;
   return{review:row?review(db,row):null};
 }
 if(q.kind==='artifact'){
   const row=db.prepare(`SELECT sha256,expected_bytes AS bytes FROM workflow_artifacts
       WHERE artifact_id=? AND state='REFERENCED' AND (EXISTS(SELECT 1 FROM review_diff_parts p WHERE p.artifact_id=workflow_artifacts.artifact_id)
          OR EXISTS(SELECT 1 FROM review_evidence e WHERE e.output_id=workflow_artifacts.artifact_id))`).get(requireUuid(q.id)) as FeatureRow|undefined;
   return{artifact:row?{sha256:String(row.sha256),bytes:Number(row.bytes)}:null};
 }
 if(q.kind==='evidence'){
   const rows=db.prepare(`SELECT e.* FROM (SELECT canonical_intent FROM workflow_operations
       WHERE namespace='REVIEW' AND action='validate' AND target_id=? AND phase='FINALIZED'
       ORDER BY completed_at DESC,rowid DESC LIMIT 1) o
       JOIN json_each(o.canonical_intent,'$.payload.criteria') i
       JOIN review_evidence e ON e.evidence_id=json_extract(i.value,'$.proofId')`).all(requireUuid(q.id)) as FeatureRow[];
   return{evidence:rows.map(r=>({criterionId:String(r.criterion_id),jobId:r.job_id as string|null,commandDigest:String(r.command_digest),
     treeOid:String(r.input_tree_oid),status:r.status as ReviewEvidence['status'],outputId:r.output_id as string|null,checkedAt:String(r.checked_at)}))};
 }
 if(q.kind==='feedback'){
   const row=db.prepare(`SELECT d.decision_id,d.feedback_artifact_id,r.feature_id,r.feature_revision_id,r.workspace_id,
      r.state_revision,c.tree_digest FROM review_decisions d JOIN review_records r USING(review_id)
      JOIN execution_checkpoints c USING(checkpoint_id)
      WHERE d.decision_id=? AND r.state='CHANGES_REQUESTED' AND d.review_digest=r.digest
      AND d.decision_id=(SELECT last.decision_id FROM review_decisions last WHERE last.review_id=r.review_id AND last.kind='REQUEST_CHANGES'
        ORDER BY last.created_at DESC,last.rowid DESC LIMIT 1)`).get(requireUuid(q.id)) as FeatureRow|undefined;
   return{feedback:row?{decisionId:String(row.decision_id),artifactId:String(row.feedback_artifact_id),featureId:String(row.feature_id),
     featureRevisionId:String(row.feature_revision_id),workspaceId:String(row.workspace_id),checkpointTreeDigest:String(row.tree_digest),
     stateRevision:String(row.state_revision)}:null};
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

function requireReviewOwner(db:Database.Database,instanceId:string,lifecycle:'RUNNING'|'RECOVERING'|'SETTLING'){
 const row=db.prepare(`SELECT i.lifecycle FROM store s JOIN instances i ON i.instance_id=s.current_instance_id
   WHERE s.singleton=1 AND i.instance_id=?`).get(instanceId) as FeatureRow|undefined;
 if(!row||(lifecycle==='SETTLING'?row.lifecycle!=='RUNNING'&&row.lifecycle!=='STOPPING':row.lifecycle!==lifecycle))throw new Error('STALE_TARGET');
}

function validateResult(db:Database.Database,c:Extract<ReviewChange,{kind:'validate-finish'}>,ledger:ReturnType<typeof createWorkflowStore>,verify:(id:string)=>void){
 const operation=ledger.operation(c.requestId);
 if(!operation||operation.namespace!=='REVIEW'||operation.action!=='validate')throw new Error('OPERATION_NOT_FOUND');
 if(operation.phase==='FINALIZED')return{operation,inserted:false};
 const intent=ledger.intent(operation.canonicalIntent),p=intent.payload as unknown as ReviewValidationScope,reviewId=requireUuid(intent.targetId);
 return ledger.transaction(()=>{
   requireReviewOwner(db,c.instanceId,c.recovering?'RECOVERING':'SETTLING');
   if((p.instanceId===c.instanceId)===!!c.recovering)throw new Error('STALE_TARGET');
   const {review:r}=readReviewState(db,{kind:'review',id:reviewId});
   if(!r||r.state!=='CHECKING'||r.stateRevision!==operation.result?.stateRevision||r.digest!==p.reviewDigest)throw new Error('REVIEW_STALE');
   const jobs=p.checks.map(check=>{
     const child=ledger.operation(check.jobId);
     if(child){
       const {payload}=ledger.intent(child.canonicalIntent);
       if(child.namespace!=='ENVIRONMENT'||child.action!=='validate'||child.targetId!==r.workspaceId||payload.treeDigest!==check.treeDigest||
          payload.delegatedJobId!==check.jobId||payload.planDigest!==check.planDigest||payload.planId!==check.planId||
          payload.commandSpecId!==check.commandSpecId||payload.inputDigest!==check.inputDigest)throw new Error('IDEMPOTENCY_CONFLICT');
     }
     return{check,job:child?readEnvironmentState(db,{kind:'job',id:check.jobId}).job??null:null};
   });
   if(jobs.some(({job})=>job&&!job.completedAt))return{operation:ledger.complete(c.requestId,operation.result,'JOB_RECONCILING','UNKNOWN'),inserted:false};
   const current=c.treeCurrent&&!!db.prepare(`SELECT 1 FROM features_records f JOIN projects p USING(project_id)
     WHERE f.feature_id=? AND f.state='APPROVED' AND f.current_revision_id=? AND p.config_revision=? AND p.removed_at IS NULL`)
     .get(r.featureId,r.featureRevisionId,BigInt(intent.configRevision!));
   const at=new Date().toISOString();
   const results=jobs.map(({check,job})=>{
     let status=reviewCheckStatus({...check,treeOid:p.treeOid},job,current?r.sourceTreeOid:null);
     const outputId=job?readEnvironmentState(db,{kind:'output',id:job.jobId,limit:1}).chunks?.[0]?.artifactId??null:null;
     if(outputId){try{verify(outputId);}catch{status='BLOCKED';}}
     else if(status==='PASS')status='BLOCKED';
     return{check,job,status,outputId};
   });
   const statuses=p.criteria.map(criterion=>{
     const match=results.find(({check})=>check.commandSpecId===criterion.commandSpecId);
     if(!match)return{required:criterion.required,status:'NOT_RUN'};
     const {check,job,status,outputId}=match;
     db.prepare('INSERT INTO review_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(requireUuid(criterion.proofId),reviewId,criterion.criterionId,
       job?.jobId??null,p.treeOid,check.commandDigest,status,outputId,at);
     return{required:criterion.required,status};
   });
   const requiredPassed=results.length>0&&results.every(item=>item.status==='PASS')&&statuses.every(item=>!item.required||item.status==='PASS');
   const state=!current?'STALE':requiredPassed?'READY_FOR_APPROVAL':'BLOCKED';
   const stateRevision=String(BigInt(r.stateRevision)+1n);
   db.prepare('UPDATE review_records SET state=?,state_revision=? WHERE review_id=?').run(state,BigInt(stateRevision),reviewId);
   const failure=!current?'REVIEW_STALE':results.some(item=>item.status==='FAIL')?'CHECKS_FAILED':requiredPassed?null:'CHECKS_NOT_RUN';
   return{operation:ledger.complete(c.requestId,{...operation.result,reviewId,stateRevision},failure,failure?'BLOCKED':'SUCCEEDED'),inserted:false};
 },true,{requestIds:[c.requestId]});
}

export function commitReviewState(db:Database.Database,c:ReviewChange|ReviewRecovery,ledger:ReturnType<typeof createWorkflowStore>,verify:(id:string)=>void){
 schema(db);
 if(c.kind==='validate-finish')return validateResult(db,c,ledger,verify);
 if(c.kind==='recover-snapshot'){
   requireReviewOwner(db,c.instanceId,'RECOVERING');
   const operation=ledger.operation(c.requestId);
   if(!operation||operation.namespace!=='REVIEW'||!['create','request-changes'].includes(operation.action))throw new Error('OPERATION_NOT_FOUND');
   if(operation.phase==='FINALIZED')return{operation,inserted:false};
   // Snapshot records and decisions commit with the terminal ledger update.
   return ledger.transaction(()=>({operation:ledger.complete(c.requestId,null,'INTERRUPTED','INTERRUPTED'),inserted:false}),true,{requestIds:[c.requestId]});
 }
 const a=c.admission,i=ledger.intent(a.canonicalIntent),p=i.payload;
 if(i.namespace!=='REVIEW'||i.action!==(c.kind==='validate-admit'?'validate':c.kind))throw new Error('INVALID_REQUEST');
 function artifact(id:string,kind:'BUNDLE'|'INPUT',target:string,expected?:{sha256:string;bytes:number}){
   const blob=readFeatureState(db,{kind:'artifact',id:requireUuid(id)}).artifact;
   if(!blob||blob.kind!==kind||blob.targetId!==target||!['SEALED','REFERENCED'].includes(blob.state)||
      expected&&(blob.expectedBytes!==expected.bytes||blob.sha256!==expected.sha256))throw new Error('ARTIFACT_CORRUPT');
   verify(id);
   db.prepare("UPDATE workflow_artifacts SET state='REFERENCED',ref_count=ref_count+1 WHERE artifact_id=?").run(id);
 }
 return ledger.admit(a,()=>{
   requireReviewOwner(db,a.instanceId,'RUNNING');
   if(p.instanceId!==a.instanceId)throw new Error('APPROVAL_STALE');
   const at=new Date().toISOString();
   if(c.kind==='validate-admit'){
     const scope=p as unknown as ReviewValidationScope;
     const {review:r}=readReviewState(db,{kind:'review',id:requireUuid(i.targetId)});
     if(!r||r.projectId!==i.projectId||r.stateRevision!==i.expectedRevision||r.digest!==scope.reviewDigest||
        r.sourceTreeOid!==scope.treeOid||!['DRAFT','READY_FOR_APPROVAL','BLOCKED'].includes(r.state))throw new Error('REVIEW_STALE');
     if(!db.prepare(`SELECT 1 FROM workspaces_records w JOIN features_records f USING(feature_id) JOIN projects p ON p.project_id=f.project_id
        WHERE w.workspace_id=? AND w.state='READY' AND w.state_revision=? AND f.state='APPROVED' AND f.current_revision_id=?
        AND p.config_revision=? AND p.removed_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM workspaces_leases l WHERE l.workspace_id=w.workspace_id AND l.released_at IS NULL)`)
       .get(r.workspaceId,BigInt(scope.workspaceRevision),r.featureRevisionId,BigInt(i.configRevision!)))throw new Error('REVIEW_STALE');
     const {environment}=readEnvironmentState(db,{kind:'workspace',id:r.workspaceId});
     if(!environment?.currentPlanId||environment.state!=='READY')throw new Error('ENVIRONMENT_STALE');
     const {plan}=readEnvironmentState(db,{kind:'plan',id:environment.currentPlanId});
     if(!plan||!scope.checks.length||scope.checks.some(check=>check.workspaceId!==r.workspaceId||check.inputDigest!==plan.inputDigest||
        check.planId!==plan.planId||check.planDigest!==plan.digest||!plan.metadata.commands?.some(spec=>spec.id===check.commandSpecId&&spec.sha256===check.commandDigest)))
       throw new Error('ENVIRONMENT_STALE');
     const revision=String(BigInt(r.stateRevision)+1n);
     const result=JSON.stringify({reviewId:r.reviewId,jobIds:scope.checks.map(check=>check.jobId),stateRevision:revision});
     db.prepare("UPDATE review_records SET state='CHECKING',state_revision=? WHERE review_id=?").run(BigInt(revision),r.reviewId);
     db.prepare("UPDATE workflow_operations SET phase='WORKING',result=? WHERE request_id=?").run(result,a.requestId);
     return;
   }
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
     if(!Array.isArray(p.partDescriptors)||p.partDescriptors.length!==r.parts.length||
        r.parts.some((part,index)=>{
          const expected=(p.partDescriptors as {sha256:string;bytes:number}[])[index];
          return part.sha256!==expected?.sha256||part.bytes!==expected?.bytes;
        }))
       throw new Error('REVIEW_STALE');
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
        ['CHECKING','STALE','APPROVED'].includes(r.state))throw new Error('REVIEW_STALE');
     const blob=requireUuid(p.feedbackArtifactId);
     artifact(blob,'INPUT',r.featureId);
     db.prepare("INSERT INTO review_decisions VALUES(?,?,NULL,?,'REQUEST_CHANGES',?,?)").run(a.requestId,r.reviewId,r.digest,blob,at);
     db.prepare("UPDATE review_records SET state='CHANGES_REQUESTED',state_revision=state_revision+1 WHERE review_id=? AND state_revision=?")
       .run(r.reviewId,BigInt(r.stateRevision));
     ledger.complete(a.requestId,{reviewId:r.reviewId,decisionId:a.requestId,stateRevision:String(BigInt(r.stateRevision)+1n)});
   }
 });
}
