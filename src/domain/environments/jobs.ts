import {requireUuid} from '../identifiers.js';
import type {EnvironmentJobIdentity,EnvironmentExitEvidence} from '../../ports/environment.js';
import type {EnvironmentState} from './state.js';

export function requireEnvironmentInstall(input:{
 readonly state:EnvironmentState;readonly disposition:'PLANNED'|'MANUAL_REQUIRED';
 readonly pinDigest:string|null;readonly observedPinDigest:string|null;
 readonly inputDigest:string;readonly observedInputDigest:string;
}){
 if(input.state==='RECONCILING'||input.state==='PREPARING')throw new Error('JOB_RECONCILING');
 if(input.state!=='PLANNED'||input.disposition!=='PLANNED'||input.inputDigest!==input.observedInputDigest)throw new Error('ENVIRONMENT_STALE');
 if(!input.pinDigest||input.pinDigest!==input.observedPinDigest)throw new Error('MANAGER_MISMATCH');
}
export function evaluateEnvironmentExit(identity:EnvironmentJobIdentity,proof:EnvironmentExitEvidence|null,inputsCurrent:boolean){
 if(!proof)return{phase:'RECONCILING',error:'JOB_RECONCILING'} as const;
 for(const key of ['jobId','generation','leaseId'] as const){
   if(requireUuid(identity[key])!==requireUuid(proof[key]))throw new Error('STALE_TARGET');
 }
 if(proof.verified!==true)return{phase:'RECONCILING',error:'JOB_RECONCILING'} as const;
 if(proof.outcome==='SUCCEEDED'){
   if(proof.exitCode!==0||proof.error!==null)throw new Error('INVALID_REQUEST');
   return inputsCurrent?{phase:'SUCCEEDED',error:null} as const:{phase:'FAILED',error:'ENVIRONMENT_STALE'} as const;
 }
 if(proof.outcome==='CANCELLED')return{phase:'CANCELLED',error:proof.error??'CANCELLED'} as const;
 if(proof.outcome==='FAILED')return{phase:'FAILED',error:proof.error??'INSTALL_FAILED'} as const;
 return{phase:'RECONCILING',error:'JOB_RECONCILING'} as const;
}
