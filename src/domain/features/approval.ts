import type {FeatureRecord,FeatureRevision,FeatureApproval} from './model.js';
import {requireFeatureContext} from './model.js';
import type {FeatureContextProof} from '../../ports/feature.js';
/** This tuple identifies a decision; it confers no runtime, Git or remote permissions. */
export function envelopeContent(f:FeatureRecord,r:FeatureRevision,a:FeatureApproval){return{featureId:f.featureId,revisionId:r.revisionId,approvalId:a.approvalId,projectId:f.projectId,configRevision:r.configRevision,discoveryApprovalId:r.discoveryApprovalId,contextDigest:r.contextDigest,bundleDigest:r.bundleDigest};}
export function requireCurrentFeatureApproval(f:FeatureRecord,r:FeatureRevision,a:FeatureApproval|null,proof:FeatureContextProof,ownerUid:number):asserts a is FeatureApproval{
 requireFeatureContext(proof,f.projectId,r.configRevision);
 if(f.state!=='APPROVED'||f.currentRevisionId!==r.revisionId||r.featureId!==f.featureId||!a||a.featureId!==f.featureId||a.revisionId!==r.revisionId||a.ownerUid!==ownerUid||a.bundleDigest!==r.bundleDigest||a.discoveryApprovalId!==r.discoveryApprovalId||a.contextDigest!==r.contextDigest||a.configRevision!==r.configRevision||r.discoveryApprovalId!==proof.discoveryApprovalId||r.discoveryRevisionId!==proof.discoveryRevisionId||r.contextDigest!==proof.contextDigest)throw new Error('APPROVAL_STALE');
}
