export const FEATURE_STATES = ['DRAFT','PLANNING','WAITING_USER','READY_FOR_APPROVAL','APPROVED','NEEDS_REVIEW','ARCHIVED','INTERRUPTED','RECONCILING'] as const;
import type {FeatureContextProof} from '../../ports/feature.js';
import { requireUuid,requireDecimal } from '../identifiers.js';
export type FeatureState = 'DRAFT'|'PLANNING'|'WAITING_USER'|'READY_FOR_APPROVAL'|'APPROVED'|'NEEDS_REVIEW'|'ARCHIVED'|'INTERRUPTED'|'RECONCILING';
export interface FeatureRecord {
 readonly featureId:string;readonly projectId:string;readonly title:string;readonly state:FeatureState;readonly stateRevision:string;
 readonly currentRevisionId:string;readonly createdAt:string;readonly updatedAt:string;readonly archivedAt:string|null;
}
export interface FeatureRevision {
 readonly revisionId:string;readonly featureId:string;readonly revisionNumber:string;readonly parentRevisionId:string|null;
 readonly artifactId:string;readonly bundleDigest:string;readonly discoveryApprovalId:string;readonly discoveryRevisionId:string;
 readonly contextDigest:string;readonly configRevision:string;readonly createdAt:string;
}
export interface FeatureApproval {
 readonly approvalId:string;readonly requestId:string;readonly featureId:string;readonly revisionId:string;readonly bundleDigest:string;
 readonly discoveryApprovalId:string;readonly contextDigest:string;readonly configRevision:string;readonly acceptedUnknownIds:readonly string[];readonly ownerUid:number;readonly approvedAt:string;
}
export interface ImplementationEnvelope {
 readonly envelopeId:string;readonly featureId:string;readonly revisionId:string;readonly approvalId:string;readonly projectId:string;
 readonly configRevision:string;readonly discoveryApprovalId:string;readonly contextDigest:string;readonly bundleDigest:string;readonly digest:string;readonly createdAt:string;
}
export function nextFeatureRevision(value:string):string {
 requireDecimal(value);if(value==='0'||BigInt(value)>=9223372036854775807n)throw new Error('REVISION_CONFLICT');return String(BigInt(value)+1n);
}
export function transitionFeature(from:FeatureState,action:'revise'|'approve'|'stale'|'archive'|'plan'|'question'|'draft'|'interrupt'|'uncertain'):FeatureState {
 if(from==='ARCHIVED')throw new Error('INVALID_TRANSITION');
 if(action==='revise'&& !['PLANNING','RECONCILING'].includes(from))return from==='DRAFT'?'DRAFT':'NEEDS_REVIEW';
 if(action==='approve'&&['DRAFT','READY_FOR_APPROVAL','NEEDS_REVIEW'].includes(from))return 'APPROVED';
 if(action==='stale')return 'NEEDS_REVIEW';
 if(action==='archive'&&!['PLANNING','RECONCILING'].includes(from))return 'ARCHIVED';
 if(action==='plan'&&!['PLANNING','RECONCILING'].includes(from))return 'PLANNING';
 if(action==='question'&&from==='PLANNING')return 'WAITING_USER';
 if(action==='draft'&&from==='PLANNING')return 'READY_FOR_APPROVAL';
 if(action==='interrupt'&&['PLANNING','WAITING_USER'].includes(from))return 'INTERRUPTED';
 if(action==='uncertain')return 'RECONCILING';
 throw new Error('INVALID_TRANSITION');
}

export function requireFeatureContext(proof:FeatureContextProof|null,projectId:string,configRevision:string):void {
 if(!proof)throw new Error('DISCOVERY_REQUIRED');
 if(proof.projectId!==projectId||proof.configRevision!==configRevision)throw new Error('APPROVAL_STALE');
 try{requireUuid(proof.projectId);requireUuid(proof.discoveryApprovalId);requireUuid(proof.discoveryRevisionId);requireDecimal(proof.configRevision);
 if(proof.configRevision==='0'||!/^[a-f0-9]{64}$/.test(proof.contextDigest)||new Date(proof.checkedAt).toISOString()!==proof.checkedAt)throw new Error();
 }catch{throw new Error('INVALID_REQUEST');}
}
