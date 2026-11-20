export const REVIEW_GRANTED=['create','validate','request-changes','candidate.prepare','approve','integrate'] as const;
export const REVIEW_STATES=['DRAFT','CHECKING','CHANGES_REQUESTED','READY_FOR_APPROVAL','BLOCKED','STALE','APPROVED'] as const;
export type ReviewState=typeof REVIEW_STATES[number];
export function reviewOid(value:unknown){
 if(typeof value!=='string'||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))throw new Error('INVALID_REQUEST');
 return value;
}
export function reviewTargetRef(value:unknown){
 if(typeof value!=='string'||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]{0,255}$/.test(value)||
   value.split('/').some(part=>!part||['.','..','.git'].includes(part)||part.endsWith('.lock'))||value.includes('..')||value.endsWith('.'))
   throw new Error('INVALID_REQUEST');
 return value;
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
