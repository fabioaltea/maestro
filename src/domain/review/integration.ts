import {reviewOid} from './state.js';

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
