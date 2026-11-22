import type {IntegrationReceiptProof,IntegrationReceiptScope} from '../../ports/review.js';
import {requireUuid} from '../identifiers.js';
import {requireCleanupConditions} from '../workspaces/cleanup.js';
import {reviewOid,reviewTargetRef} from './state.js';
import {evaluateIntegrationRecovery} from './integration.js';

export function reviewCompletion(scope:IntegrationReceiptScope,evidence:{
 readonly observedTargetOid:string|null;
 readonly proof:Parameters<typeof evaluateIntegrationRecovery>[0]['receipt'];
 readonly documentationDigest:string;
 readonly contextImpact:'UNCHANGED'|'TOUCHED'|'UNKNOWN';
}):IntegrationReceiptProof{
 for(const id of [scope.integrationId,scope.reviewId,scope.workspaceId,scope.projectId])requireUuid(id);
 reviewOid(scope.sourceOid);reviewTargetRef(scope.targetRef);
 for(const value of [scope.documentationDigest,evidence.documentationDigest])
   if(!/^[a-f0-9]{64}$/.test(value))throw new Error('REVIEW_STALE');
 if(evaluateIntegrationRecovery({old:scope.expectedTargetOid,candidate:scope.candidateOid,
   observed:evidence.observedTargetOid,receipt:evidence.proof})!=='FINALIZE')throw new Error('INTEGRATION_UNKNOWN');
 const contextFreshness=scope.documentationDigest!==evidence.documentationDigest||evidence.contextImpact==='TOUCHED'?'STALE':
   evidence.contextImpact==='UNKNOWN'?'UNKNOWN':'LAST_KNOWN';
 return{...scope,resultingOid:scope.candidateOid,contextFreshness,publicationGrantRequired:true};
}

export function reviewCleanupCheck(receipt:IntegrationReceiptProof,observation:
 Omit<Parameters<typeof requireCleanupConditions>[0],'targetOid'>&{
   readonly checkedAt:number;readonly expiresAt:number;readonly headOid:string|null;
 },now:number){
 if(![now,observation.checkedAt,observation.expiresAt].every(Number.isSafeInteger)||
    observation.checkedAt>now||observation.expiresAt<=now||observation.expiresAt-observation.checkedAt>300000)throw new Error('APPROVAL_STALE');
 if(observation.headOid!==receipt.sourceOid)throw new Error('UNINTEGRATED_WORK');
 requireCleanupConditions({...observation,targetOid:receipt.resultingOid});
 return{workspaceId:receipt.workspaceId,targetRef:receipt.targetRef,targetOid:receipt.resultingOid,cleanupGrantRequired:true as const};
}
