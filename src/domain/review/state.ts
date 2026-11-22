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
