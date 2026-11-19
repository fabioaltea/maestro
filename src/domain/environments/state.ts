import {requireDecimal,requireUuid} from '../identifiers.js';

export const ENVIRONMENT_STATES=['UNCONFIGURED','PLANNED','MANUAL_REQUIRED','MANUAL_VERIFIED','PREPARING','READY','STALE','BLOCKED','RECONCILING'] as const;
export const ENVIRONMENT_GRANTED_ACTIONS:readonly string[]=['attest','prepare','cancel','validate'];
export const ENVIRONMENT_OBSERVATION_ACTIONS:readonly string[]=['plan','reconcile'];
export type EnvironmentState=typeof ENVIRONMENT_STATES[number];
type Action='plan'|'manual'|'attest'|'validate'|'prepare'|'prepared'|'stale'|'block'|'uncertain';
const available={plan:'PLANNED',manual:'MANUAL_REQUIRED',stale:'STALE'} as const;
const transitions:Readonly<Record<EnvironmentState,Readonly<Partial<Record<Action,EnvironmentState>>>>>={
 UNCONFIGURED:available,
 PLANNED:{...available,prepare:'PREPARING',block:'BLOCKED'},
 MANUAL_REQUIRED:{...available,attest:'MANUAL_VERIFIED'},
 MANUAL_VERIFIED:available,
 PREPARING:{prepared:'READY',block:'BLOCKED',stale:'STALE',uncertain:'RECONCILING'},
 READY:{...available,validate:'PREPARING',block:'BLOCKED'},
 STALE:available,
 BLOCKED:available,
 RECONCILING:{block:'BLOCKED',stale:'STALE',prepared:'READY'},
};
export function transitionEnvironment(current:EnvironmentState,action:Action){
 const state=transitions[current]?.[action];
 if(!state)throw new Error('INVALID_TRANSITION');
 return state;
}
export interface EnvironmentFence{
 readonly workspaceId:string;readonly workspaceGeneration:string;readonly stateRevision:string;
}
export function requireEnvironmentFence(scope:EnvironmentFence,expected:EnvironmentFence){
 if(requireUuid(scope.workspaceId)!==requireUuid(expected.workspaceId)||requireUuid(scope.workspaceGeneration)!==requireUuid(expected.workspaceGeneration))
   throw new Error('STALE_TARGET');
 if(requireDecimal(scope.stateRevision)!==requireDecimal(expected.stateRevision)||scope.stateRevision==='0')throw new Error('REVISION_CONFLICT');
}
export const ENVIRONMENT_LIMITS=Object.freeze({inputBytes:1048576,inputFiles:200,jobMs:300000,workspaceBytes:10737418240,
 totalBytes:21474836480,freeBytes:2147483648,activeJobs:1,outputBytes:65536});
export function requireEnvironmentLimits(value:{inputBytes:number;inputFiles:number;jobMs:number;workspaceBytes:number;totalBytes:number;freeBytes:number;activeJobs:number}){
 if(Object.values(value).some(n=>!Number.isSafeInteger(n)||n<0)||value.jobMs===0)throw new Error('INVALID_REQUEST');
 const limit=ENVIRONMENT_LIMITS;
 if(value.inputBytes>limit.inputBytes||value.inputFiles>limit.inputFiles||value.jobMs>limit.jobMs)throw new Error('RESOURCE_LIMIT');
 if(value.workspaceBytes>limit.workspaceBytes||value.totalBytes>limit.totalBytes||value.freeBytes<limit.freeBytes)throw new Error('DISK_BUDGET');
 if(value.activeJobs>=limit.activeJobs)throw new Error('BUSY');
}
