interface ProviderWait {
 readonly reason:'PROVIDER_QUOTA'|'PROVIDER_AUTH_REQUIRED'|'PROVIDER_UNSAFE'|'UNKNOWN_OUTCOME';
 readonly providerId:string;
 readonly observedAt:number;
 readonly resetAt:number|null;
 readonly observedUntil:number;
}
interface StickyRetry {
 readonly providerId:string;
 readonly authorized:boolean;
 readonly expiresAt:number;
 readonly attempts:number;
}
type Decision=
 |{readonly state:'WAITING_USER';readonly code:string;readonly notBefore:null}
 |{readonly state:'WAITING_PROVIDER'|'REVALIDATE';readonly code:null;readonly notBefore:number};
const manual=(code:string):Decision=>({state:'WAITING_USER',code,notBefore:null});
export function decideStickyRetry(wait:ProviderWait,policy:StickyRetry,now:number):Decision{
 if(!policy.authorized||policy.expiresAt<=now||policy.providerId!==wait.providerId)return manual('POLICY_REVOKED');
 if(wait.reason==='UNKNOWN_OUTCOME')return manual('RESERVATION_UNKNOWN');
 if(wait.reason!=='PROVIDER_QUOTA')return manual(wait.reason);
 if(!Number.isInteger(policy.attempts)||policy.attempts<0||policy.attempts>=3)return manual('RETRY_EXHAUSTED');
 if(wait.resetAt===null||![wait.observedAt,wait.resetAt,wait.observedUntil].every(Number.isSafeInteger)||wait.observedUntil<=now)
   return manual('QUOTA_RESET_UNKNOWN');
 const notBefore=Math.max(wait.resetAt,wait.observedAt+Math.min(900000,60000*2**policy.attempts));
 if(notBefore>=policy.expiresAt||notBefore>=wait.observedUntil)return manual('QUOTA_RESET_UNKNOWN');
 return{state:now>=notBefore?'REVALIDATE':'WAITING_PROVIDER',code:null,notBefore};
}
