import {EXECUTION_LIMITS} from './model.js';

export function requireCheckpointTree(value:unknown){
 if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('CHECKPOINT_STALE');
 return value;
}
export function validateCheckpointPatch(bytes:Uint8Array){
 if(!bytes.byteLength||bytes.byteLength>EXECUTION_LIMITS.checkpointBytes)throw new Error('CONTEXT_LIMIT');
}
