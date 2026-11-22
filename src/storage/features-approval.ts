import {createHash} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {WorkflowChange,WorkflowWrite} from '../ports/workflow.js';
import {currentFeature,currentDiscovery,type FeatureLedger} from './features-authoring.js';
import {readFeatureState,type FeatureRow} from './features-store.js';
import {nextFeatureRevision,transitionFeature} from '../domain/features/model.js';
import {requireCurrentFeatureApproval,envelopeContent} from '../domain/features/approval.js';
export function commitFeatureApproval(db:Database.Database,c:Extract<WorkflowChange,{kind:'approve'|'handoff'}>,ledger:FeatureLedger):WorkflowWrite{
 const i=ledger.intent(c.admission.canonicalIntent);if(i.namespace!=='FEATURE'||i.action!==c.kind||i.expectedRevision!==c.expectedRevision)throw new Error('APPROVAL_REQUIRED');const admitted=ledger.admit(c.admission);if(admitted.operation.phase==='FINALIZED')return{operation:admitted.operation};
 return ledger.transaction(()=>{
 const owner=db.prepare('SELECT owning_instance_id FROM workflow_operations WHERE request_id=?').get(c.admission.requestId) as FeatureRow,identity=db.prepare('SELECT current_instance_id FROM store WHERE singleton=1').get() as FeatureRow;if(owner.owning_instance_id!==c.admission.instanceId||identity.current_instance_id!==c.admission.instanceId)throw new Error('STALE_TARGET');
 const f=currentFeature(db,i.targetId!),r=readFeatureState(db,{kind:'revision',id:i.payload.revisionId as string}).revision;
 if(f.stateRevision!==c.expectedRevision)throw new Error('REVISION_CONFLICT');if(!r||r.featureId!==f.featureId||f.currentRevisionId!==r.revisionId||i.projectId!==f.projectId||i.configRevision!==r.configRevision||i.payload.bundleDigest!==r.bundleDigest||i.payload.discoveryApprovalId!==r.discoveryApprovalId||i.payload.discoveryRevisionId!==r.discoveryRevisionId||i.payload.contextDigest!==r.contextDigest)throw new Error('APPROVAL_STALE');
 currentDiscovery(db,r,f.projectId,c.contextCheckedAt);const artifact=readFeatureState(db,{kind:'artifact',id:r.artifactId}).artifact;if(!artifact||artifact.state!=='REFERENCED'||artifact.sha256!==r.bundleDigest)throw new Error('ARTIFACT_CORRUPT');
 if(c.kind==='approve'){
 const a=c.approval;if(a.approvalId!==i.payload.approvalId||a.requestId!==c.admission.requestId||a.featureId!==f.featureId||a.revisionId!==r.revisionId||a.bundleDigest!==r.bundleDigest||a.discoveryApprovalId!==r.discoveryApprovalId||a.contextDigest!==r.contextDigest||a.configRevision!==r.configRevision||a.ownerUid!==i.ownerUid||JSON.stringify(a.acceptedUnknownIds)!==JSON.stringify(i.payload.acceptedUnknownIds)||JSON.stringify(c.acceptedUnknownIds)!==JSON.stringify(a.acceptedUnknownIds))throw new Error('APPROVAL_REQUIRED');
 const state=transitionFeature(f.state,'approve'),stateRevision=nextFeatureRevision(f.stateRevision);
 db.prepare('INSERT INTO features_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(a.approvalId,a.requestId,a.featureId,a.revisionId,a.bundleDigest,a.discoveryApprovalId,a.contextDigest,BigInt(a.configRevision),JSON.stringify(a.acceptedUnknownIds),a.ownerUid,a.approvedAt);
 db.prepare('UPDATE features_records SET state=?,state_revision=?,updated_at=? WHERE feature_id=? AND state_revision=?').run(state,BigInt(stateRevision),a.approvedAt,f.featureId,BigInt(f.stateRevision));
 return{operation:ledger.complete(c.admission.requestId,{featureId:f.featureId,revisionId:r.revisionId,approvalId:a.approvalId,stateRevision}),feature:currentFeature(db,f.featureId),approval:a};
 }
 const a=readFeatureState(db,{kind:'approval',id:r.revisionId}).approval??null;requireCurrentFeatureApproval(f,r,a,{projectId:f.projectId,configRevision:r.configRevision,discoveryApprovalId:r.discoveryApprovalId,discoveryRevisionId:r.discoveryRevisionId,contextDigest:r.contextDigest,checkedAt:c.contextCheckedAt},i.ownerUid);
 const e=c.envelope,content=envelopeContent(f,r,a);if(e.envelopeId!==i.payload.envelopeId||e.approvalId!==i.payload.approvalId||Object.entries(content).some(([k,v])=>e[k as keyof typeof e]!==v)||e.digest!==createHash('sha256').update(JSON.stringify(content)).digest('hex'))throw new Error('APPROVAL_STALE');
 db.prepare('INSERT INTO features_envelopes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(e.envelopeId,e.featureId,e.revisionId,e.approvalId,e.projectId,BigInt(e.configRevision),e.discoveryApprovalId,e.contextDigest,e.bundleDigest,e.digest,e.createdAt);
 return{operation:ledger.complete(c.admission.requestId,{featureId:f.featureId,revisionId:r.revisionId,approvalId:a.approvalId,envelopeId:e.envelopeId,stateRevision:f.stateRevision}),envelope:e};
 },false,{requestIds:[c.admission.requestId]});
}
