import type {ExecutionExitProof,ExecutionIdentity,ExecutionProviderConfig} from './execution.js';
import type {WorkspaceRecord} from './workspace.js';
import type {ProfilePermission} from '../domain/profiles/permissions.js';
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
 /** The host can incorporate sealed review feedback as untrusted input. */
 readonly reviewFeedback?:true;
 /** Reads a bounded, current input and worktree manifest in the trusted compartment. */
 input(options:{workspace:WorkspaceRecord;envelopeId:string;profileResolutionId:string;provider:ExecutionProviderConfig;
   feedback?:{readonly decisionId:string;readonly sha256:string;readonly text:string}}):Promise<ExecutionInput>;
 /** Must return a WAIT_GO host. No positive effect is authorized by opening it. */
 open(options:{workspace:WorkspaceRecord;identity:ExecutionIdentity;provider:ExecutionProviderConfig;input:Uint8Array;
   permissions:readonly ProfilePermission[];deadline:Deadline;output(text:string):Promise<void>;question(text:string):Promise<string>}):Promise<ExecutionHost>;
 /** Missing or uncertain ownership is signalled with null, never a PID lookup. */
 observe(identity:ExecutionIdentity):Promise<ExecutionExitProof|null>;
 checkpoint?(workspace:WorkspaceRecord):Promise<ExecutionCheckpointInput>;
}
