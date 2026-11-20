interface Recipient {
 readonly providerId:string;
 readonly revision:string;
 readonly recipient:string;
}
interface CostEstimate {readonly micros:number;readonly currency:string;readonly basis:string;readonly validUntil:number}
interface AvailableProvider extends Recipient {
 readonly qualified:boolean;readonly capabilities:readonly string[];readonly estimate?:CostEstimate;
}
interface ProviderPolicy {
 readonly mode:'STICKY'|'FALLBACK'|'COST_AWARE';
 readonly authorized:boolean;readonly expiresAt:number;readonly attempts:number;
 readonly refs:readonly Recipient[];readonly capabilities:readonly string[];
 readonly ceilingMicros?:number;
}
type Choice={readonly providerId:string;readonly code:null}|{readonly providerId:null;readonly code:string};
const no=(code:string):Choice=>({providerId:null,code});
export function evaluateProviderPolicy(policy:ProviderPolicy,proof:{checkpointCurrent:boolean;processExited:boolean;remoteOutstanding:boolean},
 candidates:readonly AvailableProvider[],now:number):Choice{
 if(!policy.authorized||now>=policy.expiresAt)return no('POLICY_REVOKED');
 if(!Number.isSafeInteger(policy.attempts)||policy.attempts<0||policy.attempts>=3)return no('RETRY_EXHAUSTED');
 if(!proof.processExited||proof.remoteOutstanding)return no('RESERVATION_UNKNOWN');
 if(!proof.checkpointCurrent)return no('CHECKPOINT_STALE');
 const permitted=policy.mode==='STICKY'?policy.refs.slice(0,1):policy.refs;
 const eligible=permitted.flatMap(ref=>{
   const match=candidates.find(candidate=>candidate.qualified&&candidate.providerId===ref.providerId&&candidate.revision===ref.revision&&
     candidate.recipient===ref.recipient&&policy.capabilities.every(permission=>candidate.capabilities.includes(permission)));
   return match?[match]:[];
 });
 if(!eligible.length)return no('NO_COMPATIBLE_PROVIDER');
 if(policy.mode!=='COST_AWARE')return{providerId:eligible[0]!.providerId,code:null};
 const first=eligible[0]!.estimate;
 if(!first||!Number.isSafeInteger(policy.ceilingMicros)||policy.ceilingMicros!<0||
    eligible.some(p=>!p.estimate||p.estimate.validUntil<=now||p.estimate.basis!==first.basis||p.estimate.currency!==first.currency||
      !Number.isSafeInteger(p.estimate.micros)||p.estimate.micros<0))return no('COST_UNKNOWN');
 const best=eligible.sort((a,b)=>a.estimate!.micros-b.estimate!.micros)[0]!;
 if(best.estimate!.micros>policy.ceilingMicros!)return no('COST_UNKNOWN');
 return{providerId:best.providerId,code:null};
}
