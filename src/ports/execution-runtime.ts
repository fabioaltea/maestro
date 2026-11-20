import type {ExecutionExitProof,ExecutionIdentity,ExecutionProviderConfig} from './execution.js';
import type {WorkspaceRecord} from './workspace.js';
import type {Deadline} from './clock.js';

export interface ExecutionInput {
 readonly bytes:Uint8Array;
 readonly profileBytes:number;
 readonly treeDigest:string;
}
export interface ExecutionCheckpointInput {
 readonly treeDigest:string;
 readonly patch:Uint8Array;
}
export interface ExecutionHost {
 readonly ready:Promise<ExecutionIdentity>;
 readonly exited:Promise<ExecutionExitProof>;
 go(identity:ExecutionIdentity):Promise<void>;
 answer(interactionId:string,text:string):Promise<void>;
 stop():void;
}
export interface ExecutionRuntimePort {
 /** Reads a bounded, current input and worktree manifest in the trusted compartment. */
 input(options:{workspace:WorkspaceRecord;envelopeId:string;profileResolutionId:string;provider:ExecutionProviderConfig}):Promise<ExecutionInput>;
 /** Must return a WAIT_GO host. No positive effect is authorized by opening it. */
 open(options:{workspace:WorkspaceRecord;identity:ExecutionIdentity;provider:ExecutionProviderConfig;input:Uint8Array;
   deadline:Deadline;output(text:string):Promise<void>;question(text:string):Promise<string>}):Promise<ExecutionHost>;
 /** Missing or uncertain ownership is signalled with null, never a PID lookup. */
 observe(identity:ExecutionIdentity):Promise<ExecutionExitProof|null>;
 checkpoint?(workspace:WorkspaceRecord):Promise<ExecutionCheckpointInput>;
}
