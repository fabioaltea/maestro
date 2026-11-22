import {reviewOid} from './state.js';
import {requireUuid} from '../identifiers.js';

interface CandidateScope {
 readonly targetOid:string;readonly candidateOid:string;readonly treeOid:string;readonly guardId:string;readonly stagingId:string;
 readonly reviewDigest:string;readonly evidenceDigest:string;
}
export function requireIntegrationCandidate(expected:CandidateScope,observed:CandidateScope&{
 readonly targetReserved:boolean;readonly guardClean:boolean;readonly stagingClean:boolean;readonly conflict:boolean;
}){
 if(!observed.targetReserved||observed.guardId!==expected.guardId)throw new Error('TARGET_IN_USE');
 if(observed.targetOid!==expected.targetOid)throw new Error('TARGET_MOVED');
 if(observed.conflict)throw new Error('MERGE_CONFLICT');
 if(!observed.guardClean)throw new Error('INTEGRATION_UNKNOWN');
 if(!observed.stagingClean||observed.stagingId!==expected.stagingId||observed.candidateOid!==expected.candidateOid||observed.treeOid!==expected.treeOid)
   throw new Error('CANDIDATE_CHANGED');
 if(observed.reviewDigest!==expected.reviewDigest||observed.evidenceDigest!==expected.evidenceDigest)throw new Error('APPROVAL_STALE');
}

export interface RefAttribution {readonly requestId:string;readonly old:string;readonly candidate:string}
export function requireRefAttribution(expected:RefAttribution,proof:RefAttribution|null):RefAttribution{
 requireUuid(expected.requestId);reviewOid(expected.old);reviewOid(expected.candidate);
 if(!proof||proof.requestId!==expected.requestId||proof.old!==expected.old||proof.candidate!==expected.candidate)
   throw new Error('INTEGRATION_UNKNOWN');
 return proof;
}

export function evaluateIntegrationRecovery(input:{
 readonly old:string;readonly candidate:string;readonly observed:string|null;readonly noEffectVerified?:true;
 readonly receipt:{readonly old:string;readonly candidate:string;readonly guardSynced:boolean}|null;
}):'NO_EFFECT'|'SYNC_GUARD'|'FINALIZE'|'RECONCILING'{
 for(const oid of [input.old,input.candidate])reviewOid(oid);
 if(input.old===input.candidate||input.old.length!==input.candidate.length)return 'RECONCILING';
 if(input.observed===input.old&&input.noEffectVerified===true&&!input.receipt)return 'NO_EFFECT';
 if(input.observed!==input.candidate||input.receipt?.old!==input.old||input.receipt.candidate!==input.candidate)return 'RECONCILING';
 return input.receipt.guardSynced?'FINALIZE':'SYNC_GUARD';
}
