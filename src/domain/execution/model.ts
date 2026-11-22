import {requireUuid} from '../identifiers.js';
import type {ExecutionIdentity,ExecutionExitProof} from '../../ports/execution.js';

export const EXECUTION_LIMITS=Object.freeze({activeRuns:1,jobMs:1800000,runInputBytes:2097152,profileBytes:524288,interactions:20,
 interactionBytes:4096,outputBytes:1048576,outputChunkBytes:8192,checkpointBytes:262144});
export const EXECUTION_GRANTED=['provider.configure','start','answer','pause','cancel','checkpoint','resume'] as const;
export const EXECUTION_OBSERVED=['provider.check','reconcile'] as const;
export const executionRunPhases=['PREPARED','HOST_READY','START_AUTHORIZED','RUNNING','EXIT_OBSERVED','FINALIZED'] as const;
export type ExecutionRunPhase=typeof executionRunPhases[number];
export const executionSessionStates=['CREATED','RUNNING','WAITING_USER','PAUSING','PAUSED','CANCELLING','CANCELLED','READY_FOR_REVIEW','FAILED','INTERRUPTED','RECONCILING'] as const;
export type ExecutionSessionState=typeof executionSessionStates[number];
const transitions={
 PREPARED:{ready:'HOST_READY'},HOST_READY:{authorize:'START_AUTHORIZED'},START_AUTHORIZED:{go:'RUNNING',exit:'EXIT_OBSERVED'},
 RUNNING:{exit:'EXIT_OBSERVED'},EXIT_OBSERVED:{finish:'FINALIZED'},FINALIZED:{},
} satisfies Record<ExecutionRunPhase,Partial<Record<'ready'|'authorize'|'go'|'exit'|'finish',ExecutionRunPhase>>>;
export function executionTransition(phase:ExecutionRunPhase,event:'ready'|'authorize'|'go'|'exit'|'finish'):ExecutionRunPhase{
 const result=(transitions[phase] as Partial<Record<typeof event,ExecutionRunPhase>>)[event];
 if(!result)throw new Error('INVALID_TRANSITION');
 return result;
}
export function requireExecutionIdentity(expected:ExecutionIdentity,actual:ExecutionIdentity){
 for(const field of ['runId','generation','leaseId','challenge'] as const){
   if(requireUuid(expected[field])!==requireUuid(actual[field]))throw new Error('STALE_TARGET');
 }
}
export function executionCompletion(identity:ExecutionIdentity,proof:ExecutionExitProof|null,requested:'PAUSE'|'CANCEL'|null):{
 state:ExecutionSessionState;outcome:'SUCCEEDED'|'FAILED'|'INTERRUPTED'|'UNKNOWN';
}{
 if(!proof)return{state:'RECONCILING',outcome:'UNKNOWN'};
 requireExecutionIdentity(identity,proof.identity);
 if(!proof.verified)return{state:'RECONCILING',outcome:'UNKNOWN'};
 if(requested==='PAUSE')return{state:'PAUSED',outcome:'INTERRUPTED'};
 if(requested==='CANCEL')return{state:'CANCELLED',outcome:'INTERRUPTED'};
 if(proof.code===0&&proof.finalMessage)return{state:'READY_FOR_REVIEW',outcome:'SUCCEEDED'};
 return proof.interrupted?{state:'INTERRUPTED',outcome:'INTERRUPTED'}:{state:'FAILED',outcome:'FAILED'};
}
