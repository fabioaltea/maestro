import type Database from 'better-sqlite3';
import type {WorkflowAdmission,WorkflowChange,WorkflowWrite,WorkflowOperationRecord} from '../ports/workflow.js';
import type {WorkflowIntent} from '../domain/workflow/authorization.js';
import type {FeatureRecord,FeatureRevision} from '../domain/features/model.js';
import {nextFeatureRevision,transitionFeature} from '../domain/features/model.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import type {WorkflowEventContext} from './workflow-store.js';
interface Ledger {
 intent(canonical:string):WorkflowIntent;admit(a:WorkflowAdmission):{operation:WorkflowOperationRecord;inserted:boolean};
 transaction<T>(body:()=>T,terminal?:boolean,event?:WorkflowEventContext):T;
 complete(id:string,result:Readonly<Record<string,unknown>>|null,error?:string|null,outcome?:'SUCCEEDED'|'FAILED'|'BLOCKED'|'INTERRUPTED'|'UNKNOWN'):WorkflowOperationRecord;
}
type Change=Extract<WorkflowChange,{kind:'create'|'revise'|'archive'}>;
function currentFeature(db:Database.Database,id:string):FeatureRecord{const f=readFeatureState(db,{kind:'feature',id}).feature;if(!f)throw new Error('FEATURE_NOT_FOUND');return f;}
function currentDiscovery(db:Database.Database,r:FeatureRevision,projectId:string,checkedAt:string){
 const at=Date.parse(checkedAt),now=Date.now();if(!Number.isFinite(at)||at>now||now-at>30000)throw new Error('CONTEXT_UNSTABLE');
 const project=db.prepare('SELECT config_revision,removed_at FROM projects WHERE project_id=?').get(projectId) as FeatureRow|undefined;
 if(!project||project.removed_at!==null)throw new Error('PROJECT_REMOVED');if(String(project.config_revision)!==r.configRevision)throw new Error('APPROVAL_STALE');
 const d=db.prepare('SELECT * FROM discoveries WHERE project_id=? ORDER BY created_at DESC,discovery_id DESC LIMIT 1').get(projectId) as FeatureRow|undefined;
 const approval=db.prepare('SELECT * FROM discovery_approvals WHERE approval_id=?').get(r.discoveryApprovalId) as FeatureRow|undefined;
 const provider=db.prepare('SELECT config_revision FROM discovery_provider WHERE singleton=1').get() as FeatureRow|undefined;
 if(!d||!approval||d.state!=='APPROVED'||d.latest_document_revision_id!==r.discoveryRevisionId||d.discovery_id!==approval.discovery_id||approval.project_id!==projectId
 ||approval.revision_id!==r.discoveryRevisionId||approval.context_digest!==r.contextDigest||String(approval.config_revision)!==r.configRevision||String(d.config_revision)!==r.configRevision
 ||!provider||String(provider.config_revision)!==String(d.provider_revision))throw new Error('APPROVAL_STALE');
}
export function commitFeatureAuthoring(db:Database.Database,c:Change,ledger:Ledger):WorkflowWrite{
 const i=ledger.intent(c.admission.canonicalIntent);if(i.namespace!=='FEATURE'||i.action!==c.kind)throw new Error('INVALID_REQUEST');
 const admitted=ledger.admit(c.admission);if(admitted.operation.phase==='FINALIZED')return{operation:admitted.operation};
 return ledger.transaction(()=>{
 const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(c.admission.requestId) as FeatureRow;
 const identity=db.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;
 if(owner.owning_instance_id!==c.admission.instanceId||identity.current_instance_id!==c.admission.instanceId)throw new Error('STALE_TARGET');
 if(c.kind==='archive'){
 if(i.targetId!==c.featureId||i.expectedRevision!==c.expectedRevision)throw new Error('APPROVAL_REQUIRED');const f=currentFeature(db,c.featureId);
 if(f.stateRevision!==c.expectedRevision)throw new Error('REVISION_CONFLICT');
 if(db.prepare("SELECT 1 FROM features_turns WHERE feature_id=? AND phase IN ('ACCEPTED','RUNNING','WAITING_USER','RECONCILING')").get(f.featureId))throw new Error('FEATURE_IN_USE');
 const state=transitionFeature(f.state,'archive'),revision=nextFeatureRevision(f.stateRevision),at=new Date().toISOString();
 db.prepare('UPDATE features_records SET state=?,state_revision=?,updated_at=?,archived_at=? WHERE feature_id=? AND state_revision=?').run(state,BigInt(revision),at,at,f.featureId,BigInt(f.stateRevision));
 return{operation:ledger.complete(c.admission.requestId,{featureId:f.featureId,stateRevision:revision}),feature:currentFeature(db,f.featureId)};
 }
 const f=c.feature,r=c.revision;
 if(i.targetId!==f.featureId||i.projectId!==f.projectId||i.configRevision!==r.configRevision||r.featureId!==f.featureId||f.currentRevisionId!==r.revisionId||r.revisionId!==i.payload.revisionId||r.artifactId!==i.payload.bundleArtifactId||r.bundleDigest!==i.payload.bundleDigest||f.title!==i.payload.title
 ||r.discoveryApprovalId!==i.payload.discoveryApprovalId||r.discoveryRevisionId!==i.payload.discoveryRevisionId||r.contextDigest!==i.payload.contextDigest||r.revisionNumber!==i.payload.revisionNumber||r.parentRevisionId!==i.payload.parentRevisionId)throw new Error('APPROVAL_STALE');
 currentDiscovery(db,r,f.projectId,c.contextCheckedAt);
 const a=readFeatureState(db,{kind:'artifact',id:r.artifactId}).artifact;if(!a||a.kind!=='BUNDLE'||!['SEALED','REFERENCED'].includes(a.state)||a.sha256!==r.bundleDigest||a.targetId!==null&&a.targetId!==f.featureId)throw new Error('ARTIFACT_CORRUPT');
 if(c.kind==='create'){
 if(i.expectedRevision!==null||f.state!=='DRAFT'||f.stateRevision!=='1'||r.revisionNumber!=='1'||r.parentRevisionId!==null||f.archivedAt!==null)throw new Error('INVALID_REQUEST');
 if(db.prepare('SELECT 1 FROM features_records WHERE feature_id=?').get(f.featureId))throw new Error('IDEMPOTENCY_CONFLICT');
 if(Number((db.prepare('SELECT count(*) AS n FROM features_records').get() as FeatureRow).n)>=1000)throw new Error('FEATURE_LIMIT');
 db.prepare('INSERT INTO features_records(feature_id,project_id,title,state,state_revision,current_revision_id,created_at,updated_at,archived_at) VALUES(?,?,?,?,?,?,?,?,NULL)').run(f.featureId,f.projectId,f.title,f.state,1,r.revisionId,f.createdAt,f.updatedAt);
 }else{
 const old=currentFeature(db,f.featureId),previous=readFeatureState(db,{kind:'revision',id:old.currentRevisionId}).revision;
 if(old.stateRevision!==i.expectedRevision)throw new Error('REVISION_CONFLICT');
 if(!previous||old.projectId!==f.projectId||old.createdAt!==f.createdAt||r.parentRevisionId!==old.currentRevisionId||r.revisionNumber!==nextFeatureRevision(previous.revisionNumber)||f.stateRevision!==nextFeatureRevision(old.stateRevision)||f.state!==transitionFeature(old.state,'revise')||f.archivedAt!==null)throw new Error('INVALID_TRANSITION');
 }
 db.prepare('INSERT INTO features_revisions(revision_id,feature_id,revision_number,parent_revision_id,artifact_id,bundle_digest,discovery_approval_id,discovery_revision_id,context_digest,config_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(r.revisionId,r.featureId,Number(r.revisionNumber),r.parentRevisionId,r.artifactId,r.bundleDigest,r.discoveryApprovalId,r.discoveryRevisionId,r.contextDigest,BigInt(r.configRevision),r.createdAt);
 if(c.kind==='revise')db.prepare('UPDATE features_records SET title=?,state=?,state_revision=?,current_revision_id=?,updated_at=? WHERE feature_id=? AND state_revision=?').run(f.title,f.state,BigInt(f.stateRevision),r.revisionId,f.updatedAt,f.featureId,BigInt(i.expectedRevision!));
 db.prepare("UPDATE workflow_artifacts SET ref_count=ref_count+1,state='REFERENCED',expires_at_ms=NULL WHERE artifact_id=?").run(r.artifactId);
 return{operation:ledger.complete(c.admission.requestId,{featureId:f.featureId,revisionId:r.revisionId,stateRevision:f.stateRevision}),feature:currentFeature(db,f.featureId),revision:readFeatureState(db,{kind:'revision',id:r.revisionId}).revision!};
 },false,{requestIds:[c.admission.requestId]});
}
